import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useNoindex } from "@/lib/useNoindex";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

type Golden = {
  id: string;
  query: string;
  query_type: string;
  expected_intent: string | null;
  expected_podcast_slug: string | null;
  expected_entity: string | null;
  must_include: any;
  must_exclude: any;
  notes: string | null;
  active: boolean;
};

type Run = {
  id: string;
  label: string | null;
  created_at: string;
  query_count: number;
  precision_at_3: number | null;
  precision_at_5: number | null;
  ndcg_at_10: number | null;
  mrr: number | null;
  zero_result_rate: number | null;
  intent_accuracy: number | null;
  latency_p50: number | null;
  latency_p95: number | null;
};

type ResultRow = {
  id: string;
  run_id: string;
  golden_id: string;
  query: string;
  detected_intent: string | null;
  confidence_band: string | null;
  used_vector: boolean | null;
  used_cohere: boolean | null;
  used_hyde: boolean | null;
  used_podcast_pin: boolean | null;
  used_must_gate: boolean | null;
  used_fallback: boolean | null;
  latency_ms: number | null;
  result_count: number;
  top_results: any[];
  raw_meta: any;
  scores: Record<string, number>;
  precision_at_3: number | null;
  precision_at_5: number | null;
  ndcg_at_10: number | null;
  reciprocal_rank: number | null;
  intent_correct: boolean | null;
  notes: string | null;
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

function computeMetrics(top: any[], scores: Record<string, number>) {
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

function asStringArray(value: any): string[] {
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

function autoScoreTopResults(g: Golden, top: any[]): Record<string, number> {
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
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" });
      setIsAdmin(hasAdmin === true);
      if (hasAdmin === true) {
        await refreshAll();
      }
      setReady(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav]);

  async function refreshAll() {
    const [g, r] = await Promise.all([
      supabase.from("search_golden_queries").select("*").eq("active", true).order("query_type").order("sort_order").order("query").limit(500),
      supabase.from("search_benchmark_runs").select("*").order("created_at", { ascending: false }).limit(50),
    ]);
    setGoldens((g.data as Golden[]) || []);
    setRuns((r.data as Run[]) || []);
    if (!activeRunId && r.data && r.data.length) {
      const id = (r.data[0] as any).id as string;
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
    setResults((data as ResultRow[]) || []);
  }

  async function refreshGoldensFromCatalog() {
    setRefreshingGoldens(true);
    try {
      const { data, error } = await (supabase as any).rpc("refresh_search_golden_queries_from_catalog", {
        p_limit_per_type: 50,
        p_popular_limit: 50,
      });
      if (error) throw error;
      toast.success(`Golden set frissítve: ${data?.upserted ?? "?"} upsert`);
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
    const runId = (runIns as any).id as string;
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

    const SUPABASE_URL = (import.meta as any).env?.VITE_SUPABASE_URL as string;
    const SUPABASE_KEY = (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY as string;
    const { data: { session: authSession } } = await supabase.auth.getSession();

    async function callSearchOnce(query: string): Promise<{ data: any; status: number }> {
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
        let data: any = null;
        try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        return { data, status: res.status };
      } finally {
        clearTimeout(tm);
      }
    }

    async function callWithRetry(query: string) {
      let lastErr: any = null;
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
          const eps = (data?.episodes || []) as any[];
          const top = eps.slice(0, 10).map((e: any) => ({
            id: e.id,
            title: e.title || e.display_title || "",
            podcast_title: e.podcasts?.title || e.podcast_title || "",
            podcast_slug: e.podcasts?.slug || e.podcast_slug || "",
            why_matched: e.why_matched || null,
          }));
          const autoScores = autoScoreTopResults(g, top);
          const autoMetrics = computeMetrics(top, autoScores);
          const detected = data?.understanding?.intent || null;
          const meta = {
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
      const bad = top5.filter((_: any, i: number) => (r.scores[String(i)] ?? 0) === 0).length;
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
              {refreshingGoldens ? "Refreshing…" : "Refresh goldens from catalog"}
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
                        <td className="px-3 py-2 text-right">{pct((r as any).false_positive_rate)}</td>
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
        {r.top_results.map((ep: any, i: number) => {
          const s = r.scores?.[String(i)];
          return (
            <li key={i} className="rounded-md border border-border p-3 flex items-start gap-3">
              <div className="text-sm font-mono w-6 text-muted-foreground">{i + 1}.</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{ep.title}</div>
                <div className="text-xs text-muted-foreground truncate">{ep.podcast_title}</div>
                {ep.why_matched && <div className="text-[11px] text-muted-foreground mt-1 italic">{ep.why_matched}</div>}
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
  const [rows, setRows] = useState<any[]>([]);

  async function load() {
    if (!goldenId) return setRows([]);
    const { data } = await supabase.from("search_benchmark_competitors").select("*").eq("golden_id", goldenId).order("collected_at", { ascending: false });
    setRows(data || []);
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
              {(r.top_results || []).map((t: any, i: number) => <li key={i}>{t.title}</li>)}
            </ol>
          </div>
        ))}
      </div>
    </div>
  );
}
