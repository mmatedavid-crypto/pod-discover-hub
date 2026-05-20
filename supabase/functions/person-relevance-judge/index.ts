// Person-episode relevance AI judge.
// Validates whether an episode truly belongs to a person's page.
// HU-output JSON tool call; writes relevance_status + ai_* fields on person_episode_mentions.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { chatTokenCostUsd } from "../_shared/ai-pricing.ts";

const TIME_BUDGET_MS = 20_000;
const RESERVE_MS = 4_000;
const MODEL = "gemini-2.5-flash";
const DEFAULT_DAILY_BUDGET_USD = 2.0;
const MAX_CONCURRENCY = 250;

async function getBudgetFromSettings(supabase: any): Promise<{ budget: number; batchLimit: number; concurrency: number; enabled: boolean; autoDisableWhenEmpty: boolean; preferPaid: boolean; raw: any }> {
  try {
    const { data } = await supabase.from("app_settings").select("value").eq("key", "person_relevance_judge_controls").maybeSingle();
    const v = data?.value || {};
    return {
      budget: Number(v.daily_budget_usd ?? DEFAULT_DAILY_BUDGET_USD),
      batchLimit: Number(v.batch_limit ?? 30),
      concurrency: Math.min(Math.max(Number(v.concurrency ?? 1), 1), MAX_CONCURRENCY),
      enabled: v.enabled !== false,
      autoDisableWhenEmpty: v.auto_disable_when_empty !== false,
      preferPaid: v.prefer_paid === true,
      raw: v,
    };
  } catch {
    return { budget: DEFAULT_DAILY_BUDGET_USD, batchLimit: 30, concurrency: 1, enabled: true, autoDisableWhenEmpty: true, preferPaid: false, raw: {} };
  }
}

async function setControls(supabase: any, patch: Record<string, any>, prev: any) {
  const merged = { ...(prev || {}), ...patch };
  await supabase.from("app_settings").upsert({ key: "person_relevance_judge_controls", value: merged, updated_at: new Date().toISOString() });
}

async function countPendingHU(supabase: any, personIds?: string[] | null): Promise<number> {
  // Count BOTH 'pending' AND 'in_progress' so a wave of stuck claims (workers killed
  // by edge timeout / 429s) doesn't trick the runner into auto-disabling prematurely.
  // The reaper resets stale in_progress → pending on the next invocation.
  let q = supabase
    .from("person_episode_mentions")
    .select("id, podcasts!person_episode_mentions_podcast_id_fkey!inner(is_hungarian, language_decision)", { count: "exact", head: true })
    .in("relevance_status", ["pending", "in_progress"])
    .eq("podcasts.is_hungarian", true)
    .eq("podcasts.language_decision", "accept_hungarian");
  if (personIds && personIds.length) q = q.in("person_id", personIds);
  const { count } = await q;
  return Number(count || 0);
}

interface PendingRow {
  id: string;
  person_id: string;
  episode_id: string;
  mention_type: string;
  confidence: number;
  person_name: string;
  person_aliases: string[];
  disambiguation_label: string | null;
  disambiguation_context: string | null;
  ep_title: string;
  ep_summary: string | null;
  ep_ai_summary: string | null;
  pod_title: string;
  pod_description: string | null;
}

const TOOL = {
  name: "judge_person_episode_relevance",
  description: "Decide whether an episode truly belongs to this person's page. Always answer in Hungarian.",
  parameters: {
    type: "object",
    properties: {
      is_relevant: { type: "boolean" },
      relevance_score: { type: "number", minimum: 0, maximum: 1 },
      recommended_mention_type: { type: "string", enum: ["host", "guest", "subject", "mentioned", "none"] },
      identity_match: { type: "string", enum: ["same_person", "different_person_same_name", "substring_false_positive", "uncertain"] },
      reason: { type: "string", description: "Rövid magyar indoklás (max 200 karakter)." },
      evidence_phrases: { type: "array", items: { type: "string" }, maxItems: 5 },
      should_show_publicly: { type: "boolean" },
      is_false_positive: { type: "boolean" },
      false_positive_reason: { type: "string", nullable: true },
    },
    required: ["is_relevant", "relevance_score", "recommended_mention_type", "identity_match", "reason", "evidence_phrases", "should_show_publicly", "is_false_positive"],
  },
};

function buildPrompt(r: PendingRow): string {
  const aliasLine = r.person_aliases && r.person_aliases.length ? `Aliasok: ${r.person_aliases.slice(0, 8).join(", ")}` : "";
  const disambig = r.disambiguation_label ? `Megkülönböztetés: ${r.disambiguation_label}${r.disambiguation_context ? ` (${r.disambiguation_context})` : ""}` : "";
  return `Te magyar nyelvű podcast-relevancia bíró vagy. Döntsd el, hogy az alábbi epizód valóban a megnevezett személyhez kapcsolódik-e.

SZIGORÚ SZABÁLYOK:
- Csak teljes névegyezést vagy explicit alias-egyezést fogadj el (szóhatárral).
- NE fogadj el csak vezetéknév- vagy résszó-egyezést.
- Ha más, azonos nevű emberről van szó, identity_match = "different_person_same_name".
- Ha a név egy szóba van ágyazva (pl. "Pólus" egy "többpólusú" szóban), identity_match = "substring_false_positive".
- Csak akkor relevant=true, ha a személy host, vendég, központi téma vagy érdemi említés.
- Ha bizonytalan vagy, should_show_publicly = false.
- A reason mező és minden szöveges válasz MAGYARUL.

SZEMÉLY: ${r.person_name}
${aliasLine}
${disambig}

PODCAST: ${r.pod_title}
PODCAST LEÍRÁS: ${(r.pod_description || "").slice(0, 400)}

EPIZÓD CÍM: ${r.ep_title}
EPIZÓD ÖSSZEFOGLALÓ: ${(r.ep_ai_summary || r.ep_summary || "").slice(0, 1200)}

Jelenlegi szabályalapú besorolás: mention_type=${r.mention_type}, confidence=${r.confidence}.

Hívd meg a judge_person_episode_relevance tool-t.`;
}

async function callAIDirect(prompt: string, geminiKey: string): Promise<{ result: any; cost: number } | null> {
  // Direct Google Generative Language API — bypasses Lovable Gateway RPM limits.
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      tools: [{ functionDeclarations: [TOOL] }],
      toolConfig: { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [TOOL.name] } },
    }),
  });
  if (!r.ok) {
    if (r.status === 429 || r.status === 503) throw new Error(`rate_limit:${r.status}`);
    return null;
  }
  const j = await r.json();
  const fc = j.candidates?.[0]?.content?.parts?.find((p: any) => p.functionCall)?.functionCall;
  if (!fc?.args) return null;
  const usage = j.usageMetadata || {};
  const cost = chatTokenCostUsd(MODEL, Number(usage.promptTokenCount || 0), Number(usage.candidatesTokenCount || 0));
  return { result: fc.args, cost };
}

// Key pool: by default FREE first (save paid budget), fall back to paid on 429.
// When preferPaid=true (drain mode), paid first, free as fallback.
function getKeyPool(preferPaid = false): { key: string; isFree: boolean }[] {
  const pool: { key: string; isFree: boolean }[] = [];
  const free = Deno.env.get("GEMINI_API_KEY_FREE");
  const paid = Deno.env.get("GEMINI_API_KEY");
  if (preferPaid) {
    if (paid) pool.push({ key: paid, isFree: false });
    if (free) pool.push({ key: free, isFree: true });
  } else {
    if (free) pool.push({ key: free, isFree: true });
    if (paid) pool.push({ key: paid, isFree: false });
  }
  return pool;
}

async function callAI(prompt: string, preferPaid = false): Promise<{ result: any; cost: number; isFree: boolean } | null> {
  const pool = getKeyPool(preferPaid);
  if (pool.length === 0) throw new Error("No GEMINI_API_KEY available");
  let lastErr: any = null;
  for (const { key, isFree } of pool) {
    try {
      const out = await callAIDirect(prompt, key);
      if (out) return { ...out, isFree };
    } catch (e) {
      lastErr = e;
      if (String(e).includes("rate_limit")) continue; // try next key
      throw e;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

async function logSpend(supabase: any, cost: number) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const { error } = await supabase.rpc("upsert_ai_spend", { p_day: day, p_kind: "person_relevance", p_cost: cost, p_calls: 1 });
    if (!error) return;
  } catch { /* fall through */ }
  // fallback: manual upsert
  try {
    const { data } = await supabase.from("ai_spend_daily").select("*").eq("day", day).maybeSingle();
    const cur = data || { day, spend_usd: 0, calls: 0, by_kind: {} };
    const by = cur.by_kind || {};
    by.person_relevance = (by.person_relevance || 0) + cost;
    await supabase.from("ai_spend_daily").upsert({
      day,
      spend_usd: Number(cur.spend_usd || 0) + cost,
      calls: (cur.calls || 0) + 1,
      by_kind: by,
    });
  } catch { /* ignore */ }
}

async function getSpendToday(supabase: any): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.from("ai_spend_daily").select("by_kind").eq("day", day).maybeSingle();
  return Number((data?.by_kind as any)?.person_relevance || 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: any = {};
  try { body = req.method === "POST" ? await req.json() : {}; } catch {}
  const settings = await getBudgetFromSettings(supabase);
  if (!settings.enabled) {
    return new Response(JSON.stringify({ ok: true, skipped: "disabled_in_settings" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  const DAILY_BUDGET_USD = settings.budget;
  const batchLimit = Math.min(Math.max(Number(body.batch_limit) || settings.batchLimit, 1), 800);
  const concurrency = Math.min(Math.max(Number(body.concurrency) || settings.concurrency, 1), MAX_CONCURRENCY);
  const targetPersonIds: string[] | null = Array.isArray(body.person_ids) && body.person_ids.length ? body.person_ids : null;

  // Reap stale 'in_progress' rows (workers that died) — reset to 'pending' if older than 90s.
  try {
    await supabase.from("person_episode_mentions")
      .update({ relevance_status: "pending", ai_judged_at: null })
      .eq("relevance_status", "in_progress")
      .lt("ai_judged_at", new Date(Date.now() - 90_000).toISOString());
  } catch { /* ignore */ }

  // Pre-guard: if pending backlog is empty, exit cleanly and optionally self-disable.
  const initialPending = await countPendingHU(supabase, targetPersonIds);
  if (initialPending === 0) {
    const patch: any = { last_run_status: "no_work", last_run_at: new Date().toISOString(), last_remaining_pending: 0 };
    if (settings.autoDisableWhenEmpty && !targetPersonIds) patch.enabled = false;
    await setControls(supabase, patch, settings.raw);
    return new Response(JSON.stringify({ ok: true, status: "no_work", remaining_pending: 0, runner_disabled: !!patch.enabled === false && settings.autoDisableWhenEmpty }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  const startedAt = Date.now();
  let processed = 0, accepted = 0, rejected = 0, needs_review = 0, errors = 0;
  let spendToday = await getSpendToday(supabase);

  while (Date.now() - startedAt < TIME_BUDGET_MS - RESERVE_MS) {
    if (spendToday >= DAILY_BUDGET_USD) break;

    // Atomic claim: flips relevance_status='pending'→'in_progress' with SKIP LOCKED so
    // multiple concurrent invocations never overlap.
    const { data: claimed, error: claimErr } = await supabase.rpc("claim_person_judge_batch", { _limit: batchLimit });
    if (claimErr || !claimed || claimed.length === 0) break;
    const claimedIds: string[] = (claimed as any[]).map((r: any) => (typeof r === "string" ? r : r.id));
    let q = supabase
      .from("person_episode_mentions")
      .select("id, person_id, episode_id, mention_type, confidence, people!inner(name, disambiguation_label, disambiguation_context, ai_review_status, activation_status), podcasts!person_episode_mentions_podcast_id_fkey!inner(title, description, is_hungarian, language_decision), episodes!inner(title, summary, ai_summary)")
      .in("id", claimedIds);
    if (targetPersonIds) q = q.in("person_id", targetPersonIds);
    const { data: rows, error } = await q;
    if (error || !rows || rows.length === 0) break;

    // fetch aliases in one shot
    const personIds = [...new Set(rows.map((r: any) => r.person_id))];
    const { data: aliasRows } = await supabase.from("person_aliases").select("person_id, alias").in("person_id", personIds);
    const aliasMap = new Map<string, string[]>();
    (aliasRows || []).forEach((a: any) => {
      const list = aliasMap.get(a.person_id) || [];
      list.push(a.alias);
      aliasMap.set(a.person_id, list);
    });

    let rateLimitHits = 0;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

    const processOne = async (m: any) => {
      // CRITICAL: every non-terminal exit MUST release the claim back to 'pending',
      // otherwise rows stay in_progress with fresh ai_judged_at and the reaper can't
      // touch them for 5 min — exactly the bug that stranded 3,763 rows.
      let terminal = false;
      const release = async () => {
        if (terminal) return;
        try {
          await supabase.from("person_episode_mentions")
            .update({ relevance_status: "pending", ai_judged_at: null })
            .eq("id", m.id)
            .eq("relevance_status", "in_progress");
        } catch { /* ignore */ }
      };

      try {
        if (Date.now() - startedAt > TIME_BUDGET_MS - RESERVE_MS) return;
        if (spendToday >= DAILY_BUDGET_USD) return;
        const pending: PendingRow = {
          id: m.id,
          person_id: m.person_id,
          episode_id: m.episode_id,
          mention_type: m.mention_type,
          confidence: Number(m.confidence || 0),
          person_name: m.people.name,
          person_aliases: aliasMap.get(m.person_id) || [],
          disambiguation_label: m.people.disambiguation_label,
          disambiguation_context: m.people.disambiguation_context,
          ep_title: m.episodes.title,
          ep_summary: m.episodes.summary,
          ep_ai_summary: m.episodes.ai_summary,
          pod_title: m.podcasts.title,
          pod_description: m.podcasts.description,
        };

        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            const out = await callAI(buildPrompt(pending), settings.preferPaid);
            if (!out) { errors++; return; }
            // Free-tier key: no $ charge, don't count against daily budget.
            const billedCost = out.isFree ? 0 : out.cost;
            spendToday += billedCost;
            if (billedCost > 0) await logSpend(supabase, billedCost);
            const r = out.result;
            let status: string;
            if (r.is_false_positive || r.identity_match === "substring_false_positive" || r.identity_match === "different_person_same_name") status = "rejected";
            else if (r.identity_match === "uncertain" || !r.should_show_publicly) status = "needs_review";
            else if (r.is_relevant && r.relevance_score >= 0.6) status = "accepted";
            else status = "rejected";

            if (status === "accepted") accepted++;
            else if (status === "rejected") rejected++;
            else needs_review++;

            await supabase.from("person_episode_mentions").update({
              relevance_status: status,
              final_relevance_score: r.relevance_score,
              validation_source: "ai",
              ai_identity_match: r.identity_match,
              ai_reason: r.reason,
              ai_evidence_phrases: r.evidence_phrases || [],
              ai_judged_at: new Date().toISOString(),
              ai_model: MODEL,
              mention_type: status === "accepted" && r.recommended_mention_type !== "none" ? r.recommended_mention_type : m.mention_type,
            }).eq("id", m.id);
            processed++;
            terminal = true;
            return;
          } catch (e) {
            if (String(e).includes("rate_limit")) {
              rateLimitHits++;
              await sleep([1500, 4000, 8000][attempt] || 8000);
              continue;
            }
            errors++;
            return;
          }
        }
        errors++;
      } finally {
        await release();
      }
    };

    // worker pool
    let idx = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const my = idx++;
        if (my >= rows.length) return;
        if (Date.now() - startedAt > TIME_BUDGET_MS - RESERVE_MS) return;
        if (spendToday >= DAILY_BUDGET_USD) return;
        await processOne(rows[my]);
      }
    });
    await Promise.all(workers);

    // if rate limit is sustained (many hits in this batch), slow down next batch
    if (rateLimitHits >= Math.max(5, Math.floor(rows.length / 4))) {
      await sleep(3000);
    }
  }

  // recompute hub
  try { await supabase.rpc("refresh_people_hub_score"); } catch { /* ignore */ }

  // Post-run: remaining pending + self-shutdown
  const remainingPending = await countPendingHU(supabase, targetPersonIds);
  let runnerDisabled = false;
  let status = "completed";
  if (errors > 0 && processed === 0) status = "failed";
  else if (remainingPending === 0) {
    status = "drained";
    if (settings.autoDisableWhenEmpty && !targetPersonIds) {
      await setControls(supabase, {
        enabled: false,
        last_run_status: "drained",
        last_run_at: new Date().toISOString(),
        last_remaining_pending: 0,
        last_processed: processed, last_accepted: accepted, last_rejected: rejected, last_needs_review: needs_review,
      }, settings.raw);
      runnerDisabled = true;
    }
  } else {
    await setControls(supabase, {
      last_run_status: status,
      last_run_at: new Date().toISOString(),
      last_remaining_pending: remainingPending,
      last_processed: processed, last_accepted: accepted, last_rejected: rejected, last_needs_review: needs_review,
    }, settings.raw);
  }

  return new Response(JSON.stringify({
    ok: true,
    status,
    processed, accepted, rejected, needs_review, errors,
    remaining_pending: remainingPending,
    runner_disabled: runnerDisabled,
    spend_today_usd: spendToday,
    elapsed_ms: Date.now() - startedAt,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
