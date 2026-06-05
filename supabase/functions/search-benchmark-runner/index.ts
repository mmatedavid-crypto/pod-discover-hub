import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type Golden = {
  id: string;
  query: string;
  query_type: string | null;
  expected_intent: string | null;
  expected_podcast_slug: string | null;
  expected_entity: string | null;
  must_include: unknown;
  must_exclude: unknown;
};

type Controls = {
  enabled?: boolean;
  batch_size?: number;
  max_queries_per_week?: number;
  per_call_timeout_ms?: number;
  max_attempts?: number;
  refresh_before_new_run?: boolean;
  catalog_limit_per_type?: number;
  popular_limit?: number;
  external_chart_limit?: number;
  external_seed_limit?: number;
  min_days_between_runs?: number;
};

const DEFAULT_CONTROLS: Required<Controls> = {
  enabled: true,
  batch_size: 35,
  max_queries_per_week: 220,
  per_call_timeout_ms: 45_000,
  max_attempts: 2,
  refresh_before_new_run: true,
  catalog_limit_per_type: 80,
  popular_limit: 40,
  external_chart_limit: 120,
  external_seed_limit: 100,
  min_days_between_runs: 6,
};

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function mondayKey(d = new Date()): string {
  const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() - day + 1);
  return utc.toISOString().slice(0, 10);
}

function dcg(gains: number[]) {
  return gains.reduce((s, g, i) => s + (Math.pow(2, g) - 1) / Math.log2(i + 2), 0);
}

function ndcg(scores: number[], k = 10) {
  const top = scores.slice(0, k);
  const ideal = [...scores].sort((a, b) => b - a).slice(0, k);
  const idcg = dcg(ideal);
  return idcg ? dcg(top) / idcg : 0;
}

function computeMetrics(top: unknown[], scores: Record<string, number>) {
  const filled = top.map((_, i) => scores[String(i)] ?? 0);
  const rel = filled.map((v) => (v >= 2 ? 1 : 0));
  const p3 = rel.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, top.length || 3);
  const p5 = rel.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, top.length || 5);
  const firstRel = rel.findIndex((x) => x === 1);
  return { p3, p5, ndcg: ndcg(filled, 10), rr: firstRel === -1 ? 0 : 1 / (firstRel + 1) };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
}

function foldForMatch(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function autoScoreTopResults(g: Golden, top: Array<Record<string, unknown>>): Record<string, number> {
  const expectedEntity = foldForMatch(g.expected_entity || "");
  const mustInclude = asStringArray(g.must_include).map(foldForMatch);
  const mustExclude = asStringArray(g.must_exclude).map(foldForMatch);
  const out: Record<string, number> = {};

  top.forEach((r, idx) => {
    const blob = foldForMatch([
      r.title || "",
      r.podcast_title || "",
      r.podcast_slug || "",
      r.why_matched || "",
    ].join(" "));
    const excluded = mustExclude.some((term) => term && blob.includes(term));
    let score = excluded ? 0 : 1;

    if (g.expected_podcast_slug && r.podcast_slug === g.expected_podcast_slug) score = Math.max(score, 3);
    if (expectedEntity && blob.includes(expectedEntity)) score = Math.max(score, 3);
    if (mustInclude.length && mustInclude.every((term) => blob.includes(term))) score = Math.max(score, 2);
    if (!mustInclude.length && !expectedEntity && !g.expected_podcast_slug && !excluded) score = 1;
    out[String(idx)] = score;
  });

  return out;
}

function avg(values: number[]) {
  return values.length ? values.reduce((s, n) => s + n, 0) / values.length : null;
}

function percentile(values: number[], p: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
}

async function callSearch(query: string, timeoutMs: number, maxAttempts: number) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/search-hybrid`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}`, apikey: key },
        body: JSON.stringify({ q: query, limit: 10, rerank: true, lang: "hu" }),
        signal: ctrl.signal,
      });
      const text = await res.text();
      let data: unknown = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 240)}`);
      return data as Record<string, unknown>;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await new Promise((r) => setTimeout(r, attempt * 1500));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

async function refreshGoldens(supa: ReturnType<typeof createClient>, controls: Required<Controls>) {
  const [catalog, external] = await Promise.all([
    supa.rpc("refresh_search_golden_queries_from_catalog", {
      p_limit_per_type: controls.catalog_limit_per_type,
      p_popular_limit: controls.popular_limit,
    }),
    supa.rpc("refresh_search_golden_queries_from_external_demand", {
      p_chart_limit: controls.external_chart_limit,
      p_seed_limit: controls.external_seed_limit,
    }),
  ]);
  if (catalog.error) throw catalog.error;
  if (external.error) throw external.error;
  return { catalog: catalog.data, external: external.data };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const startedAt = Date.now();
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });

  try {
    const { data: settings } = await supa
      .from("app_settings")
      .select("value")
      .eq("key", "search_benchmark_controls")
      .maybeSingle();
    const controls: Required<Controls> = { ...DEFAULT_CONTROLS, ...((settings?.value as Controls | null) || {}) };
    controls.batch_size = clampInt(controls.batch_size, DEFAULT_CONTROLS.batch_size, 1, 80);
    controls.max_queries_per_week = clampInt(controls.max_queries_per_week, DEFAULT_CONTROLS.max_queries_per_week, 10, 500);
    controls.per_call_timeout_ms = clampInt(controls.per_call_timeout_ms, DEFAULT_CONTROLS.per_call_timeout_ms, 5_000, 60_000);
    controls.max_attempts = clampInt(controls.max_attempts, DEFAULT_CONTROLS.max_attempts, 1, 3);

    if (controls.enabled === false) {
      const result = { ok: true, skipped: true, reason: "disabled", elapsed_ms: Date.now() - startedAt };
      await supa.from("app_settings").upsert({
        key: "search_benchmark_progress",
        value: { ...result, last_run_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
      return json(result);
    }

    const weekKey = mondayKey();
    const runLabel = `Weekly search benchmark ${weekKey}`;
    let refreshed: unknown = null;

    let { data: run } = await supa
      .from("search_benchmark_runs")
      .select("*")
      .eq("label", runLabel)
      .maybeSingle();

    if (!run) {
      if (controls.refresh_before_new_run) {
        refreshed = await refreshGoldens(supa, controls);
      }

      const { count } = await supa
        .from("search_golden_queries")
        .select("id", { count: "exact", head: true })
        .eq("active", true);
      const queryCount = Math.min(Number(count || 0), controls.max_queries_per_week);

      const inserted = await supa
        .from("search_benchmark_runs")
        .insert({
          label: runLabel,
          engine: "search-hybrid-weekly-v1",
          query_count: queryCount,
          notes: "AUTO_WEEKLY: backend runner processes active golden queries in batches; fetch failures are excluded from quality aggregates.",
        })
        .select("*")
        .single();
      if (inserted.error || !inserted.data) throw inserted.error || new Error("run_insert_failed");
      run = inserted.data;
    }

    const { data: goldens, error: goldenErr } = await supa
      .from("search_golden_queries")
      .select("id, query, query_type, expected_intent, expected_podcast_slug, expected_entity, must_include, must_exclude")
      .eq("active", true)
      .order("query_type")
      .order("sort_order")
      .order("query")
      .limit(controls.max_queries_per_week);
    if (goldenErr) throw goldenErr;

    const { data: existingRows, error: existingErr } = await supa
      .from("search_benchmark_results")
      .select("golden_id")
      .eq("run_id", run.id)
      .limit(controls.max_queries_per_week + 100);
    if (existingErr) throw existingErr;

    const doneIds = new Set((existingRows || []).map((r: any) => r.golden_id));
    const pending = ((goldens || []) as Golden[]).filter((g) => !doneIds.has(g.id));
    const batch = pending.slice(0, controls.batch_size);
    let fetchFailures = 0;
    let processed = 0;

    for (const g of batch) {
      const t0 = performance.now();
      try {
        const data = await callSearch(g.query, controls.per_call_timeout_ms, controls.max_attempts);
        const latency = Math.round(performance.now() - t0);
        const eps = (Array.isArray(data?.episodes) ? data.episodes : []) as Array<Record<string, unknown>>;
        const top = eps.slice(0, 10).map((e: any) => ({
          id: e.id,
          title: e.title || e.display_title || "",
          podcast_title: e.podcasts?.title || e.podcast_title || "",
          podcast_slug: e.podcasts?.slug || e.podcast_slug || "",
          why_matched: e.why_matched || null,
        }));
        const scores = autoScoreTopResults(g, top);
        const metrics = computeMetrics(top, scores);
        const detected = (data?.understanding as any)?.intent || null;
        let intentCorrect: boolean | null = null;
        if (g.expected_intent) {
          intentCorrect = String(detected || "").toLowerCase() === g.expected_intent.toLowerCase()
            || (g.expected_intent === "ambiguous" && !detected);
        }

        const insert = await supa.from("search_benchmark_results").insert({
          run_id: run.id,
          golden_id: g.id,
          query: g.query,
          detected_intent: detected,
          confidence_band: data?.confidence_band || null,
          used_vector: Boolean(data?.semantic),
          used_cohere: Boolean(data?.cohere_used),
          used_hyde: Boolean(data?.hyde_used),
          used_podcast_pin: Boolean(data?.podcast_pin),
          used_must_gate: Boolean(data?.must_gate),
          used_fallback: Boolean(data?.fallback_kind),
          latency_ms: latency,
          result_count: top.length,
          top_results: top,
          raw_meta: {
            status: "ok",
            understanding: data?.understanding || null,
            confidence_band: data?.confidence_band || null,
            timing: data?.timing || null,
            engine: data?.engine || null,
            weekly_runner: true,
          },
          scores,
          precision_at_3: metrics.p3,
          precision_at_5: metrics.p5,
          ndcg_at_10: metrics.ndcg,
          reciprocal_rank: metrics.rr,
          intent_correct: intentCorrect,
          scored_at: new Date().toISOString(),
          notes: "AUTO_WEEKLY_SCORED from expected_podcast_slug / expected_entity / must_include. Manual review can override.",
        });
        if (insert.error) throw insert.error;
      } catch (error) {
        fetchFailures++;
        const latency = Math.round(performance.now() - t0);
        await supa.from("search_benchmark_results").insert({
          run_id: run.id,
          golden_id: g.id,
          query: g.query,
          latency_ms: latency,
          result_count: 0,
          top_results: [],
          raw_meta: { status: "fetch_error", error: error instanceof Error ? error.message : String(error), weekly_runner: true },
          notes: "FETCH_FAILED — excluded from quality metrics",
        });
      }
      processed++;
    }

    const { data: allRows, error: allErr } = await supa
      .from("search_benchmark_results")
      .select("raw_meta, result_count, precision_at_3, precision_at_5, ndcg_at_10, reciprocal_rank, intent_correct, latency_ms, scores, top_results")
      .eq("run_id", run.id)
      .limit(controls.max_queries_per_week + 100);
    if (allErr) throw allErr;

    const rows = (allRows || []) as Array<Record<string, any>>;
    const valid = rows.filter((r) => r.raw_meta?.status !== "fetch_error");
    const scored = valid.filter((r) => r.precision_at_3 != null || r.precision_at_5 != null);
    const latencies = valid.map((r) => Number(r.latency_ms || 0)).filter((n) => n > 0);
    const intentRows = valid.filter((r) => r.intent_correct !== null);
    const falsePositiveRates = scored.map((r) => {
      const top = Array.isArray(r.top_results) ? r.top_results.slice(0, 5) : [];
      const scores = r.scores || {};
      const bad = top.filter((_: unknown, i: number) => Number(scores[String(i)] || 0) === 0).length;
      return bad / Math.max(1, top.length);
    });

    await supa.from("search_benchmark_runs").update({
      precision_at_3: avg(scored.map((r) => Number(r.precision_at_3 || 0))),
      precision_at_5: avg(scored.map((r) => Number(r.precision_at_5 || 0))),
      ndcg_at_10: avg(scored.map((r) => Number(r.ndcg_at_10 || 0))),
      mrr: avg(scored.map((r) => Number(r.reciprocal_rank || 0))),
      intent_accuracy: intentRows.length ? intentRows.filter((r) => r.intent_correct === true).length / intentRows.length : null,
      zero_result_rate: valid.length ? valid.filter((r) => Number(r.result_count || 0) === 0).length / valid.length : null,
      false_positive_rate: avg(falsePositiveRates),
      latency_p50: percentile(latencies, 0.5),
      latency_p95: percentile(latencies, 0.95),
    }).eq("id", run.id);

    const total = Math.min((goldens || []).length, controls.max_queries_per_week);
    const done = rows.length;
    const remaining = Math.max(0, total - done);
    const result = {
      ok: true,
      run_id: run.id,
      label: run.label,
      week_key: weekKey,
      processed,
      fetch_failures: fetchFailures,
      done,
      total,
      remaining,
      completed: remaining === 0,
      refreshed,
      elapsed_ms: Date.now() - startedAt,
      last_run_at: new Date().toISOString(),
    };

    await supa.from("app_settings").upsert({
      key: "search_benchmark_progress",
      value: result,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json(result);
  } catch (error) {
    const result = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      elapsed_ms: Date.now() - startedAt,
      failed_at: new Date().toISOString(),
    };
    await supa.from("app_settings").upsert({
      key: "search_benchmark_progress",
      value: result,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    return json(result, 500);
  }
});
