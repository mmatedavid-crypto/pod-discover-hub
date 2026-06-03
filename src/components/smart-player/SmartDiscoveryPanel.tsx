import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Users, Radio } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { filterSafeRelatedEpisodes, type RecommendationContext } from "@/lib/recommendationGuards";
import { useSmartPlayer, type SmartPlayerEpisode } from "./SmartPlayerProvider";
import { SMART_PLAYER_RECOMMENDATIONS_ENABLED } from "./recommendationsConfig";

type Row = {
  match_kind: "chunk_moment" | "entity_overlap" | "vector_neighbor";
  episode_id: string;
  podcast_id: string;
  title: string;
  display_title: string | null;
  slug: string;
  image_url: string | null;
  audio_url: string | null;
  podcast_slug: string;
  podcast_title: string;
  podcast_display_title: string | null;
  podcast_image_url: string | null;
  published_at: string | null;
  similarity: number | null;
  best_chunk_idx: number | null;
  best_char_start: number | null;
  snippet: string | null;
  seek_seconds: number | null;
  shared_persons: string[] | null;
  shared_orgs: string[] | null;
  shared_topics: string[] | null;
  why_label: string | null;
};

type EpisodeFallbackRow = {
  id: string;
  podcast_id: string;
  title: string;
  display_title: string | null;
  slug: string;
  image_url: string | null;
  audio_url: string | null;
  published_at: string | null;
  topics: string[] | null;
  people: string[] | null;
  companies: string[] | null;
  podcasts?: {
    slug: string;
    title: string;
    display_title: string | null;
    image_url: string | null;
    category: string | null;
  } | null;
};

type Props = {
  episodeIdOverride?: string;
  variant?: "panel" | "compact";
};

const RAILS: Array<{
  kind: Exclude<Row["match_kind"], "chunk_moment">;
  title: string;
  blurb: string;
  Icon: typeof Sparkles;
}> = [
  {
    kind: "entity_overlap",
    title: "Közös szereplők és témák",
    blurb: "Más műsorok, ahol ugyanezekről a személyekről, szervezetekről vagy témákról esik szó",
    Icon: Users,
  },
  {
    kind: "vector_neighbor",
    title: "Tartalmilag kapcsolódik",
    blurb: "Témák, szereplők és szövegközelség alapján válogatva",
    Icon: Radio,
  },
];

function fallbackToRows(rows: EpisodeFallbackRow[]): Row[] {
  return rows.map((r) => ({
    match_kind: "vector_neighbor",
    episode_id: r.id,
    podcast_id: r.podcast_id,
    title: r.title,
    display_title: r.display_title,
    slug: r.slug,
    image_url: r.image_url,
    audio_url: r.audio_url,
    podcast_slug: r.podcasts?.slug || "",
    podcast_title: r.podcasts?.title || "",
    podcast_display_title: r.podcasts?.display_title || null,
    podcast_image_url: r.podcasts?.image_url || null,
    published_at: r.published_at,
    similarity: null,
    best_chunk_idx: null,
    best_char_start: null,
    snippet: null,
    seek_seconds: null,
    shared_persons: null,
    shared_orgs: null,
    shared_topics: r.topics || null,
    why_label: "Közös téma vagy közeli tartalmi jel alapján",
  }));
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
    topics: row.shared_topics || [],
    people: row.shared_persons || [],
    companies: row.shared_orgs || [],
    sharedTopics: row.shared_topics || [],
    sharedPeople: row.shared_persons || [],
    sharedCompanies: row.shared_orgs || [],
  };
}


export function SmartDiscoveryPanel({ episodeIdOverride, variant = "panel" }: Props = {}) {
  if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return null;

  const { currentEpisode, play, setExpanded } = useSmartPlayer();
  const episodeId = episodeIdOverride ?? currentEpisode?.id;
  const isCompact = variant === "compact";

  const { data, isLoading } = useQuery({
    queryKey: ["smart-discovery", episodeId],
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
      const sourcePodcastId = (cur as any)?.podcast_id || null;

      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        "smart_player_discover" as any,
        { p_episode_id: episodeId!, p_limit: 6 },
      );
      if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
        return filterSafeRelatedEpisodes(source, (rpcData as Row[]).map(rowToCandidate), 12) as Row[];
      }

      let q = supabase
        .from("episodes")
        .select("id,podcast_id,title,display_title,slug,image_url,audio_url,published_at,topics,people,companies,podcasts!inner(slug,title,display_title,image_url,category,is_hungarian,rss_status,rank_label)")
        .not("audio_url", "is", null)
        .eq("podcasts.is_hungarian", true)
        .not("podcasts.rss_status", "in", "(failed,inactive)")
        .in("podcasts.rank_label", ["S", "A", "B", "C", "D", "E"])
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(12);
      if (sourcePodcastId) q = q.neq("podcast_id", sourcePodcastId);

      const { data: fallbackData } = await q;
      const rows = fallbackToRows(((fallbackData || []) as unknown as EpisodeFallbackRow[]).slice(0, 12));
      return filterSafeRelatedEpisodes(source, rows.map(rowToCandidate), 6) as Row[];
    },
  });

  const byRail = useMemo(() => {
    const map: Record<"entity_overlap" | "vector_neighbor", Row[]> = {
      entity_overlap: [],
      vector_neighbor: [],
    };
    (data || []).forEach((r) => {
      if (!r.audio_url) return;
      if (r.match_kind === "entity_overlap" || r.match_kind === "vector_neighbor") {
        map[r.match_kind].push(r);
      }
    });
    return map;
  }, [data]);

  const totalPodcasts = useMemo(() => {
    const s = new Set<string>();
    (data || []).forEach((r) => {
      if (r.match_kind !== "chunk_moment") s.add(r.podcast_id);
    });
    return s.size;
  }, [data]);

  if (!episodeId) return null;

  const launch = (r: Row) => {
    const ep: SmartPlayerEpisode = {
      id: r.episode_id,
      title: r.display_title || r.title,
      podcastId: r.podcast_id,
      podcastTitle: r.podcast_display_title || r.podcast_title,
      podcastSlug: r.podcast_slug,
      episodeSlug: r.slug,
      imageUrl: r.image_url || r.podcast_image_url,
      audioUrl: r.audio_url!,
    };
    play(ep);
  };


  return (
    <div className={isCompact ? "w-full mt-8" : "w-full max-w-3xl"}>
      {!isCompact && (
        <div className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          {isLoading ? (
            <span>Keressük a kapcsolódó epizódokat…</span>
          ) : (
            <span>{totalPodcasts} kapcsolódó műsor megtalálva</span>
          )}

        </div>
      )}

      <div className="flex flex-col gap-7">
        {RAILS.map((rail) => {
          const items = byRail[rail.kind];
          if (!isLoading && items.length === 0) return null;
          return (
            <section key={rail.kind}>
              <div className="flex items-baseline gap-2 mb-2">
                <rail.Icon className="h-4 w-4 text-accent shrink-0" />
                <h3 className="text-sm font-semibold tracking-wide">{rail.title}</h3>
              </div>
              <p className="text-[11px] text-muted-foreground mb-3">{rail.blurb}</p>

              {isLoading && items.length === 0 ? (
                <div className="text-xs text-muted-foreground">Számolás folyamatban…</div>
              ) : (
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-4 px-4 snap-x scrollbar-thin">
                  {items.map((r) => {
                    const epHref = `/podcast/${r.podcast_slug}/${r.slug}`;
                    return (
                      <div
                        key={`${rail.kind}-${r.episode_id}`}
                        className="snap-start shrink-0 w-[240px] rounded-xl border border-border bg-card/60 hover:bg-card transition-colors p-3 flex flex-col gap-2"
                      >
                        {(r.image_url || r.podcast_image_url) && (
                          <img
                            src={r.image_url || r.podcast_image_url || ""}
                            alt=""
                            className="h-28 w-full rounded-md object-cover border border-border"
                            loading="lazy"
                          />
                        )}
                        <Link
                          to={epHref}
                          onClick={() => setExpanded(false)}
                          className="text-[13px] font-medium leading-snug line-clamp-2 hover:text-accent"
                        >
                          {r.display_title || r.title}
                        </Link>
                        <div className="text-[10.5px] text-muted-foreground truncate">
                          {r.podcast_display_title || r.podcast_title}
                        </div>

                        {r.why_label && (
                          <div className="text-[10.5px] leading-snug rounded-md bg-accent/10 text-accent px-2 py-1 line-clamp-2">
                            {r.why_label}
                          </div>
                        )}

                        <div className="mt-auto flex items-center gap-2">
                          <button
                            onClick={() => launch(r)}
                            className="text-[11px] px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90"
                            aria-label={`Lejátszás: ${r.title}`}
                          >
                            ▶ Lejátszás
                          </button>
                        </div>
                      </div>
                    );

                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
