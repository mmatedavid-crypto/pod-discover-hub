import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { filterSafeRelatedEpisodes, type RecommendationContext } from "@/lib/recommendationGuards";
import { useSmartPlayer, type SmartPlayerEpisode } from "./SmartPlayerProvider";
import { SMART_PLAYER_RECOMMENDATIONS_ENABLED } from "./recommendationsConfig";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";

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
  topics?: string[] | null;
  people?: string[] | null;
  companies?: string[] | null;
  podcast_slug: string;
  podcast_title: string;
  podcast_display_title: string | null;
  podcast_image_url: string | null;
  podcast_category?: string | null;
};

const MAX = 5;

function snippet(r: Row): string {
  const raw = sanitizeHungarianPublicText(r.ai_summary)
    || sanitizeHungarianPublicText(r.summary)
    || sanitizeHungarianPublicText(r.description);
  if (!raw) return "";
  return raw.length > 140 ? raw.slice(0, 137) + "…" : raw;
}

function reason(r: Row): string {
  const sim = Math.round((r.similarity || 0) * 100);
  if (sim >= 70) return `${sim}% tartalmi egyezés az epizód-index alapján`;
  if (sim >= 55) return `${sim}% hasonlóság, rokon téma más műsorból`;
  return "Rokon téma más műsorból";
}

function sourceFromEpisode(cur: any): RecommendationContext {
  const podcast = Array.isArray(cur?.podcasts) ? cur.podcasts[0] : cur?.podcasts;
  return {
    title: cur?.display_title || cur?.title || null,
    podcastTitle: podcast?.display_title || podcast?.title || null,
    category: podcast?.category || null,
    topics: cur?.topics || [],
    people: cur?.people || [],
    companies: cur?.companies || [],
  };
}

function rowToCandidate(row: Row) {
  return {
    ...row,
    title: row.display_title || row.title,
    podcastTitle: row.podcast_display_title || row.podcast_title,
    category: row.podcast_category || null,
    topics: row.topics || [],
    people: row.people || [],
    companies: row.companies || [],
  };
}

type Props = {
  episodeIdOverride?: string;
  podcastIdOverride?: string | null;
  variant?: "panel" | "compact";
};

export function RelatedEpisodes({ episodeIdOverride, podcastIdOverride, variant = "panel" }: Props = {}) {
  if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return null;

  const { currentEpisode, play, setExpanded } = useSmartPlayer();
  const episodeId = episodeIdOverride ?? currentEpisode?.id;
  const podcastId = podcastIdOverride ?? currentEpisode?.podcastId ?? null;
  const isCompact = variant === "compact";

  const { data, isLoading } = useQuery({
    queryKey: ["smart-player-related", episodeId],
    enabled: !!episodeId,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 6,
    queryFn: async (): Promise<Row[]> => {
      const { data: cur } = await supabase
        .from("episodes")
        .select("id,podcast_id,title,display_title,topics,people,companies,podcasts!inner(title,display_title,category)")
        .eq("id", episodeId!)
        .maybeSingle();
      const source = sourceFromEpisode(cur);
      const topics: string[] = (cur as any)?.topics || [];
      const people: string[] = (cur as any)?.people || [];
      const category: string | null = (Array.isArray((cur as any)?.podcasts) ? (cur as any)?.podcasts?.[0] : (cur as any)?.podcasts)?.category || null;

      const { data: rpcData, error: rpcErr } = await supabase.rpc("similar_episodes", {
        p_episode_id: episodeId!,
        p_limit: 12,
      });
      if (!rpcErr && rpcData && (rpcData as any[]).length > 0) {
        return filterSafeRelatedEpisodes(source, (rpcData as Row[]).map(rowToCandidate), 12) as Row[];
      }

      // Fallback when no episode embedding: explicit shared topics / people / category only.
      const sel =
        "id,podcast_id,title,display_title,slug,ai_summary,summary,description,published_at,audio_url,topics,people,companies,podcasts!inner(slug,title,display_title,image_url,category,rss_status,is_hungarian,rank_label)";

      const probes: any[] = [];
      if (topics.length) probes.push(supabase.from("episodes").select(sel).neq("id", episodeId!).overlaps("topics", topics.slice(0, 8)).order("published_at", { ascending: false, nullsFirst: false }).limit(10));
      if (people.length) probes.push(supabase.from("episodes").select(sel).neq("id", episodeId!).overlaps("people", people.slice(0, 8)).order("published_at", { ascending: false, nullsFirst: false }).limit(10));
      if (category) probes.push(supabase.from("episodes").select(sel).neq("id", episodeId!).eq("podcasts.category", category).order("published_at", { ascending: false, nullsFirst: false }).limit(10));
      // Intentionally NO same-podcast probe: Smart Player surfaces cross-podcast discovery only.

      const results = await Promise.all(probes);
      const candidates = new Map<string, any>();
      results.forEach((r: any) => (r?.data || []).forEach((row: any) => {
        if (!row.audio_url) return;
        if (row.podcasts?.rss_status === "failed" || row.podcasts?.rss_status === "inactive") return;
        if (!candidates.has(row.id)) candidates.set(row.id, row);
      }));

      const rows = Array.from(candidates.values()).map((r) => ({
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
        topics: r.topics,
        people: r.people,
        companies: r.companies,
        podcast_slug: r.podcasts?.slug,
        podcast_title: r.podcasts?.title,
        podcast_display_title: r.podcasts?.display_title,
        podcast_image_url: r.podcasts?.image_url,
        podcast_category: r.podcasts?.category,
      })) as Row[];
      return filterSafeRelatedEpisodes(source, rows.map(rowToCandidate), 12) as Row[];
    },
  });

  const items = useMemo(() => {
    if (!data) return [];
    // Smart Player = CROSS-podcast discovery only. Same-podcast episodes are
    // already shown on the episode page, so they'd feel redundant here.
    const cross = data.filter((r) => r.podcast_id !== podcastId && !!r.audio_url);
    return cross.slice(0, MAX);
  }, [data, podcastId]);

  if (!episodeId) return null;
  if (isCompact && !isLoading && items.length === 0) return null;

  return (
    <div className={isCompact ? "w-full mt-8" : "w-full max-w-2xl"}>
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className="h-4 w-4 text-accent" />
        <h3 className="text-sm font-semibold tracking-wide">
          Más műsorokból, hasonló témában
        </h3>
        <span className="text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
          Tartalmi kapcsolat
        </span>
      </div>

      {isLoading && (
        <div className="text-xs text-muted-foreground">Keressük a kapcsolódó epizódokat…</div>
      )}
      {!isLoading && !isCompact && items.length === 0 && (
        <div className="text-xs text-muted-foreground">
          Ehhez az epizódhoz még nincs elég erős kapcsolódó adat.
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
                <div className="text-[10.5px] leading-snug rounded-md bg-accent/10 text-accent px-2 py-1 line-clamp-2">
                  {reason(r)}
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
                  </div>
                  <div className="text-[11px] leading-snug rounded-md bg-accent/10 text-accent px-2 py-1 mt-1">
                    {reason(r)}
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
                  ▶ Lejátszás
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
