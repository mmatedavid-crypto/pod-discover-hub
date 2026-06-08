import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import type { Database, Json } from "@/integrations/supabase/types";
import { useNoindex } from "@/lib/useNoindex";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

type Golden = Database["public"]["Tables"]["search_golden_queries"]["Row"];
type Run = Database["public"]["Tables"]["search_benchmark_runs"]["Row"];
type BenchmarkResult = Database["public"]["Tables"]["search_benchmark_results"]["Row"];
type CompetitorResult = Database["public"]["Tables"]["search_benchmark_competitors"]["Row"];
type TopResult = {
  id?: string | null;
  title?: string | null;
  podcast_title?: string | null;
  podcast_slug?: string | null;
  why_matched?: string | null;
  chunk_match?: {
    timestamp_start_seconds?: number | null;
    timestamp_end_seconds?: number | null;
    score?: number | null;
    source?: string | null;
  } | null;
};
type ResultRow = Omit<BenchmarkResult, "top_results" | "scores" | "raw_meta"> & {
  top_results: TopResult[];
  scores: Record<string, number>;
  raw_meta: Json;
};
type CompetitorRow = Omit<CompetitorResult, "top_results"> & {
  top_results: TopResult[];
};
type SearchHybridEpisode = {
  id?: string | null;
  title?: string | null;
  display_title?: string | null;
  podcasts?: { title?: string | null; slug?: string | null } | null;
  podcast_title?: string | null;
  podcast_slug?: string | null;
  why_matched?: string | null;
  chunk_match?: TopResult["chunk_match"];
};
type SearchHybridResponse = {
  episodes?: SearchHybridEpisode[];
  understanding?: { intent?: string | null; [key: string]: Json | undefined } | null;
  confidence_band?: string | null;
  semantic?: boolean | null;
  reranked?: boolean | null;
  cohere_used?: boolean | null;
  hyde_used?: boolean | null;
  podcast_pin?: Json | null;
  must_gate?: boolean | null;
  fallback_kind?: string | null;
  timing?: Json | null;
  engine?: string | null;
  chunk_augmented?: number | null;
};
type SearchHybridMeta = {
  understanding: SearchHybridResponse["understanding"];
  confidence_band: string | null;
  semantic: boolean | null | undefined;
  reranked: boolean | null | undefined;
  cohere_used: boolean | null | undefined;
  hyde_used: boolean | null | undefined;
  podcast_pin: Json | null;
  must_gate: boolean | null | undefined;
  fallback_kind: string | null;
  timing: Json | null;
  engine: string | null;
  timestamp_match_count: number;
  chunk_augmented_count: number;
  status: "ok";
};
type EntityMonitoringCoverage = {
  ok?: boolean;
  policy?: string;
  active_entity_goldens?: number;
  active_entity_query_types?: number;
  query_types?: string[];
  min_entity_goldens?: number;
  min_entity_query_types?: number;
  error?: string;
};
type RunnerProgress = {
  ok?: boolean;
  skipped?: boolean;
  refreshed_at?: string;
  last_run_at?: string;
  completed?: boolean;
  done?: number;
  total?: number;
  remaining?: number;
  timestamp_match_count?: number;
  chunk_augmented_count?: number;
  entity_monitoring_coverage?: EntityMonitoringCoverage;
  refreshed?: {
    entity_monitoring_coverage?: EntityMonitoringCoverage;
  };
};

function pct(n: number | null | undefined) {
  if (n == null) return "—";
  return `${(Number(n) * 100).toFixed(1)}%`;
}
function num(n: number | null | undefined, d = 2) {
  if (n == null) return "—";
  return Number(n).toFixed(d);
}

function dcg(gains: number[]) {
  return gains.reduce((s, g, i) => s + (Math.pow(2, g) - 1) / Math.log2(i + 2), 0);
}
function ndcg(scores: number[], k = 10) {
  const top = scores.slice(0, k);
  const ideal = [...scores].sort((a, b) => b - a).slice(0, k);
  const idcg = dcg(ideal);
  if (!idcg) return 0;
  return dcg(top) / idcg;
}

function computeMetrics(top: TopResult[], scores: Record<string, number>) {
  // score >=2 considered relevant
  const arr = top.map((_, i) => scores[String(i)] ?? null);
  const filled = arr.map((v) => (v == null ? 0 : v));
  const rel = filled.map((v) => (v >= 2 ? 1 : 0));
  const p3 = rel.slice(0, 3).length ? rel.slice(0, 3).reduce((a, b) => a + b, 0) / Math.min(3, top.length || 3) : 0;
  const p5 = rel.slice(0, 5).length ? rel.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, top.length || 5) : 0;
  const ng = ndcg(filled, 10);
  const firstRel = rel.findIndex((x) => x === 1);
  const rr = firstRel === -1 ? 0 : 1 / (firstRel + 1);
  return { p3, p5, ndcg: ng, rr };
}

function asStringArray(value: Json): string[] {
  return Array.isArray(value)
    ? value.map((v) => String(v || "").trim()).filter(Boolean)
    : [];
}

function asScoreMap(value: Json): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, raw]) => [key, Number(raw)])
      .filter(([, score]) => Number.isFinite(score)),
  );
}

function finiteJsonNumber(value: Json | undefined): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function asChunkMatch(value: Json | undefined): TopResult["chunk_match"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return {
    timestamp_start_seconds: finiteJsonNumber(value.timestamp_start_seconds),
    timestamp_end_seconds: finiteJsonNumber(value.timestamp_end_seconds),
    score: finiteJsonNumber(value.score),
    source: typeof value.source === "string" ? value.source : null,
  };
}

function asTopResults(value: Json): TopResult[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, Json> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((item) => ({
      id: typeof item.id === "string" ? item.id : null,
      title: typeof item.title === "string" ? item.title : null,
      podcast_title: typeof item.podcast_title === "string" ? item.podcast_title : null,
      podcast_slug: typeof item.podcast_slug === "string" ? item.podcast_slug : null,
      why_matched: typeof item.why_matched === "string" ? item.why_matched : null,
      chunk_match: asChunkMatch(item.chunk_match),
    }));
}

function asSearchHybridResponse(value: unknown): SearchHybridResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as SearchHybridResponse;
}

function asRunnerProgress(value: unknown): RunnerProgress {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as RunnerProgress;
}

function coverageFromProgress(progress: RunnerProgress | null): EntityMonitoringCoverage | null {
  return progress?.entity_monitoring_coverage || progress?.refreshed?.entity_monitoring_coverage || null;
}

function rawMetaObject(value: Json): Record<string, Json> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json> : {};
}

function timestampStatsFromResults(rows: ResultRow[]) {
  return rows.reduce((acc, row) => {
    const meta = rawMetaObject(row.raw_meta);
    acc.timestampMatches += Number(meta.timestamp_match_count || 0);
    acc.chunkAugmented += Number(meta.chunk_augmented_count || 0);
    if (Number(meta.timestamp_match_count || 0) > 0) acc.timestampQueries += 1;
    if (Number(meta.chunk_augmented_count || 0) > 0) acc.chunkAugmentedQueries += 1;
    return acc;
  }, { timestampMatches: 0, timestampQueries: 0, chunkAugmented: 0, chunkAugmentedQueries: 0 });
}

function formatSeconds(seconds: number | null | undefined) {
  const n = Number(seconds);
  if (!Number.isFinite(n) || n < 0) return null;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const s = Math.floor(n % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function toResultRow(row: BenchmarkResult): ResultRow {
  return {
    ...row,
    top_results: asTopResults(row.top_results),
    scores: asScoreMap(row.scores),
  };
}

function toCompetitorRow(row: CompetitorResult): CompetitorRow {
  return {
    ...row,
    top_results: asTopResults(row.top_results),
  };
}

function foldForMatch(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function autoScoreTopResults(g: Golden, top: TopResult[]): Record<string, number> {
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

export default function AdminSearchBenchmarkPage() {
  useNoindex("Admin · Search benchmark — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [goldens, setGoldens] = useState<Golden[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [results, setResults] = useState<ResultRow[]>([]);
  const [running, setRunning] = useState(false);
  const [refreshingGoldens, setRefreshingGoldens] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [goldenRefreshProgress, setGoldenRefreshProgress] = useState<RunnerProgress | null>(null);
  const [benchmarkProgress, setBenchmarkProgress] = useState<RunnerProgress | null>(null);
  const [filterType, setFilterType] = useState<string>("all");
  const [scoringIdx, setScoringIdx] = useState(0);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) {
        nav("/auth");
        return;
      }
      const { data: hasAdmin } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });
      setIsAdmin(hasAdmin === true);
      if (hasAdmin === true) {
        await refreshAll();
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  async function refreshAll() {
    const [g, r, settings] = await Promise.all([
      supabase.from("search_golden_queries").select("*").eq("active", true).order("query_type").order("sort_order").order("query").limit(500),
      supabase.from("search_benchmark_runs").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("app_settings").select("key,value").in("key", ["search_golden_refresh_progress", "search_benchmark_progress"]),
    ]);
    setGoldens(g.data || []);
    setRuns(r.data || []);
    const byKey = new Map((settings.data || []).map((row) => [row.key, row.value]));
    setGoldenRefreshProgress(asRunnerProgress(byKey.get("search_golden_refresh_progress")));
    setBenchmarkProgress(asRunnerProgress(byKey.get("search_benchmark_progress")));
    if (!activeRunId && r.data && r.data.length) {
      const id = r.data[0].id;
      setActiveRunId(id);
      await loadResults(id);
    }
  }

  async function loadResults(runId: string) {
    const { data } = await supabase
      .from("search_benchmark_results")
      .select("*")
      .eq("run_id", runId)
      .order("query");
    setResults((data || []).map(toResultRow));
  }

  async function refreshGoldensFromCatalog() {
    setRefreshingGoldens(true);
    try {
      const { data, error } = await supabase.functions.invoke("search-golden-refresh", {
        body: { trigger: "admin_search_benchmark_page" },
      });
      if (error) throw error;
      const payload = asRunnerProgress(data);
      if (payload.ok === false) throw new Error(String((data as { error?: unknown })?.error || "search_golden_refresh_failed"));
      const coverage = coverageFromProgress(payload);
      const coverageText = coverage
        ? ` · entity ${coverage.active_entity_goldens ?? "?"}/${coverage.min_entity_goldens ?? "?"}, types ${coverage.active_entity_query_types ?? "?"}/${coverage.min_entity_query_types ?? "?"}`
        : "";
      toast.success(`Golden set frissítve${coverageText}`);
      await refreshAll();
    } catch (e: any) {
      toast.error(`Golden refresh failed: ${e?.message || e}`);
    } finally {
      setRefreshingGoldens(false);
    }
  }

  async function runBenchmark() {
    if (!confirm(`Run benchmark on ${goldens.length} golden queries? This will call search-hybrid once per query and cost ~$0.05-0.20.`)) return;
    setRunning(true);
    setProgress({ done: 0, total: goldens.length });
    const { data: { session } } = await supabase.auth.getSession();
    const { data: runIns, error: runErr } = await supabase
      .from("search_benchmark_runs")
      .insert({ label: `Run ${new Date().toISOString()}`, engine: "search-hybrid", query_count: goldens.length, created_by: session?.user.id || null })
      .select()
      .single();
    if (runErr || !runIns) {
      toast.error("Could not create run: " + runErr?.message);
      setRunning(false);
      return;
    }
    const runId = runIns.id;
    setActiveRunId(runId);

    // Quality-first: low concurrency to avoid edge-fn overload, direct fetch with long
    // timeout + retries on network errors. Earlier runs recorded `FunctionsFetchError`
    // as 0-result — that was a lie; those queries DO return results when called normally.
    const CONCURRENCY = 2;
    const PER_CALL_TIMEOUT_MS = 45_000;
    const MAX_ATTEMPTS = 3;
    let cursor = 0;
    let doneCount = 0;
    const latencies: number[] = [];
    let zeroCount = 0;        // genuine 0 from search-hybrid
    let fetchFailCount = 0;   // network/timeout failures — excluded from quality metrics
    let intentCorrect = 0;
    let intentTotal = 0;

    const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || "https://yoxewklaybougzpmzvkg.supabase.co";
    const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
    const { data: { session: authSession } } = await supabase.auth.getSession();

    async function callSearchOnce(query: string): Promise<{ data: SearchHybridResponse; status: number }> {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), PER_CALL_TIMEOUT_MS);
      try {
        const res = await fetch(`${SUPABASE_URL}/functions/v1/search-hybrid`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${authSession?.access_token || SUPABASE_KEY}`,
          },
          body: JSON.stringify({ q: query, limit: 10, rerank: true, lang: "hu" }),
          signal: ctrl.signal,
        });
        const text = await res.text();
        let parsed: unknown = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* ignore */ }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        return { data: asSearchHybridResponse(parsed), status: res.status };
      } finally {
        clearTimeout(tm);
      }
    }

    async function callWithRetry(query: string) {
      let lastErr: unknown = null;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
          return await callSearchOnce(query);
        } catch (e) {
          lastErr = e;
          // exponential backoff: 1s, 2.5s
          await new Promise((r) => setTimeout(r, attempt * 1500));
        }
      }
      throw lastErr;
    }

    async function worker() {
      while (true) {
        const i = cursor++;
        if (i >= goldens.length) return;
        const g = goldens[i];
        const t0 = performance.now();
        try {
          const { data } = await callWithRetry(g.query);
          const latency = Math.round(performance.now() - t0);
          latencies.push(latency);
          const eps = Array.isArray(data?.episodes) ? data.episodes : [];
          const top: TopResult[] = eps.slice(0, 10).map((e) => ({
            id: e.id,
            title: e.title || e.display_title || "",
            podcast_title: e.podcasts?.title || e.podcast_title || "",
            podcast_slug: e.podcasts?.slug || e.podcast_slug || "",
            why_matched: e.why_matched || null,
            chunk_match: e.chunk_match ? {
              timestamp_start_seconds: Number.isFinite(Number(e.chunk_match.timestamp_start_seconds)) ? Number(e.chunk_match.timestamp_start_seconds) : null,
              timestamp_end_seconds: Number.isFinite(Number(e.chunk_match.timestamp_end_seconds)) ? Number(e.chunk_match.timestamp_end_seconds) : null,
              score: Number.isFinite(Number(e.chunk_match.score)) ? Number(e.chunk_match.score) : null,
              source: e.chunk_match.source || null,
            } : null,
          }));
          const timestampMatchCount = top.filter((e) => Number.isFinite(Number(e.chunk_match?.timestamp_start_seconds))).length;
          const chunkAugmentedCount = Number.isFinite(Number(data?.chunk_augmented)) ? Number(data.chunk_augmented) : 0;
          const autoScores = autoScoreTopResults(g, top);
          const autoMetrics = computeMetrics(top, autoScores);
          const detected = data?.understanding?.intent || null;
          const meta: SearchHybridMeta = {
            understanding: data?.understanding || null,
            confidence_band: data?.confidence_band || null,
            semantic: data?.semantic,
            reranked: data?.reranked,
            cohere_used: data?.cohere_used,
            hyde_used: data?.hyde_used,
            podcast_pin: data?.podcast_pin || null,
            must_gate: data?.must_gate,
            fallback_kind: data?.fallback_kind || null,
            timing: data?.timing || null,
            engine: data?.engine || null,
            timestamp_match_count: timestampMatchCount,
            chunk_augmented_count: chunkAugmentedCount,
            status: "ok",
          };
          let intent_correct: boolean | null = null;
          if (g.expected_intent) {
            intentTotal++;
            const ok = (detected || "").toLowerCase() === g.expected_intent.toLowerCase()
              || (g.expected_intent === "ambiguous" && !detected);
            if (ok) intentCorrect++;
            intent_correct = ok;
          }
          if (top.length === 0) zeroCount++;
          await supabase.from("search_benchmark_results").insert({
            run_id: runId,
            golden_id: g.id,
            query: g.query,
            detected_intent: detected,
            confidence_band: data?.confidence_band || null,
            used_vector: !!data?.semantic,
            used_cohere: !!data?.cohere_used,
            used_hyde: !!data?.hyde_used,
            used_podcast_pin: !!data?.podcast_pin,
            used_must_gate: !!data?.must_gate,
            used_fallback: !!data?.fallback_kind,
            latency_ms: latency,
            result_count: top.length,
            top_results: top,
            raw_meta: meta,
            scores: autoScores,
            precision_at_3: autoMetrics.p3,
            precision_at_5: autoMetrics.p5,
            ndcg_at_10: autoMetrics.ndcg,
            reciprocal_rank: autoMetrics.rr,
            intent_correct,
            scored_at: new Date().toISOString(),
            notes: "AUTO_SCORED from expected_podcast_slug / expected_entity / must_include. Manual review can override.",
          });
        } catch (e) {
          const latency = Math.round(performance.now() - t0);
          fetchFailCount++;
          await supabase.from("search_benchmark_results").insert({
            run_id: runId,
            golden_id: g.id,
            query: g.query,
            latency_ms: latency,
            result_count: 0,
            top_results: [],
            raw_meta: { status: "fetch_error", error: String(e) },
            notes: "FETCH_FAILED — excluded from quality metrics",
          });
        }
        doneCount++;
        setProgress({ done: doneCount, total: goldens.length });
      }
    }

    await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

    const sorted = [...latencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)] || 0;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0;
    const validCount = goldens.length - fetchFailCount;
    await supabase.from("search_benchmark_runs").update({
      // zero_result_rate now reflects ONLY successful calls
      zero_result_rate: validCount > 0 ? zeroCount / validCount : 0,
      intent_accuracy: intentTotal ? intentCorrect / intentTotal : null,
      latency_p50: p50,
      latency_p95: p95,
    }).eq("id", runId);

    if (fetchFailCount > 0) {
      toast.warning(`Benchmark done — ${doneCount} queries · ${fetchFailCount} fetch-fail (excluded) · p50 ${p50}ms, p95 ${p95}ms`);
    } else {
      toast.success(`Benchmark done — ${doneCount} queries, p50 ${p50}ms, p95 ${p95}ms`);
    }
    setRunning(false);
    await refreshAll();
    await loadResults(runId);
  }

  async function setScore(r: ResultRow, idx: number, score: number) {
    const next = { ...(r.scores || {}), [String(idx)]: score };
    const m = computeMetrics(r.top_results || [], next);
    await supabase.from("search_benchmark_results").update({
      scores: next,
      precision_at_3: m.p3,
      precision_at_5: m.p5,
      ndcg_at_10: m.ndcg,
      reciprocal_rank: m.rr,
      scored_at: new Date().toISOString(),
    }).eq("id", r.id);
    setResults((prev) => prev.map((x) => x.id === r.id ? { ...x, scores: next, precision_at_3: m.p3, precision_at_5: m.p5, ndcg_at_10: m.ndcg, reciprocal_rank: m.rr } : x));
  }

  async function recomputeRunAggregates() {
    if (!activeRunId) return;
    const scored = results.filter((r) => Object.keys(r.scores || {}).length > 0);
    if (!scored.length) {
      toast.error("No scored queries yet.");
      return;
    }
    const avg = (k: keyof ResultRow) => scored.reduce((s, r) => s + (Number(r[k]) || 0), 0) / scored.length;
    const intent = results.filter((r) => r.intent_correct !== null);
    const intentAcc = intent.length ? intent.filter((r) => r.intent_correct).length / intent.length : null;
    const zero = results.length ? results.filter((r) => r.result_count === 0).length / results.length : 0;
    // false positive in top 5 = score 0 in top 5 of any scored result, averaged
    const fp = scored.reduce((s, r) => {
      const top5 = (r.top_results || []).slice(0, 5);
      const bad = top5.filter((_, i) => (r.scores[String(i)] ?? 0) === 0).length;
      return s + bad / Math.max(1, top5.length);
    }, 0) / Math.max(1, scored.length);
    await supabase.from("search_benchmark_runs").update({
      precision_at_3: avg("precision_at_3"),
      precision_at_5: avg("precision_at_5"),
      ndcg_at_10: avg("ndcg_at_10"),
      mrr: avg("reciprocal_rank"),
      intent_accuracy: intentAcc,
      zero_result_rate: zero,
      false_positive_rate: fp,
    }).eq("id", activeRunId);
    toast.success("Aggregates updated.");
    await refreshAll();
  }

  const goldenByType = useMemo(() => {
    const m = new Map<string, number>();
    goldens.forEach((g) => m.set(g.query_type, (m.get(g.query_type) || 0) + 1));
    return Array.from(m.entries()).sort((a, b) => b[1] - a[1]);
  }, [goldens]);

  const filteredResults = useMemo(() => {
    if (filterType === "all") return results;
    if (filterType === "unscored") return results.filter((r) => !Object.keys(r.scores || {}).length);
    if (filterType === "zero") return results.filter((r) => r.result_count === 0);
    if (filterType === "worst") return [...results].filter((r) => r.precision_at_5 != null).sort((a, b) => (a.precision_at_5 || 0) - (b.precision_at_5 || 0)).slice(0, 25);
    if (filterType === "best") return [...results].filter((r) => r.precision_at_5 != null).sort((a, b) => (b.precision_at_5 || 0) - (a.precision_at_5 || 0)).slice(0, 25);
    return results;
  }, [results, filterType]);

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Not authorized.</div></Layout>;

  const activeRun = runs.find((r) => r.id === activeRunId);
  const entityCoverage = coverageFromProgress(benchmarkProgress) || coverageFromProgress(goldenRefreshProgress);
  const transcriptStats = timestampStatsFromResults(results);

  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-3xl font-semibold">Search benchmark</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {goldens.length} golden queries · {runs.length} runs stored
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={refreshGoldensFromCatalog}
              disabled={running || refreshingGoldens}
              className="px-4 py-2 rounded-md border border-border text-sm disabled:opacity-50"
            >
              {refreshingGoldens ? "Refreshing…" : "Refresh demand goldens"}
            </button>
            <button
              onClick={runBenchmark}
              disabled={running || goldens.length === 0}
              className="px-4 py-2 rounded-md bg-foreground text-background text-sm font-medium disabled:opacity-50"
            >
              {running ? `Running… ${progress.done}/${progress.total}` : "Run new benchmark"}
            </button>
            {activeRunId && (
              <button
                onClick={recomputeRunAggregates}
                className="px-4 py-2 rounded-md border border-border text-sm"
              >
                Recompute aggregates
              </button>
            )}
          </div>
        </div>

        <Tabs defaultValue="run" className="w-full">
          <TabsList>
            <TabsTrigger value="run">Run & metrics</TabsTrigger>
            <TabsTrigger value="score">Score results</TabsTrigger>
            <TabsTrigger value="competitors">Competitors</TabsTrigger>
            <TabsTrigger value="golden">Golden set</TabsTrigger>
          </TabsList>

          {/* === RUN & METRICS === */}
          <TabsContent value="run" className="space-y-4 mt-4">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
              <Stat label="Queries" value={String(activeRun?.query_count ?? "—")} />
              <Stat label="P@3" value={pct(activeRun?.precision_at_3)} />
              <Stat label="P@5" value={pct(activeRun?.precision_at_5)} />
              <Stat label="NDCG@10" value={num(activeRun?.ndcg_at_10)} />
              <Stat label="MRR" value={num(activeRun?.mrr)} />
              <Stat label="Intent acc" value={pct(activeRun?.intent_accuracy)} />
              <Stat label="Zero-result" value={pct(activeRun?.zero_result_rate)} />
              <Stat label="P95 latency" value={activeRun?.latency_p95 ? `${Math.round(activeRun.latency_p95)}ms` : "—"} />
            </div>
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Stat label="Timestamp hits" value={String(benchmarkProgress?.timestamp_match_count ?? transcriptStats.timestampMatches)} />
              <Stat label="Timestamp queries" value={String(transcriptStats.timestampQueries)} />
              <Stat label="Chunk augmented" value={String(benchmarkProgress?.chunk_augmented_count ?? transcriptStats.chunkAugmented)} />
              <Stat label="Augmented queries" value={String(transcriptStats.chunkAugmentedQueries)} />
            </div>

            <section className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Entity monitoring coverage</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Managed B2B entity goldens after the latest automated refresh or weekly benchmark refresh.
                  </p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-medium ${entityCoverage?.ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-amber-500/15 text-amber-700 dark:text-amber-300"}`}>
                  {entityCoverage ? (entityCoverage.ok ? "OK" : "Needs attention") : "No progress yet"}
                </span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                <Stat label="Entity goldens" value={entityCoverage ? `${entityCoverage.active_entity_goldens ?? "?"}/${entityCoverage.min_entity_goldens ?? "?"}` : "—"} />
                <Stat label="Query types" value={entityCoverage ? `${entityCoverage.active_entity_query_types ?? "?"}/${entityCoverage.min_entity_query_types ?? "?"}` : "—"} />
                <Stat label="Golden refresh" value={goldenRefreshProgress?.refreshed_at ? new Date(goldenRefreshProgress.refreshed_at).toLocaleString() : "—"} />
                <Stat label="Benchmark" value={benchmarkProgress?.last_run_at ? new Date(benchmarkProgress.last_run_at).toLocaleString() : "—"} />
              </div>
              {entityCoverage?.query_types?.length ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {entityCoverage.query_types.map((type) => <span key={type} className="rounded-full bg-secondary px-2 py-1">{type}</span>)}
                </div>
              ) : null}
              {entityCoverage?.error ? <p className="mt-3 text-xs text-destructive">{entityCoverage.error}</p> : null}
            </section>

            <section>
              <h2 className="font-semibold mb-2">Run history</h2>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-xs">
                  <thead className="bg-secondary">
                    <tr>
                      <th className="px-3 py-2 text-left">When</th>
                      <th className="px-3 py-2 text-right">Q</th>
                      <th className="px-3 py-2 text-right">P@5</th>
                      <th className="px-3 py-2 text-right">NDCG</th>
                      <th className="px-3 py-2 text-right">MRR</th>
                      <th className="px-3 py-2 text-right">Intent</th>
                      <th className="px-3 py-2 text-right">Zero</th>
                      <th className="px-3 py-2 text-right">FP</th>
                      <th className="px-3 py-2 text-right">P50</th>
                      <th className="px-3 py-2 text-right">P95</th>
                      <th className="px-3 py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runs.map((r) => (
                      <tr key={r.id} className={`border-t border-border ${r.id === activeRunId ? "bg-muted/40" : ""}`}>
                        <td className="px-3 py-2">{new Date(r.created_at).toLocaleString()}</td>
                        <td className="px-3 py-2 text-right">{r.query_count}</td>
                        <td className="px-3 py-2 text-right">{pct(r.precision_at_5)}</td>
                        <td className="px-3 py-2 text-right">{num(r.ndcg_at_10)}</td>
                        <td className="px-3 py-2 text-right">{num(r.mrr)}</td>
                        <td className="px-3 py-2 text-right">{pct(r.intent_accuracy)}</td>
                        <td className="px-3 py-2 text-right">{pct(r.zero_result_rate)}</td>
                        <td className="px-3 py-2 text-right">{pct(r.false_positive_rate)}</td>
                        <td className="px-3 py-2 text-right">{r.latency_p50 ? `${Math.round(r.latency_p50)}ms` : "—"}</td>
                        <td className="px-3 py-2 text-right">{r.latency_p95 ? `${Math.round(r.latency_p95)}ms` : "—"}</td>
                        <td className="px-3 py-2 text-right">
                          <button className="text-xs underline" onClick={() => { setActiveRunId(r.id); loadResults(r.id); setScoringIdx(0); }}>Open</button>
                        </td>
                      </tr>
                    ))}
                    {runs.length === 0 && <tr><td colSpan={11} className="px-3 py-6 text-center text-muted-foreground">No runs yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </section>
          </TabsContent>

          {/* === SCORE === */}
          <TabsContent value="score" className="space-y-4 mt-4">
            {!activeRunId ? <p className="text-muted-foreground">Run a benchmark first.</p> : (
              <>
                <div className="flex gap-2 flex-wrap items-center">
                  {["all", "unscored", "zero", "worst", "best"].map((f) => (
                    <button key={f} onClick={() => { setFilterType(f); setScoringIdx(0); }} className={`px-2.5 py-1 rounded-full border text-xs ${filterType === f ? "bg-foreground text-background border-foreground" : "bg-card border-border"}`}>{f}</button>
                  ))}
                  <span className="text-xs text-muted-foreground ml-2">{filteredResults.length} queries</span>
                  <div className="ml-auto flex gap-2">
                    <button className="px-2 py-1 text-xs border border-border rounded" onClick={() => setScoringIdx(Math.max(0, scoringIdx - 1))}>← Prev</button>
                    <span className="text-xs self-center">{filteredResults.length ? `${scoringIdx + 1}/${filteredResults.length}` : "0/0"}</span>
                    <button className="px-2 py-1 text-xs border border-border rounded" onClick={() => setScoringIdx(Math.min(filteredResults.length - 1, scoringIdx + 1))}>Next →</button>
                  </div>
                </div>

                {filteredResults[scoringIdx] && (
                  <ResultScorer
                    r={filteredResults[scoringIdx]}
                    golden={goldens.find((g) => g.id === filteredResults[scoringIdx].golden_id)}
                    onScore={(idx, s) => setScore(filteredResults[scoringIdx], idx, s)}
                  />
                )}
              </>
            )}
          </TabsContent>

          {/* === COMPETITORS === */}
          <TabsContent value="competitors" className="mt-4">
            <CompetitorSection goldens={goldens} />
          </TabsContent>

          {/* === GOLDEN === */}
          <TabsContent value="golden" className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2 text-xs">
              {goldenByType.map(([t, n]) => (
                <span key={t} className="px-2 py-1 rounded-full bg-secondary">{t}: {n}</span>
              ))}
            </div>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-secondary"><tr>
                  <th className="px-3 py-2 text-left">Query</th>
                  <th className="px-3 py-2 text-left">Type</th>
                  <th className="px-3 py-2 text-left">Expected intent</th>
                  <th className="px-3 py-2 text-left">Expected entity</th>
                  <th className="px-3 py-2 text-left">Notes</th>
                </tr></thead>
                <tbody>
                  {goldens.map((g) => (
                    <tr key={g.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{g.query}</td>
                      <td className="px-3 py-2">{g.query_type}</td>
                      <td className="px-3 py-2">{g.expected_intent || "—"}</td>
                      <td className="px-3 py-2">{g.expected_entity || "—"}</td>
                      <td className="px-3 py-2 text-muted-foreground">{g.notes || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </Layout>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3 rounded-lg border border-border bg-card">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}

function ResultScorer({ r, golden, onScore }: { r: ResultRow; golden?: Golden; onScore: (idx: number, s: number) => void }) {
  const m = computeMetrics(r.top_results || [], r.scores || {});
  return (
    <div className="rounded-lg border border-border p-4 space-y-3 bg-card">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <div className="text-xl font-semibold">{r.query}</div>
          <div className="text-xs text-muted-foreground mt-1">
            type: {golden?.query_type || "?"} · expected intent: <strong>{golden?.expected_intent || "—"}</strong>
            {golden?.expected_entity && <> · expects: <strong>{golden.expected_entity}</strong></>}
          </div>
        </div>
        <div className="text-xs text-right">
          detected: <strong>{r.detected_intent || "—"}</strong> · {r.confidence_band || "—"}<br/>
          {r.used_vector && "vec "}{r.used_cohere && "cohere "}{r.used_hyde && "hyde "}{r.used_podcast_pin && "pin "}{r.used_must_gate && "gate "}{r.used_fallback && "fb "}
          · {r.latency_ms}ms
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
        <Stat label="P@3" value={(m.p3 * 100).toFixed(0) + "%"} />
        <Stat label="P@5" value={(m.p5 * 100).toFixed(0) + "%"} />
        <Stat label="NDCG@10" value={m.ndcg.toFixed(2)} />
        <Stat label="RR" value={m.rr.toFixed(2)} />
      </div>

      {r.top_results.length === 0 && <div className="text-sm text-muted-foreground italic">Zero results.</div>}

      <ol className="space-y-2">
        {r.top_results.map((ep, i) => {
          const s = r.scores?.[String(i)];
          const timestamp = formatSeconds(ep.chunk_match?.timestamp_start_seconds);
          return (
            <li key={i} className="rounded-md border border-border p-3 flex items-start gap-3">
              <div className="text-sm font-mono w-6 text-muted-foreground">{i + 1}.</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{ep.title}</div>
                <div className="text-xs text-muted-foreground truncate">{ep.podcast_title}</div>
                {ep.why_matched && <div className="text-[11px] text-muted-foreground mt-1 italic">{ep.why_matched}</div>}
                {timestamp && (
                  <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                    <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-700 dark:text-emerald-300">
                      transcript @{timestamp}
                    </span>
                    {ep.chunk_match?.source ? <span className="rounded-full bg-secondary px-2 py-0.5">{ep.chunk_match.source}</span> : null}
                  </div>
                )}
              </div>
              <div className="flex gap-1">
                {[0, 1, 2, 3].map((sv) => (
                  <button
                    key={sv}
                    onClick={() => onScore(i, sv)}
                    className={`w-8 h-8 rounded text-sm font-semibold border ${s === sv ? "bg-foreground text-background border-foreground" : "bg-card border-border"}`}
                    title={["Irrelevant", "Weak", "Partial", "Highly relevant"][sv]}
                  >
                    {sv}
                  </button>
                ))}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function CompetitorSection({ goldens }: { goldens: Golden[] }) {
  const [goldenId, setGoldenId] = useState<string>("");
  const [source, setSource] = useState<string>("spotify");
  const [pasted, setPasted] = useState("");
  const [rows, setRows] = useState<CompetitorRow[]>([]);

  async function load() {
    if (!goldenId) return setRows([]);
    const { data } = await supabase.from("search_benchmark_competitors").select("*").eq("golden_id", goldenId).order("collected_at", { ascending: false });
    setRows((data || []).map(toCompetitorRow));
  }
  useEffect(() => { load(); }, [goldenId]);

  async function save() {
    if (!goldenId || !pasted.trim()) return;
    const lines = pasted.split("\n").map((l) => l.trim()).filter(Boolean);
    const top = lines.slice(0, 10).map((l) => ({ title: l }));
    await supabase.from("search_benchmark_competitors").insert({ golden_id: goldenId, source, top_results: top });
    setPasted("");
    toast.success("Saved.");
    await load();
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">Paste competitor results (one title per line) for blind-relevance scoring. Manual collection only.</p>
      <div className="flex flex-wrap gap-2 items-end">
        <label className="text-xs flex flex-col">
          Query
          <select value={goldenId} onChange={(e) => setGoldenId(e.target.value)} className="border border-border rounded p-1 min-w-[260px]">
            <option value="">— pick —</option>
            {goldens.map((g) => <option key={g.id} value={g.id}>{g.query}</option>)}
          </select>
        </label>
        <label className="text-xs flex flex-col">
          Source
          <select value={source} onChange={(e) => setSource(e.target.value)} className="border border-border rounded p-1">
            <option value="spotify">Spotify</option>
            <option value="apple">Apple</option>
            <option value="google">Google</option>
            <option value="youtube">YouTube</option>
            <option value="other">Other</option>
          </select>
        </label>
        <button onClick={save} className="px-3 py-1.5 rounded bg-foreground text-background text-sm">Save</button>
      </div>
      <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Top 10 titles, one per line" className="w-full h-32 p-2 border border-border rounded text-sm" />
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.id} className="rounded-md border border-border p-3 text-sm">
            <div className="font-medium">{r.source} · {new Date(r.collected_at).toLocaleString()}</div>
            <ol className="list-decimal pl-5 mt-1 text-xs text-muted-foreground">
              {r.top_results.map((t, i) => <li key={i}>{t.title}</li>)}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
