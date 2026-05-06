import { useEffect, useMemo, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { useNoindex } from "@/lib/useNoindex";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { slugify } from "@/lib/slug";
import { toast } from "sonner";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";
const MAX_BULK_ADD = 10;

type PiResult = {
  pi_id: number;
  title: string;
  description?: string;
  image_url?: string;
  rss_url?: string;
  website_url?: string;
  language?: string;
  author?: string;
  episode_count?: number;
  last_episode_at?: string | null;
  dead?: boolean;
  last_http_status?: number;
  quality_score: number;
  quality_tier: "High" | "Medium" | "Low";
};

export default function AdminDiscoveryPage() {
  useNoindex("Admin · Discovery — Podiverzum");
  const [params] = useSearchParams();
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [query, setQuery] = useState(params.get("title") || "");
  const [language, setLanguage] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<{ id: string; name: string; slug: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PiResult[]>([]);
  const [existingRss, setExistingRss] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [credsMissing, setCredsMissing] = useState(false);
  const [adding, setAdding] = useState(false);

  const podcastId = params.get("podcast_id");
  const replaceMode = !!podcastId;

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" });
      setIsAdmin(hasAdmin === true || uid === TEMP_ADMIN_USER_ID);
      setReady(true);
      const { data: cats } = await supabase.from("categories").select("id,name,slug").order("sort_order");
      setCategories(cats || []);
      const { data: pods } = await supabase.from("podcasts").select("rss_url");
      setExistingRss(new Set((pods || []).map((p: any) => (p.rss_url || "").trim()).filter(Boolean)));
    })();
  }, [nav]);

  const runSearch = async () => {
    if (!query.trim()) return;
    setLoading(true); setResults([]); setSelected(new Set()); setCredsMissing(false);
    try {
      const { data, error } = await supabase.functions.invoke("podcast-index-search", {
        body: { query: query.trim(), language: language || undefined },
      });
      if (error) throw error;
      if ((data as any)?.missing_credentials) { setCredsMissing(true); return; }
      if ((data as any)?.error) throw new Error((data as any).error);
      setResults(((data as any).results as PiResult[]) || []);
    } catch (e: any) {
      const msg = e?.message || "Search failed";
      if (msg.includes("PODCAST_INDEX_API")) setCredsMissing(true);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const fetchEpisodes = async (id: string) => {
    try {
      const { data } = await supabase.functions.invoke("fetch-rss", { body: { podcast_id: id } });
      return (data as any)?.new ?? (data as any)?.count ?? 0;
    } catch { return 0; }
  };

  const addOne = async (r: PiResult): Promise<{ id: string | null; imported: number }> => {
    if (!r.rss_url) { toast.error("No RSS URL"); return { id: null, imported: 0 }; }
    if (existingRss.has(r.rss_url)) { toast.message(`Already added: ${r.title}`); return { id: null, imported: 0 }; }
    const slug = slugify(r.title) + "-" + Math.random().toString(36).slice(2, 6);
    const { data, error } = await supabase.from("podcasts").insert({
      title: r.title,
      slug,
      description: r.description ?? null,
      rss_url: r.rss_url,
      image_url: r.image_url ?? null,
      website_url: r.website_url ?? null,
      language: (r.language || "en").slice(0, 8),
      category: category || null,
      rss_status: "not_checked",
    }).select("id").single();
    if (error) { toast.error(error.message); return { id: null, imported: 0 }; }
    setExistingRss((prev) => new Set(prev).add(r.rss_url!));
    const imported = await fetchEpisodes(data.id);
    return { id: data.id, imported };
  };

  const handleAdd = async (r: PiResult) => {
    setAdding(true);
    const { id, imported } = await addOne(r);
    setAdding(false);
    if (id) toast.success(`Added "${r.title}" — ${imported} episodes imported`);
  };

  const handleBulkAdd = async () => {
    const toAdd = results.filter((r) => selected.has(r.pi_id)).slice(0, MAX_BULK_ADD);
    if (!toAdd.length) return;
    setAdding(true);
    let added = 0, totalEpisodes = 0;
    for (const r of toAdd) {
      const { id, imported } = await addOne(r);
      if (id) { added++; totalEpisodes += imported; }
    }
    setAdding(false);
    setSelected(new Set());
    toast.success(`Added ${added} podcasts — ${totalEpisodes} episodes imported`);
  };

  const handleReplace = async (r: PiResult) => {
    if (!podcastId || !r.rss_url) return;
    setAdding(true);
    const { error } = await supabase.from("podcasts").update({
      rss_url: r.rss_url,
      image_url: r.image_url ?? undefined,
      website_url: r.website_url ?? undefined,
      rss_status: "not_checked",
      last_fetch_error: null,
    }).eq("id", podcastId);
    if (error) { setAdding(false); toast.error(error.message); return; }
    const imported = await fetchEpisodes(podcastId);
    setAdding(false);
    toast.success(`RSS replaced — ${imported} episodes imported`);
    nav("/admin");
  };

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_BULK_ADD) next.add(id);
      else toast.message(`Max ${MAX_BULK_ADD} per bulk add`);
      return next;
    });
  };

  const tierColor = (t: string) =>
    t === "High" ? "bg-green-500/15 text-green-700 dark:text-green-400" :
    t === "Medium" ? "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400" :
    "bg-red-500/15 text-red-700 dark:text-red-400";

  const selectedCount = selected.size;

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Not authorized.</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-6 max-w-4xl space-y-4">
        <div>
          <h1 className="text-2xl font-semibold">Discover podcasts</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {replaceMode ? "Find a replacement RSS feed for an existing podcast." : "Search Podcast Index and add high-quality podcasts to Podiverzum."}
          </p>
          {replaceMode && (
            <div className="mt-2 px-3 py-2 rounded-md bg-amber-500/10 text-amber-800 dark:text-amber-300 text-sm">
              Replace RSS for existing podcast (id: <code>{podcastId}</code>)
            </div>
          )}
        </div>

        {credsMissing && (
          <div className="p-4 rounded-lg border border-destructive/40 bg-destructive/10 text-sm">
            Podcast Index API credentials are required. Add <code>PODCAST_INDEX_API_KEY</code> and <code>PODCAST_INDEX_API_SECRET</code> in Cloud → Secrets.
          </div>
        )}

        <div className="p-4 rounded-lg border border-border bg-card sticky top-0 z-10 space-y-2">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Search by title, topic, or person…"
              className="flex-1 px-3 py-2 rounded-md border border-border bg-background text-sm"
            />
            <select value={language} onChange={(e) => setLanguage(e.target.value)}
              className="px-3 py-2 rounded-md border border-border bg-background text-sm">
              <option value="">Any language</option>
              <option value="en">English</option>
              <option value="es">Spanish</option>
              <option value="fr">French</option>
              <option value="de">German</option>
              <option value="pt">Portuguese</option>
              <option value="it">Italian</option>
              <option value="hu">Hungarian</option>
            </select>
            {!replaceMode && (
              <select value={category} onChange={(e) => setCategory(e.target.value)}
                className="px-3 py-2 rounded-md border border-border bg-background text-sm">
                <option value="">No category</option>
                {categories.map((c) => <option key={c.id} value={c.slug}>{c.name}</option>)}
              </select>
            )}
            <button onClick={runSearch} disabled={loading || !query.trim()}
              className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">
              {loading ? "Searching…" : "Search"}
            </button>
          </div>
          {!replaceMode && selectedCount > 0 && (
            <div className="flex items-center justify-between pt-1">
              <div className="text-xs text-muted-foreground">{selectedCount} selected (max {MAX_BULK_ADD})</div>
              <button onClick={handleBulkAdd} disabled={adding}
                className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">
                Add selected ({selectedCount})
              </button>
            </div>
          )}
        </div>

        {!loading && !results.length && !credsMissing && (
          <div className="text-sm text-muted-foreground py-10 text-center">
            Type a search term and press Enter.
          </div>
        )}

        <div className="space-y-3">
          {results.map((r) => {
            const already = !!r.rss_url && existingRss.has(r.rss_url);
            return (
              <div key={r.pi_id} className="p-3 rounded-lg border border-border bg-card flex gap-3">
                {!replaceMode && (
                  <input type="checkbox" disabled={already}
                    checked={selected.has(r.pi_id)}
                    onChange={() => toggle(r.pi_id)}
                    className="mt-2 self-start" />
                )}
                {r.image_url ? (
                  <img src={r.image_url} alt="" loading="lazy"
                    className="w-16 h-16 rounded-md object-cover flex-shrink-0 bg-muted"
                    onError={(e) => ((e.target as HTMLImageElement).style.visibility = "hidden")} />
                ) : (
                  <div className="w-16 h-16 rounded-md bg-muted flex-shrink-0 flex items-center justify-center text-xs text-muted-foreground">
                    {r.title.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <div className="font-medium truncate">{r.title}</div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${tierColor(r.quality_tier)}`}>
                      {r.quality_tier} · {r.quality_score}
                    </span>
                    {already && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-400">Already added</span>}
                    {r.dead && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/15 text-red-700 dark:text-red-400">Dead</span>}
                  </div>
                  {r.description && <div className="text-xs text-muted-foreground line-clamp-2">{r.description}</div>}
                  <div className="text-[11px] text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5">
                    {r.author && <span>👤 {r.author}</span>}
                    {r.language && <span>🌐 {r.language}</span>}
                    {typeof r.episode_count === "number" && <span>🎙 {r.episode_count} ep</span>}
                    {r.last_episode_at && <span>📅 {new Date(r.last_episode_at).toLocaleDateString()}</span>}
                  </div>
                  <div className="text-[11px] font-mono text-muted-foreground truncate">{r.rss_url}</div>
                  {r.website_url && (
                    <a href={r.website_url} target="_blank" rel="noopener noreferrer"
                      className="text-[11px] text-primary hover:underline truncate block">{r.website_url}</a>
                  )}
                  <div className="pt-1">
                    {replaceMode ? (
                      <button onClick={() => handleReplace(r)} disabled={adding || !r.rss_url}
                        className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50">
                        Use this feed
                      </button>
                    ) : (
                      <button onClick={() => handleAdd(r)} disabled={adding || already || !r.rss_url}
                        className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs disabled:opacity-50">
                        {already ? "Added" : "Add"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
