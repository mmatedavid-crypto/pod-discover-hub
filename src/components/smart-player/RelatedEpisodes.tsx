import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useSmartPlayer, type SmartPlayerEpisode } from "./SmartPlayerProvider";

type Row = {
  episode_id: string;
  podcast_id: string;
  similarity: number;
  title: string;
  display_title: string | null;
  slug: string;
  ai_summary: string | null;
  summary: string | null;
  description: string | null;
  published_at: string | null;
  audio_url: string | null;
  podcast_slug: string;
  podcast_title: string;
  podcast_display_title: string | null;
  podcast_image_url: string | null;
};

const MAX = 5;

function snippet(r: Row): string {
  const raw = (r.ai_summary || r.summary || r.description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw.length > 140 ? raw.slice(0, 137) + "…" : raw;
}

type Props = {
  episodeIdOverride?: string;
  podcastIdOverride?: string | null;
  variant?: "panel" | "compact";
};

export function RelatedEpisodes({ episodeIdOverride, podcastIdOverride, variant = "panel" }: Props = {}) {
  const { currentEpisode, play, setExpanded } = useSmartPlayer();
  const episodeId = episodeIdOverride ?? currentEpisode?.id;
  const podcastId = podcastIdOverride ?? currentEpisode?.podcastId ?? null;
  const isCompact = variant === "compact";

  const { data, isLoading, error } = useQuery({
    queryKey: ["smart-player-related", episodeId],
    enabled: !!episodeId,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 6,
    queryFn: async (): Promise<Row[]> => {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("similar_episodes", {
        p_episode_id: episodeId!,
        p_limit: 12,
      });
      if (!rpcErr && rpcData && (rpcData as any[]).length > 0) return rpcData as Row[];

      // Fallback when no episode embedding: shared topics / people / category / same podcast
      const { data: cur } = await supabase
        .from("episodes")
        .select("id,podcast_id,topics,persons,podcasts!inner(category)")
        .eq("id", episodeId!)
        .maybeSingle();

      const topics: string[] = (cur as any)?.topics || [];
      const persons: string[] = (cur as any)?.persons || [];
      const category: string | null = (cur as any)?.podcasts?.category || null;
      const curPodcastId: string | null = (cur as any)?.podcast_id || podcastId;

      const sel =
        "id,podcast_id,title,display_title,slug,ai_summary,summary,description,published_at,audio_url,podcasts!inner(slug,title,display_title,image_url,category,rss_status)";

      const probes: any[] = [];
      if (topics.length) probes.push(supabase.from("episodes").select(sel).neq("id", episodeId!).overlaps("topics", topics.slice(0, 8)).order("published_at", { ascending: false, nullsFirst: false }).limit(10));
      if (persons.length) probes.push(supabase.from("episodes").select(sel).neq("id", episodeId!).overlaps("persons", persons.slice(0, 8)).order("published_at", { ascending: false, nullsFirst: false }).limit(10));
      if (category) probes.push(supabase.from("episodes").select(sel).neq("id", episodeId!).eq("podcasts.category", category).order("published_at", { ascending: false, nullsFirst: false }).limit(10));
      if (curPodcastId) probes.push(supabase.from("episodes").select(sel).neq("id", episodeId!).eq("podcast_id", curPodcastId).order("published_at", { ascending: false, nullsFirst: false }).limit(6));

      const results = await Promise.all(probes);
      const candidates = new Map<string, any>();
      results.forEach((r: any) => (r?.data || []).forEach((row: any) => {
        if (!row.audio_url) return;
        if (row.podcasts?.rss_status === "failed" || row.podcasts?.rss_status === "inactive") return;
        if (!candidates.has(row.id)) candidates.set(row.id, row);
      }));

      return Array.from(candidates.values()).slice(0, 12).map((r) => ({
        episode_id: r.id,
        podcast_id: r.podcast_id,
        similarity: 0,
        title: r.title,
        display_title: r.display_title,
        slug: r.slug,
        ai_summary: r.ai_summary,
        summary: r.summary,
        description: r.description,
        published_at: r.published_at,
        audio_url: r.audio_url,
        podcast_slug: r.podcasts?.slug,
        podcast_title: r.podcasts?.title,
        podcast_display_title: r.podcasts?.display_title,
  const items = useMemo(() => {
    if (!data) return [];
    // Smart Player = CROSS-podcast discovery only. Same-podcast episodes are
    // already shown on the episode page itself, so they would feel redundant here.
    const cross = data.filter((r) => r.podcast_id !== podcastId && !!r.audio_url);
    return cross.slice(0, MAX);
  }, [data, podcastId]);
    const same = data.filter((r) => r.podcast_id === podcastId);
    const merged = [...cross, ...same].filter((r) => !!r.audio_url);
    return merged.slice(0, MAX);
  }, [data, podcastId]);

  if (!episodeId) return null;
  if (isCompact && !isLoading && items.length === 0) return null;

  return (
    <div className={isCompact ? "w-full mt-8" : "w-full max-w-2xl"}>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold tracking-wide">
          Hasonló epizódok
        </h3>
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          AI-ajánlás
        </span>
      </div>

      {isLoading && (
        <div className="text-xs text-muted-foreground">Keresés a vektor-indexben…</div>
      )}
      {error && !isCompact && (
        <div className="text-xs text-amber-500">Most nem tudtuk lekérni az ajánlásokat.</div>
      )}
      {!isLoading && !error && !isCompact && items.length === 0 && (
        <div className="text-xs text-muted-foreground">
          Még nincs elég adat ehhez az epizódhoz a hasonlóság-számoláshoz.
        </div>
      )}

      {isCompact ? (
        <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x scrollbar-thin">
          {items.map((r) => {
            const epHref = `/podcast/${r.podcast_slug}/${r.slug}`;
            const ep: SmartPlayerEpisode = {
              id: r.episode_id,
              title: r.display_title || r.title,
              podcastId: r.podcast_id,
              podcastTitle: r.podcast_display_title || r.podcast_title,
              podcastSlug: r.podcast_slug,
              episodeSlug: r.slug,
              imageUrl: r.podcast_image_url,
              audioUrl: r.audio_url!,
            };
            return (
              <div
                key={r.episode_id}
                className="snap-start shrink-0 w-[220px] rounded-xl border border-border bg-card/60 hover:bg-card transition-colors p-3 flex flex-col gap-2"
              >
                {r.podcast_image_url && (
                  <img
                    src={r.podcast_image_url}
                    alt=""
                    className="h-24 w-full rounded-md object-cover border border-border"
                    loading="lazy"
                  />
                )}
                <Link
                  to={epHref}
                  className="text-[13px] font-medium leading-snug line-clamp-2 hover:text-accent"
                >
                  {r.display_title || r.title}
                </Link>
                <div className="text-[10.5px] text-muted-foreground truncate">
                  {r.podcast_display_title || r.podcast_title}
                </div>
                <button
                  onClick={() => play(ep)}
                  className="mt-auto text-[11px] px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90 self-start"
                  aria-label={`Lejátszás: ${r.title}`}
                >
                  ▶ Lejátszás
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((r) => {
            const epHref = `/podcast/${r.podcast_slug}/${r.slug}`;
            const sim = Math.round(r.similarity * 100);
            const ep: SmartPlayerEpisode = {
              id: r.episode_id,
              title: r.display_title || r.title,
              podcastId: r.podcast_id,
              podcastTitle: r.podcast_display_title || r.podcast_title,
              podcastSlug: r.podcast_slug,
              episodeSlug: r.slug,
              imageUrl: r.podcast_image_url,
              audioUrl: r.audio_url!,
            };
            return (
              <li
                key={r.episode_id}
                className="group flex items-start gap-3 rounded-lg border border-border bg-card/60 hover:bg-card transition-colors p-2.5"
              >
                {r.podcast_image_url && (
                  <img
                    src={r.podcast_image_url}
                    alt=""
                    className="h-12 w-12 rounded-md object-cover shrink-0 border border-border"
                    loading="lazy"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <Link
                    to={epHref}
                    onClick={() => setExpanded(false)}
                    className="block text-sm font-medium leading-snug line-clamp-2 hover:text-accent"
                  >
                    {r.display_title || r.title}
                  </Link>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    {r.podcast_display_title || r.podcast_title}
                    {sim > 0 && <span className="ml-2 tabular-nums opacity-70">· {sim}% match</span>}
                  </div>
                  {snippet(r) && (
                    <div className="text-[11px] text-muted-foreground/80 line-clamp-2 mt-1">
                      {snippet(r)}
                    </div>
                  )}
                </div>
                <button
                  onClick={() => play(ep)}
                  className="shrink-0 text-[11px] px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90"
                  aria-label={`Lejátszás: ${r.title}`}
                >
                  ▶ Play
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
