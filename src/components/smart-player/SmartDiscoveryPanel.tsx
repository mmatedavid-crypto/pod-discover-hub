import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, Users, Radio, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useSmartPlayer, type SmartPlayerEpisode } from "./SmartPlayerProvider";

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

type Props = {
  episodeIdOverride?: string;
  variant?: "panel" | "compact";
};

const RAILS: Array<{
  kind: Row["match_kind"];
  title: string;
  blurb: string;
  Icon: typeof Sparkles;
}> = [
  {
    kind: "chunk_moment",
    title: "Más műsorban erről beszélnek",
    blurb: "Pillanat-szintű egyezés más podcastokból — ugorj a témára egy kattintással",
    Icon: Zap,
  },
  {
    kind: "entity_overlap",
    title: "Közös szereplők és témák",
    blurb: "Más műsorok, ahol ugyanezekről a személyekről, szervezetekről vagy témákról esik szó",
    Icon: Users,
  },
  {
    kind: "vector_neighbor",
    title: "Hasonló hangulat",
    blurb: "Vektor-alapú ajánlás — más műsorok, hasonló rezgéssel",
    Icon: Radio,
  },
];

function formatTimestamp(sec: number | null): string {
  if (sec == null || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SmartDiscoveryPanel({ episodeIdOverride, variant = "panel" }: Props = {}) {
  const { currentEpisode, play, setExpanded } = useSmartPlayer();
  const episodeId = episodeIdOverride ?? currentEpisode?.id;
  const isCompact = variant === "compact";

  const { data, isLoading, error } = useQuery({
    queryKey: ["smart-discovery", episodeId],
    enabled: !!episodeId,
    staleTime: 1000 * 60 * 60,
    gcTime: 1000 * 60 * 60 * 6,
    queryFn: async (): Promise<Row[]> => {
      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        "smart_player_discover" as any,
        { p_episode_id: episodeId!, p_limit: 6 },
      );
      if (rpcErr) throw rpcErr;
      return (rpcData as Row[]) || [];
    },
  });

  const byRail = useMemo(() => {
    const map: Record<Row["match_kind"], Row[]> = {
      chunk_moment: [],
      entity_overlap: [],
      vector_neighbor: [],
    };
    (data || []).forEach((r) => {
      if (r.audio_url && map[r.match_kind]) map[r.match_kind].push(r);
    });
    return map;
  }, [data]);

  const totalMoments = byRail.chunk_moment.length;
  const totalPodcasts = useMemo(() => {
    const s = new Set<string>();
    (data || []).forEach((r) => s.add(r.podcast_id));
    return s.size;
  }, [data]);

  if (!episodeId) return null;

  const launch = (r: Row, withSeek: boolean) => {
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
    play(ep, withSeek && r.seek_seconds ? { startAt: r.seek_seconds } : undefined);
  };

  return (
    <div className={isCompact ? "w-full mt-8" : "w-full max-w-3xl"}>
      {!isCompact && (
        <div className="mb-4 flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          {isLoading ? (
            <span>Smart Player keresi a kapcsolódó pillanatokat…</span>
          ) : (
            <span>
              {totalMoments > 0
                ? `${totalMoments} kapcsolódó pillanat ${totalPodcasts} másik műsorban`
                : `${totalPodcasts} kapcsolódó műsor megtalálva`}
            </span>
          )}
        </div>
      )}

      {error && (
        <div className="text-xs text-amber-500 mb-3">
          Most nem tudtuk lekérni az ajánlásokat.
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
                    const ts = formatTimestamp(r.seek_seconds);
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

                        {rail.kind === "chunk_moment" && r.snippet && (
                          <div className="text-[10.5px] text-muted-foreground/80 italic line-clamp-2">
                            „{r.snippet}…"
                          </div>
                        )}

                        <div className="mt-auto flex items-center gap-2">
                          <button
                            onClick={() => launch(r, rail.kind === "chunk_moment" && !!r.seek_seconds)}
                            className="text-[11px] px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:opacity-90"
                            aria-label={`Lejátszás: ${r.title}`}
                          >
                            {rail.kind === "chunk_moment" && ts ? `▶ ${ts}-től` : "▶ Lejátszás"}
                          </button>
                          {rail.kind === "chunk_moment" && r.seek_seconds && (
                            <button
                              onClick={() => launch(r, false)}
                              className="text-[10.5px] text-muted-foreground hover:text-foreground"
                              title="Elejétől"
                            >
                              elejétől
                            </button>
                          )}
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
