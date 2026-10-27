// search-quality-eval — AI-judged, whole-set measurement of search and recommendation quality.
// Runs the real visitor search path (search-hybrid, trusted agent key so bot gating does not
// degrade it) and the real recommendation RPCs, then a cheap judge grades every result 0/1/2.
// A deterministic ~30% holdout split is never used for tuning. Spend is reserved atomically
// against the run's hard cap before every judge call. Starts only via service role, per-job
// internal token, or a signed-in admin. Reads only public episode metadata, never transcripts.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callLovableAI } from "../_shared/lovable-ai.ts";
import {
  aggregateMetrics, buildRecJudgeMessages, buildSearchJudgeMessages, cleanQuery, type CompactResult, foldQuery,
  itemMetrics, JUDGE_PROMPT_VERSION, JUDGE_TOOL, judgeAgreement, parseJudgment, REC_FAILURE_REASONS,
  SEARCH_FAILURE_REASONS, shouldCalibrate, splitFor, stripText,
} from "../_shared/search-quality-eval.ts";
import { detectTemporalIntent } from "../_shared/search-temporal.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const JOB = "search-quality-eval";
const JUDGE_MODEL = "google/gemini-3.1-flash-lite";
const CALIBRATION_MODEL = "google/gemini-3.8-flash";
// Conservative USD / 1M token prices used for reservations and settlement.
const PRICE: Record<string, { in: number; out: number }> = {
  [JUDGE_MODEL]: { in: 0.25, out: 1.5 },
  [CALIBRATION_MODEL]: { in: 1.0, out: 6.0 },
};
const TIME_BUDGET_MS = 110_000;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AGENT_SEARCH_KEY = Deno.env.get("AGENT_SEARCH_KEY") || "";

function sameToken(a: string, b: string) {
  if (a.length < 32 || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function authorized(admin: any, req: Request) {
  const given = req.headers.get("x-internal-token") || "";
  if (given) {
    const { data } = await admin.from("internal_job_tokens").select("token").eq("job", JOB).maybeSingle();
    if (sameToken(String(data?.token || ""), given)) return true;
  }
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  if (jwt === SERVICE_KEY) return true;
  const { data: u } = await admin.auth.getUser(jwt).catch(() => ({ data: null as any }));
  if (!u?.user?.id) return false;
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!role;
}

const cost = (model: string, inTok: number, outTok: number) => {
  const p = PRICE[model] || { in: 2, out: 12 };
  return (inTok * p.in + outTok * p.out) / 1_000_000;
};

function compactFromSearch(e: any, idx: number): CompactResult {
  const p = Array.isArray(e.podcasts) ? e.podcasts[0] : e.podcasts;
  return {
    idx,
    episode_id: String(e.id || e.episode_id || ""),
    title: stripText(e.display_title || e.title, 160),
    podcast: stripText(p?.display_title || p?.title || e.podcast_title || "", 80),
    category: p?.category || e.podcast_category || null,
    published: e.published_at ? String(e.published_at).slice(0, 10) : null,
    text: stripText(e.summary || e.description || e.ai_summary || "", 280),
  };
}

function compactFromRec(e: any, idx: number): CompactResult {
  return {
    idx,
    episode_id: String(e.episode_id || ""),
    title: stripText(e.display_title || e.title, 160),
    podcast: stripText(e.podcast_display_title || e.podcast_title || "", 80),
    category: e.podcast_category || null,
    published: e.published_at ? String(e.published_at).slice(0, 10) : null,
    text: stripText(e.summary || e.description || e.ai_summary || "", 280),
  };
}

async function judge(admin: any, runId: string, model: string, messages: any[], n: number, reasons: readonly string[], targetId: string, allowStale: boolean) {
  const inChars = messages.reduce((a, m) => a + String(m.content).length, 0);
  const estIn = Math.ceil(inChars / 3) + 300;
  const reserve = cost(model, estIn, 1200) * 1.3;
  const { data: ok, error } = await admin.rpc("reserve_search_quality_cost_v1", { p_run_id: runId, p_amount: reserve });
  if (error) throw new Error(`reserve: ${error.message}`);
  if (!ok) return { capped: true as const };
  let actual = 0;
  try {
    const res = await callLovableAI({
      model, messages, tools: [JUDGE_TOOL], tool_choice: { type: "function", function: { name: "grade" } },
      max_tokens: 1500, temperature: 0, job_type: JOB, target_type: "search_quality_item", target_id: targetId,
      prompt_version: JUDGE_PROMPT_VERSION, skip_input_validation: true,
    } as any);
    actual = cost(model, res.input_tokens || estIn, res.output_tokens || 0);
    if (!res.ok) return { error: res.error || `HTTP ${res.status}`, cost: actual };
    const call = res.data?.choices?.[0]?.message?.tool_calls?.[0];
    const parsed = parseJudgment(call?.function?.arguments ?? null, n, reasons, allowStale);
    if (!parsed) return { error: `invalid_judgment: ${String(call?.function?.arguments ?? res.data?.choices?.[0]?.message?.content ?? "").slice(0, 160)}`, cost: actual };
    return { parsed, cost: actual };
  } finally {
    await admin.rpc("settle_search_quality_cost_v1", { p_run_id: runId, p_delta: actual - reserve });
  }
}

async function runSearch(query: string) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await runSearchOnce(query);
    } catch (e) {
      const msg = String((e as Error)?.message || e);
      if (attempt >= 4 || !/rate limit|HTTP 429|HTTP 546|HTTP 503/i.test(msg)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * attempt));
    }
  }
}

async function runSearchOnce(query: string) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  const t0 = Date.now();
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/search-hybrid`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}`, apikey: SERVICE_KEY,
        "x-podiverzum-agent-key": AGENT_SEARCH_KEY, "x-podiverzum-agent": JOB,
      },
      // Same request shape as the visitor search page.
      body: JSON.stringify({ q: query, limit: 80, rerank: true, lang: "hu", latency_mode: "quality", soft_budget_ms: 13500 }),
      signal: ctrl.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`search HTTP ${res.status}: ${text.slice(0, 200)}`);
    return { data: JSON.parse(text), latency: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

async function processItem(admin: any, run: any, item: any) {
  const today = new Date().toISOString().slice(0, 10);
  let results: CompactResult[] = [];
  let diagnostics: Record<string, unknown> = {};
  let latency = 0;
  let messages: any[];
  let reasons: readonly string[];
  let allowStale = false;

  if (item.kind === "search") {
    const { data, latency: l } = await runSearch(item.query);
    latency = l;
    results = (data?.episodes || []).slice(0, 10).map(compactFromSearch);
    diagnostics = {
      semantic: !!data?.semantic, reranked: !!data?.reranked, cohere: !!data?.cohere_used, cache_hit: !!data?.cache_hit,
      curated_synonyms: data?.curated_synonyms ?? null, engine: data?.engine ?? null,
      confidence_band: data?.confidence_band ?? null, total: (data?.episodes || []).length,
      temporal_intent: data?.temporal_intent ?? null, intent: data?.understanding?.intent ?? null,
      expanded: data?.understanding?.expanded_terms ?? data?.understanding?.synonyms ?? null,
      person_pin: data?.person_pin?.slug ?? null, organization_pin: data?.organization_pin?.slug ?? null,
      topic_pin: data?.topic_pin?.slug ?? null, podcast_pin: data?.podcast_pin?.slug ?? null,
      degraded_for_latency: !!data?.degraded_for_latency,
      why: (data?.episodes || []).slice(0, 10).map((e: any) => e.why_matched ?? null),
    };
    const temporal = detectTemporalIntent(item.query);
    messages = buildSearchJudgeMessages(item.query, today, results, temporal?.windowDays ?? null);
    reasons = SEARCH_FAILURE_REASONS;
    allowStale = !!temporal;
  } else {
    const rpc = item.query === "related_embedding" ? "get_related_episodes_by_embedding" : "similar_episodes";
    const args = rpc === "similar_episodes"
      ? { p_episode_id: item.seed_episode_id, p_limit: 12 }
      : { p_episode_id: item.seed_episode_id, p_limit: 12, p_downweight_same_podcast: true };
    const t0 = Date.now();
    const [{ data: rows, error }, { data: seed }] = await Promise.all([
      admin.rpc(rpc, args),
      admin.from("episodes").select("id,title,display_title,summary,description,ai_summary,published_at,podcasts!inner(title,display_title,category)")
        .eq("id", item.seed_episode_id).maybeSingle(),
    ]);
    latency = Date.now() - t0;
    if (error) throw new Error(`${rpc}: ${error.message}`);
    if (!seed) throw new Error("seed_missing");
    results = (rows || []).slice(0, 8).map(compactFromRec);
    const seedC = compactFromSearch(seed, -1);
    diagnostics = { rpc, seed: seedC, reasons: (rows || []).slice(0, 8).map((r: any) => r.related_reason ?? null), total: (rows || []).length };
    messages = buildRecJudgeMessages(seedC, results);
    reasons = REC_FAILURE_REASONS;
  }

  if (!results.length) {
    return { status: "done", results, judgments: { query_type: null, grades: [] }, metrics: itemMetrics([]), diagnostics, latency, cost: 0 };
  }

  const primary = await judge(admin, run.id, JUDGE_MODEL, messages, results.length, reasons, item.id, allowStale);
  if ("capped" in primary) return { capped: true };
  if (!primary.parsed) return { status: "failed", error: primary.error, cost: primary.cost, results, diagnostics, latency };
  let calibration: any = null;
  let spent = primary.cost;
  if (item.calibrate) {
    const cal = await judge(admin, run.id, CALIBRATION_MODEL, messages, results.length, reasons, item.id, allowStale);
    if (!("capped" in cal) && cal.parsed) {
      calibration = { model: CALIBRATION_MODEL, ...cal.parsed, agreement: judgeAgreement(primary.parsed.grades, cal.parsed.grades) };
      spent += cal.cost;
    } else if (!("capped" in cal)) spent += cal.cost || 0;
  }
  const scores = primary.parsed.grades.map((g) => g.score);
  return {
    status: "done", results, judgments: { model: JUDGE_MODEL, ...primary.parsed }, calibration,
    metrics: itemMetrics(scores), diagnostics, latency, cost: spent,
  };
}

async function createRun(admin: any, body: any) {
  const cap = Math.min(2, Math.max(0.05, Number(body.cost_cap_usd) || 1.5));
  const calShare = Math.min(0.3, Math.max(0, Number(body.calibration_share ?? 0.15)));
  const { data: eng } = await admin.from("app_settings").select("value").eq("key", "search_engine").maybeSingle();
  const { data: run, error } = await admin.from("search_quality_runs").insert({
    label: String(body.label || `Search quality ${new Date().toISOString().slice(0, 16)}`).slice(0, 120),
    ranking_version: Number(eng?.value?.ranking_version) || null,
    judge_model: JUDGE_MODEL, calibration_model: CALIBRATION_MODEL, cost_cap_usd: cap,
    config: { calibration_share: calShare, prompt_version: JUDGE_PROMPT_VERSION, visitor_days: 90, gsc_days: 90 },
  }).select("*").single();
  if (error) throw error;

  const seen = new Set<string>();
  const items: any[] = [];
  const add = (query: string, source: string, query_type: string | null) => {
    const q = cleanQuery(query);
    if (!q) return;
    const k = foldQuery(q);
    if (seen.has(k)) return;
    seen.add(k);
    items.push({ run_id: run.id, kind: "search", query: q, query_type, source, split: splitFor(q), calibrate: shouldCalibrate(q, calShare) });
  };

  const { data: golden } = await admin.from("search_golden_queries").select("query,query_type").eq("active", true).limit(1000);
  for (const g of golden || []) add(g.query, "golden", g.query_type);

  const since90 = new Date(Date.now() - 90 * 86400_000).toISOString();
  const { data: ev } = await admin.from("search_events").select("query").gte("created_at", since90).limit(5000);
  const evCount = new Map<string, { q: string; n: number }>();
  for (const r of ev || []) {
    const q = cleanQuery(r.query);
    if (!q) continue;
    const k = foldQuery(q);
    const cur = evCount.get(k) || { q, n: 0 };
    cur.n++;
    evCount.set(k, cur);
  }
  [...evCount.values()].sort((a, b) => b.n - a.n).slice(0, Math.min(300, Number(body.max_visitor) || 200))
    .forEach((x) => add(x.q, "visitor", null));

  const { data: gsc } = await admin.from("gsc_query_daily").select("query,impressions").gte("date", since90.slice(0, 10)).limit(20000);
  const gscAgg = new Map<string, { q: string; imp: number }>();
  for (const r of gsc || []) {
    const q = cleanQuery(r.query);
    if (!q || /podiverzum/i.test(q)) continue;
    const k = foldQuery(q);
    const cur = gscAgg.get(k) || { q, imp: 0 };
    cur.imp += Number(r.impressions) || 0;
    gscAgg.set(k, cur);
  }
  [...gscAgg.values()].sort((a, b) => b.imp - a.imp).slice(0, Math.min(200, Number(body.max_gsc) || 80))
    .forEach((x) => add(x.q, "gsc", null));

  const seeds: string[] = Array.isArray(body.rec_seed_ids) ? body.rec_seed_ids.slice(0, 200).map(String) : [];
  for (const id of seeds) {
    for (const rpc of ["similar_episodes", "related_embedding"]) {
      items.push({ run_id: run.id, kind: "recommendation", query: rpc, seed_episode_id: id, source: rpc, split: splitFor(id), calibrate: shouldCalibrate(rpc + id, calShare) });
    }
  }

  for (let i = 0; i < items.length; i += 200) {
    const { error: e } = await admin.from("search_quality_items").insert(items.slice(i, i + 200));
    if (e) throw e;
  }
  return { run_id: run.id, items: items.length, by_source: items.reduce((a: any, x) => ((a[x.source] = (a[x.source] || 0) + 1), a), {}), cost_cap_usd: cap };
}

async function tick(admin: any, body: any, startedAt: number) {
  // Without run_id (scheduler), drain the oldest open run.
  const q = admin.from("search_quality_runs").select("*");
  const { data: run } = body.run_id
    ? await q.eq("id", body.run_id).maybeSingle()
    : await q.eq("status", "open").order("created_at", { ascending: true }).limit(1).maybeSingle();
  if (!run) return { skipped: true, reason: body.run_id ? "run_not_found" : "no_open_run" };
  if (run.status !== "open") return { skipped: true, status: run.status };
  const concurrency = Math.min(4, Math.max(1, Number(body.concurrency) || 3));
  let processed = 0, failed = 0, capped = false;
  while (Date.now() - startedAt < TIME_BUDGET_MS - 35_000 && !capped) {
    const { data: claimed, error } = await admin.rpc("claim_search_quality_items_v1", { p_run_id: run.id, p_limit: concurrency, p_lease_seconds: 240 });
    if (error) throw new Error(`claim: ${error.message}`);
    if (!claimed?.length) break;
    await Promise.all(claimed.map(async (item: any) => {
      try {
        const out: any = await processItem(admin, run, item);
        if (out.capped) {
          capped = true;
          await admin.from("search_quality_items").update({ status: "pending", attempts: Math.max(0, item.attempts - 1), lease_until: null, updated_at: new Date().toISOString() }).eq("id", item.id).eq("status", "claimed");
          return;
        }
        const finalStatus = out.status === "failed" && item.attempts < 3 ? "pending" : out.status;
        const retryAt = finalStatus === "pending" ? new Date(Date.now() + 120_000).toISOString() : null;
        await admin.from("search_quality_items").update({
          status: finalStatus, results: out.results ?? null, judgments: out.judgments ?? null, calibration: out.calibration ?? null,
          metrics: out.metrics ?? null, diagnostics: out.diagnostics ?? null, latency_ms: out.latency ?? null,
          cost_usd: Number(item.cost_usd || 0) + Number(out.cost || 0), error: out.error ?? null, lease_until: retryAt,
          updated_at: new Date().toISOString(),
        }).eq("id", item.id).eq("status", "claimed");
        if (out.status === "failed") failed++; else processed++;
      } catch (e) {
        failed++;
        await admin.from("search_quality_items").update({
          status: item.attempts >= 3 ? "failed" : "pending", error: String((e as Error)?.message || e).slice(0, 300),
          lease_until: item.attempts >= 3 ? null : new Date(Date.now() + 120_000).toISOString(), updated_at: new Date().toISOString(),
        }).eq("id", item.id).eq("status", "claimed");
      }
    }));
  }
  const { count: remaining } = await admin.from("search_quality_items").select("id", { count: "exact", head: true })
    .eq("run_id", run.id).in("status", ["pending", "claimed"]);
  const { data: fresh } = await admin.from("search_quality_runs").select("cost_used_usd,cost_cap_usd").eq("id", run.id).single();
  const finalized = remaining === 0 ? (await finalize(admin, { run_id: run.id })).complete : false;
  return { run_id: run.id, processed, failed, capped, remaining, finalized, cost_used_usd: fresh?.cost_used_usd, cost_cap_usd: fresh?.cost_cap_usd };
}

async function finalize(admin: any, body: any) {
  const all: any[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await admin.from("search_quality_items")
      .select("kind,source,split,query_type,status,metrics,judgments,calibration,latency_ms")
      .eq("run_id", body.run_id).range(from, from + 499);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < 500) break;
  }
  const done = all.filter((r) => r.status === "done" && r.metrics);
  const group = (key: (r: any) => string) => {
    const m: Record<string, any[]> = {};
    for (const r of done) (m[key(r)] ||= []).push(r.metrics);
    return Object.fromEntries(Object.entries(m).map(([k, v]) => [k, aggregateMetrics(v)]));
  };
  const typeOf = (r: any) => r.judgments?.query_type || r.query_type || "other";
  const reasons: Record<string, Record<string, number>> = {};
  for (const r of done) {
    const bucket = r.kind === "search" ? "search" : "recommendation";
    for (const g of r.judgments?.grades || []) {
      if (g.score === 0 && g.reason) {
        reasons[bucket] ||= {};
        reasons[bucket][g.reason] = (reasons[bucket][g.reason] || 0) + 1;
      }
    }
  }
  const agree = { total: 0, exact: 0, within1: 0, binary: 0 };
  for (const r of done) {
    const a = r.calibration?.agreement;
    if (!a) continue;
    agree.total += a.total; agree.exact += a.exact; agree.within1 += a.within1; agree.binary += a.binary;
  }
  const lat = done.filter((r) => r.kind === "search" && r.latency_ms).map((r) => r.latency_ms).sort((a, b) => a - b);
  const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] : null);
  const metrics = {
    counts: { total: all.length, done: done.length, failed: all.filter((r) => r.status === "failed").length },
    search: {
      overall: aggregateMetrics(done.filter((r) => r.kind === "search").map((r) => r.metrics)),
      by_split: group((r) => (r.kind === "search" ? `search:${r.split}` : `rec:${r.split}`)),
      by_query_type: group((r) => (r.kind === "search" ? typeOf(r) : "_rec")),
      by_source: group((r) => r.source),
      latency_p50: pct(0.5), latency_p95: pct(0.95),
    },
    recommendation: group((r) => (r.kind === "recommendation" ? r.source : "_search")),
    off_topic_reasons: reasons,
    judge_calibration: agree.total ? {
      graded_results: agree.total, exact: +(agree.exact / agree.total).toFixed(3),
      within_one: +(agree.within1 / agree.total).toFixed(3), relevant_binary: +(agree.binary / agree.total).toFixed(3),
    } : null,
  };
  const complete = !all.some((r) => r.status === "pending" || r.status === "claimed");
  await admin.from("search_quality_runs").update({
    metrics, ...(complete && body.close !== false ? { status: "completed", completed_at: new Date().toISOString() } : {}),
  }).eq("id", body.run_id);
  return { complete, metrics };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  if (!(await authorized(admin, req))) return json({ error: "forbidden" }, 403);
  const body = await req.json().catch(() => ({} as any));
  try {
    if (body.action === "create_run") return json(await createRun(admin, body));
    if (body.action === "tick") return json(await tick(admin, body, startedAt));
    if (body.action === "finalize") return json(await finalize(admin, body));
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error)?.message || e) }, 500);
  }
});
