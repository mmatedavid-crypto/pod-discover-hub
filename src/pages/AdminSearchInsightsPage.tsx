import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useNoindex } from "@/lib/useNoindex";

type SearchEvent = Database["public"]["Tables"]["search_events"]["Row"];
type Row = Pick<SearchEvent,
  | "id"
  | "query"
  | "terms_count"
  | "result_count"
  | "fallback_used"
  | "timestamp_match_count"
  | "chunk_augmented_count"
  | "confidence_band"
  | "semantic_used"
  | "reranked"
  | "podcast_pin_slug"
  | "person_pin_slug"
  | "organization_pin_slug"
  | "topic_pin_slug"
  | "catalog_anchors"
  | "anchor_episode_candidates"
  | "natural_question"
  | "natural_question_fallback"
  | "degraded_for_latency"
  | "timing"
  | "created_at"
>;

export default function AdminSearchInsightsPage() {
  useNoindex("Admin · Search insights — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [windowDays, setWindowDays] = useState<1 | 7 | 30>(7);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: hasAdmin } = await supabase.rpc("has_role", { _user_id: uid, _role: "admin" });
      setIsAdmin(hasAdmin === true);
      if (hasAdmin === true) {
        const since = new Date(Date.now() - windowDays * 86400_000).toISOString();
        const { data: r } = await supabase
          .from("search_events")
          .select("id,query,terms_count,result_count,fallback_used,timestamp_match_count,chunk_augmented_count,confidence_band,semantic_used,reranked,podcast_pin_slug,person_pin_slug,organization_pin_slug,topic_pin_slug,catalog_anchors,anchor_episode_candidates,natural_question,natural_question_fallback,degraded_for_latency,timing,created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: false })
          .limit(5000);
        setRows((r as Row[]) || []);
      }
      setReady(true);
    })();
  }, [nav, windowDays]);

  const stats = useMemo(() => {
    const total = rows.length;
    const zero = rows.filter((r) => r.result_count === 0).length;
    const fallback = rows.filter((r) => r.fallback_used).length;
    const avg = total ? rows.reduce((s, r) => s + r.result_count, 0) / total : 0;
    const low = rows.filter((r) => r.confidence_band === "low").length;
    const degraded = rows.filter((r) => r.degraded_for_latency).length;
    const natural = rows.filter((r) => r.natural_question).length;
    const nlqFallback = rows.filter((r) => r.natural_question_fallback).length;
    const timestamped = rows.filter((r) => Number(r.timestamp_match_count || 0) > 0).length;
    const timestampedResults = rows.reduce((sum, r) => sum + Number(r.timestamp_match_count || 0), 0);
    const chunkAugmented = rows.filter((r) => Number(r.chunk_augmented_count || 0) > 0).length;
    const chunkAugmentedResults = rows.reduce((sum, r) => sum + Number(r.chunk_augmented_count || 0), 0);
    const pins = {
      podcast: rows.filter((r) => r.podcast_pin_slug).length,
      person: rows.filter((r) => r.person_pin_slug).length,
      organization: rows.filter((r) => r.organization_pin_slug).length,
      topic: rows.filter((r) => r.topic_pin_slug).length,
    };

    const byQuery = new Map<string, { q: string; n: number; zero: number; avg: number; fallback: number; low: number; pin: number; nlq: number; degraded: number; timestamped: number; chunkAugmented: number }>();
    rows.forEach((r) => {
      const k = r.query.trim().toLowerCase();
      const cur = byQuery.get(k) || { q: r.query, n: 0, zero: 0, avg: 0, fallback: 0, low: 0, pin: 0, nlq: 0, degraded: 0, timestamped: 0, chunkAugmented: 0 };
      cur.n++;
      cur.avg += r.result_count;
      if (r.result_count === 0) cur.zero++;
      if (r.fallback_used) cur.fallback++;
      if (r.confidence_band === "low") cur.low++;
      if (r.podcast_pin_slug || r.person_pin_slug || r.organization_pin_slug || r.topic_pin_slug) cur.pin++;
      if (r.natural_question) cur.nlq++;
      if (r.degraded_for_latency) cur.degraded++;
      cur.timestamped += Number(r.timestamp_match_count || 0);
      cur.chunkAugmented += Number(r.chunk_augmented_count || 0);
      byQuery.set(k, cur);
    });
    const top = Array.from(byQuery.values()).map((x) => ({ ...x, avg: x.avg / x.n })).sort((a, b) => b.n - a.n);
    const zeroQueries = top.filter((x) => x.zero > 0).sort((a, b) => b.zero - a.zero);
    const weakQueries = top.filter((x) => x.low > 0 || x.degraded > 0).sort((a, b) => (b.low + b.degraded) - (a.low + a.degraded));
    const aliasCandidates = top
      .filter((x) => x.n >= 1 && x.pin === 0 && (x.zero > 0 || x.low > 0 || x.avg < 3))
      .slice(0, 50);
    const timestampQueries = top.filter((x) => x.timestamped > 0 || x.chunkAugmented > 0).sort((a, b) => (b.timestamped + b.chunkAugmented) - (a.timestamped + a.chunkAugmented));
    return { total, zero, fallback, avg, low, degraded, natural, nlqFallback, timestamped, timestampedResults, chunkAugmented, chunkAugmentedResults, pins, top, zeroQueries, weakQueries, aliasCandidates, timestampQueries };
  }, [rows]);

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Not authorized.</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-10 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-3xl font-semibold">Search insights</h1>
          <div className="flex gap-2 text-xs">
            {([1, 7, 30] as const).map((d) => (
              <button key={d} onClick={() => setWindowDays(d)} className={`px-2.5 py-1 rounded-full border ${windowDays === d ? "bg-foreground text-background border-foreground" : "bg-card border-border"}`}>
                Last {d}d
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total searches" value={stats.total.toLocaleString()} />
          <Stat label="Zero-result" value={`${stats.zero} (${pct(stats.zero, stats.total)}%)`} />
          <Stat label="Fallback used" value={`${stats.fallback} (${pct(stats.fallback, stats.total)}%)`} />
          <Stat label="Avg results" value={stats.avg.toFixed(1)} />
          <Stat label="Low confidence" value={`${stats.low} (${pct(stats.low, stats.total)}%)`} />
          <Stat label="Latency degraded" value={`${stats.degraded} (${pct(stats.degraded, stats.total)}%)`} />
          <Stat label="Natural questions" value={`${stats.natural} (${pct(stats.natural, stats.total)}%)`} />
          <Stat label="NLQ fallback" value={`${stats.nlqFallback} (${pct(stats.nlqFallback, Math.max(stats.natural, 1))}%)`} />
          <Stat label="Timestamped searches" value={`${stats.timestamped} (${pct(stats.timestamped, stats.total)}%)`} />
          <Stat label="Timestamp hits" value={String(stats.timestampedResults)} />
          <Stat label="Chunk-augmented" value={`${stats.chunkAugmented} (${pct(stats.chunkAugmented, stats.total)}%)`} />
          <Stat label="Chunk added hits" value={String(stats.chunkAugmentedResults)} />
        </div>

        <section>
          <h2 className="font-semibold mb-2">Entity pins</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Podcast pins" value={String(stats.pins.podcast)} />
            <Stat label="Person pins" value={String(stats.pins.person)} />
            <Stat label="Organization pins" value={String(stats.pins.organization)} />
            <Stat label="Topic pins" value={String(stats.pins.topic)} />
          </div>
        </section>

        <section>
          <h2 className="font-semibold mb-2">Top queries</h2>
          <Table rows={stats.top.slice(0, 50)} />
        </section>

        <section>
          <h2 className="font-semibold mb-2">Zero-result queries</h2>
          {stats.zeroQueries.length === 0 ? (
            <p className="text-sm text-muted-foreground">None — every query returned at least one result.</p>
          ) : (
            <Table rows={stats.zeroQueries.slice(0, 50)} />
          )}
        </section>

        <section>
          <h2 className="font-semibold mb-2">Weak / degraded queries</h2>
          {stats.weakQueries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No low-confidence or degraded queries in this window.</p>
          ) : (
            <Table rows={stats.weakQueries.slice(0, 50)} />
          )}
        </section>

        <section>
          <h2 className="font-semibold mb-2">Timestamp / chunk retrieval queries</h2>
          {stats.timestampQueries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No timestamped chunk retrieval in this window yet.</p>
          ) : (
            <Table rows={stats.timestampQueries.slice(0, 50)} />
          )}
        </section>

        <section>
          <h2 className="font-semibold mb-2">Likely missing aliases / anchors</h2>
          {stats.aliasCandidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">No obvious alias gaps in this window.</p>
          ) : (
            <Table rows={stats.aliasCandidates.slice(0, 50)} />
          )}
        </section>
      </div>
    </Layout>
  );
}

function pct(a: number, b: number) { return b ? Math.round((a / b) * 100) : 0; }

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-4 rounded-lg border border-border bg-card">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  );
}

function Table({ rows }: { rows: { q: string; n: number; zero: number; avg: number; fallback: number; low?: number; pin?: number; nlq?: number; degraded?: number; timestamped?: number; chunkAugmented?: number }[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-secondary text-xs">
          <tr>
            <th className="text-left px-3 py-2">Query</th>
            <th className="text-right px-3 py-2">Searches</th>
            <th className="text-right px-3 py-2">Avg results</th>
            <th className="text-right px-3 py-2">Zero</th>
            <th className="text-right px-3 py-2">Fallback</th>
            <th className="text-right px-3 py-2">Low</th>
            <th className="text-right px-3 py-2">Pins</th>
            <th className="text-right px-3 py-2">NLQ</th>
            <th className="text-right px-3 py-2">Degraded</th>
            <th className="text-right px-3 py-2">Time hits</th>
            <th className="text-right px-3 py-2">Chunk add</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.q} className="border-t border-border">
              <td className="px-3 py-2"><a href={`/kereses?q=${encodeURIComponent(r.q)}`} className="hover:underline">{r.q}</a></td>
              <td className="px-3 py-2 text-right">{r.n}</td>
              <td className="px-3 py-2 text-right">{r.avg.toFixed(1)}</td>
              <td className="px-3 py-2 text-right">{r.zero}</td>
              <td className="px-3 py-2 text-right">{r.fallback}</td>
              <td className="px-3 py-2 text-right">{r.low || 0}</td>
              <td className="px-3 py-2 text-right">{r.pin || 0}</td>
              <td className="px-3 py-2 text-right">{r.nlq || 0}</td>
              <td className="px-3 py-2 text-right">{r.degraded || 0}</td>
              <td className="px-3 py-2 text-right">{r.timestamped || 0}</td>
              <td className="px-3 py-2 text-right">{r.chunkAugmented || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
