import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { useNoindex } from "@/lib/useNoindex";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { ArrowLeft, RefreshCw, Sparkles, AlertTriangle } from "lucide-react";

type MoodRow = {
  id: string;
  slug: string;
  title: string;
  seed_query: string | null;
  seed_embedding: any;
  recommended_episode_count: number;
  positive_topic_hints: string[];
  negative_topic_hints: string[];
  freshness_weight: number;
  evergreen_weight: number;
  source_quality_weight: number;
  energy_level: string;
  time_affinity: any;
  updated_at: string;
  is_indexable: boolean;
  active: boolean;
};

type RecRow = {
  episode_id: string;
  title: string;
  similarity: number;
  final_score: number;
  podcast_title: string;
  podcast_category: string | null;
  topics: string[] | null;
  podcast_slug: string;
  slug: string;
};

type CardRow = {
  slug: string;
  title: string;
  reason_label: string | null;
  short_description: string | null;
};

const VIEWPORTS = ["mobile", "tablet", "desktop"] as const;
const PRESETS: { label: string; hour: number; dow: number; viewport: typeof VIEWPORTS[number] }[] = [
  { label: "Reggel mobilon (7:00, szerda)", hour: 7, dow: 3, viewport: "mobile" },
  { label: "Délután tableten (15:00, szerda)", hour: 15, dow: 3, viewport: "tablet" },
  { label: "Este desktopon (20:00, péntek)", hour: 20, dow: 5, viewport: "desktop" },
  { label: "Éjszaka mobilon (23:30, szombat)", hour: 23, dow: 6, viewport: "mobile" },
];

export default function AdminVectorSearchPage() {
  useNoindex("Vector Search — Admin");
  const { loading: adminLoading, isAdmin } = useAdminAccess();
  const [moods, setMoods] = useState<MoodRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState<string>("");
  const [hour, setHour] = useState<number>(new Date().getHours());
  const [dow, setDow] = useState<number>(new Date().getDay());
  const [viewport, setViewport] = useState<typeof VIEWPORTS[number]>("desktop");
  const [recs, setRecs] = useState<RecRow[]>([]);
  const [cards, setCards] = useState<Record<string, CardRow[]>>({});
  const [running, setRunning] = useState(false);
  const [recomputing, setRecomputing] = useState(false);

  const loadMoods = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("mood_collections" as any)
      .select(
        "id,slug,title,seed_query,seed_embedding,recommended_episode_count,positive_topic_hints,negative_topic_hints,freshness_weight,evergreen_weight,source_quality_weight,energy_level,time_affinity,updated_at,is_indexable,active",
      )
      .eq("active", true)
      .order("sort_order");
    setMoods(((data as any[]) || []) as MoodRow[]);
    if (!selectedSlug && data && (data as any[]).length) {
      setSelectedSlug(((data as any[])[0] as any).slug);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (adminLoading || !isAdmin) return;
    loadMoods();
    // Run preset card tests
    (async () => {
      const out: Record<string, CardRow[]> = {};
      for (const p of PRESETS) {
        const { data } = await supabase.rpc("get_personalized_mood_cards", {
          p_viewport: p.viewport,
          p_hour: p.hour,
          p_dow: p.dow,
        });
        out[p.label] = (data as CardRow[]) || [];
      }
      setCards(out);
    })();
  }, [adminLoading, isAdmin]);

  const runRecommendationTest = async () => {
    if (!selectedSlug) return;
    setRunning(true);
    const { data } = await supabase.rpc("get_mood_episode_recommendations", {
      p_mood_slug: selectedSlug,
      p_limit: 12,
    });
    setRecs((data as RecRow[]) || []);
    setRunning(false);
  };

  const recomputeCounts = async () => {
    if (!isAdmin) return;
    setRecomputing(true);
    await supabase.functions.invoke("mood-recommended-counts-runner", { body: {} });
    await loadMoods();
    setRecomputing(false);
  };

  if (adminLoading) return <Layout><div className="container mx-auto py-20">Betöltés…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Nincs jogosultság.</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-8 max-w-6xl space-y-8">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <Link to="/admin" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
              <ArrowLeft className="h-3 w-3" /> Admin Hub
            </Link>
            <h1 className="text-2xl font-semibold mt-2 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" /> Vector Search & Mood Diagnostics
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Admin-only. Raw scores shown here; public UI never exposes scores.
            </p>
          </div>
          <button
            onClick={recomputeCounts}
            disabled={recomputing}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-card hover:bg-secondary text-sm disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${recomputing ? "animate-spin" : ""}`} />
            Recompute counts
          </button>
        </div>

        {/* Mood overview */}
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground">Mood overview</h2>
          {loading ? (
            <div className="text-sm text-muted-foreground">Betöltés…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-3">Mood</th>
                    <th className="text-left py-2 pr-3">Seed</th>
                    <th className="text-left py-2 pr-3">Emb?</th>
                    <th className="text-right py-2 pr-3">Recs</th>
                    <th className="text-left py-2 pr-3">+hints</th>
                    <th className="text-left py-2 pr-3">−hints</th>
                    <th className="text-left py-2 pr-3">Energy</th>
                    <th className="text-left py-2 pr-3">Fresh/Ever/Src</th>
                    <th className="text-left py-2">Indexable</th>
                  </tr>
                </thead>
                <tbody>
                  {moods.map((m) => {
                    const weak = m.recommended_episode_count < 6;
                    return (
                      <tr
                        key={m.slug}
                        className={`border-b border-border/50 ${weak ? "bg-destructive/5" : ""}`}
                      >
                        <td className="py-2 pr-3 font-medium">
                          {m.title}
                          <div className="text-[10px] text-muted-foreground">{m.slug}</div>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground max-w-[200px] truncate">
                          {m.seed_query || "—"}
                        </td>
                        <td className="py-2 pr-3">{m.seed_embedding ? "✓" : "✗"}</td>
                        <td className="py-2 pr-3 text-right">
                          <span className={weak ? "text-destructive font-semibold" : ""}>
                            {m.recommended_episode_count}
                          </span>
                          {weak && <AlertTriangle className="h-3 w-3 inline ml-1 text-destructive" />}
                        </td>
                        <td className="py-2 pr-3 max-w-[180px] truncate text-muted-foreground">
                          {(m.positive_topic_hints || []).join(", ") || "—"}
                        </td>
                        <td className="py-2 pr-3 max-w-[150px] truncate text-muted-foreground">
                          {(m.negative_topic_hints || []).join(", ") || "—"}
                        </td>
                        <td className="py-2 pr-3">{m.energy_level}</td>
                        <td className="py-2 pr-3 text-muted-foreground">
                          {Number(m.freshness_weight).toFixed(2)}/{Number(m.evergreen_weight).toFixed(2)}/{Number(m.source_quality_weight).toFixed(2)}
                        </td>
                        <td className="py-2">{m.is_indexable ? "yes" : "no"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recommendation test */}
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground">Recommendation test</h2>
          <div className="flex flex-wrap items-end gap-3 p-4 rounded-lg border border-border bg-card">
            <label className="text-xs">
              <div className="text-muted-foreground mb-1">Mood</div>
              <select
                value={selectedSlug}
                onChange={(e) => setSelectedSlug(e.target.value)}
                className="bg-background border border-border rounded px-2 py-1.5 text-sm"
              >
                {moods.map((m) => (
                  <option key={m.slug} value={m.slug}>{m.title}</option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <div className="text-muted-foreground mb-1">Hour</div>
              <input
                type="number" min={0} max={23}
                value={hour}
                onChange={(e) => setHour(parseInt(e.target.value) || 0)}
                className="bg-background border border-border rounded px-2 py-1.5 text-sm w-20"
              />
            </label>
            <label className="text-xs">
              <div className="text-muted-foreground mb-1">DOW (0–6)</div>
              <input
                type="number" min={0} max={6}
                value={dow}
                onChange={(e) => setDow(parseInt(e.target.value) || 0)}
                className="bg-background border border-border rounded px-2 py-1.5 text-sm w-20"
              />
            </label>
            <label className="text-xs">
              <div className="text-muted-foreground mb-1">Viewport</div>
              <select
                value={viewport}
                onChange={(e) => setViewport(e.target.value as any)}
                className="bg-background border border-border rounded px-2 py-1.5 text-sm"
              >
                {VIEWPORTS.map((v) => <option key={v} value={v}>{v}</option>)}
              </select>
            </label>
            <button
              onClick={runRecommendationTest}
              disabled={running || !selectedSlug}
              className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              {running ? "Running…" : "Run test"}
            </button>
            <button
              onClick={async () => {
                const { data } = await supabase.rpc("get_personalized_mood_cards", {
                  p_viewport: viewport, p_hour: hour, p_dow: dow,
                });
                setCards({ ...cards, [`Manual: ${viewport} @ ${hour}h / dow ${dow}`]: (data as CardRow[]) || [] });
              }}
              className="px-3 py-1.5 rounded-md border border-border bg-card text-sm hover:bg-secondary"
            >
              Run personalized cards
            </button>
          </div>

          {recs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="border-b border-border">
                    <th className="text-left py-2 pr-3">Episode</th>
                    <th className="text-left py-2 pr-3">Podcast</th>
                    <th className="text-left py-2 pr-3">Category</th>
                    <th className="text-left py-2 pr-3">Topics</th>
                    <th className="text-right py-2 pr-3">Similarity</th>
                    <th className="text-right py-2">Final</th>
                  </tr>
                </thead>
                <tbody>
                  {recs.map((r) => (
                    <tr key={r.episode_id} className="border-b border-border/50">
                      <td className="py-2 pr-3 max-w-[300px] truncate">
                        <Link to={`/podcast/${r.podcast_slug}/${r.slug}`} className="hover:text-primary">
                          {r.title}
                        </Link>
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground">{r.podcast_title}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{r.podcast_category || "—"}</td>
                      <td className="py-2 pr-3 text-muted-foreground max-w-[200px] truncate">
                        {(r.topics || []).slice(0, 4).join(", ")}
                      </td>
                      <td className="py-2 pr-3 text-right">{Number(r.similarity).toFixed(3)}</td>
                      <td className="py-2 text-right">{Number(r.final_score).toFixed(3)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Personalized card previews */}
        <section className="space-y-3">
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground">Personalized card previews</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Object.entries(cards).map(([label, cs]) => (
              <div key={label} className="p-4 rounded-lg border border-border bg-card">
                <div className="text-xs font-semibold mb-2">{label}</div>
                <div className="text-[11px] text-muted-foreground mb-2">{cs.length} cards</div>
                <ul className="space-y-1 text-xs">
                  {cs.map((c) => (
                    <li key={c.slug} className="flex items-center justify-between gap-2">
                      <span className="truncate">{c.title}</span>
                      {c.reason_label && (
                        <span className="text-[10px] uppercase tracking-wider text-primary/80 shrink-0">
                          {c.reason_label}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </div>
    </Layout>
  );
}
