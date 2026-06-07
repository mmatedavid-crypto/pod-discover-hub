import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EpisodeList, EpisodeLite } from "./EpisodeCard";
import { Sparkles } from "lucide-react";
import { filterSafeRelatedEpisodes, type RecommendationContext } from "@/lib/recommendationGuards";
import { SMART_PLAYER_RECOMMENDATIONS_ENABLED } from "@/components/smart-player/recommendationsConfig";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";

type Row = {
  episode_id: string;
  podcast_id: string;
  similarity: number;
  final_score: number;
  title: string;
  display_title: string | null;
  slug: string;
  ai_summary: string | null;
  summary: string | null;
  description: string | null;
  published_at: string | null;
  audio_url: string | null;
  image_url: string | null;
  topics: string[] | null;
  people?: string[] | null;
  mentioned?: string[] | null;
  companies?: string[] | null;
  podcast_slug: string;
  podcast_title: string;
  podcast_display_title: string | null;
  podcast_image_url: string | null;
  podcast_category: string | null;
  podiverzum_rank: number | null;
  rank_label: string | null;
  related_reason: string | null;
};

function rowToEpisode(r: Row): EpisodeLite {
  return {
    id: r.episode_id,
    title: r.title,
    display_title: r.display_title,
    slug: r.slug,
    ai_summary: r.ai_summary,
    summary: r.summary,
    description: r.description,
    published_at: r.published_at,
    audio_url: r.audio_url,
    image_url: r.image_url,
    topics: r.topics,
    people: r.people,
    mentioned: r.mentioned,
    companies: r.companies,
    why_matched: sanitizeHungarianPublicText(r.related_reason),
    podcasts: {
      slug: r.podcast_slug,
      title: r.podcast_title,
      display_title: r.podcast_display_title,
      image_url: r.podcast_image_url,
      category: r.podcast_category,
      podiverzum_rank: r.podiverzum_rank ?? undefined,
    },
  };
}

const MIN_RESULTS = 3;

function sourceFromEpisode(cur: any): RecommendationContext {
  const podcast = Array.isArray(cur?.podcasts) ? cur.podcasts[0] : cur?.podcasts;
  return {
    title: cur?.display_title || cur?.title || null,
    podcastTitle: podcast?.display_title || podcast?.title || null,
    category: podcast?.category || null,
    topics: cur?.topics || [],
    people: [...(cur?.people || []), ...(cur?.mentioned || [])],
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
    people: [...(row.people || []), ...(row.mentioned || [])],
    companies: row.companies || [],
  };
}

function hasSafeRelatedReason(row: Row): boolean {
  return sanitizeHungarianPublicText(row.related_reason).length >= 12;
}

async function hydrateRows(rows: Row[]): Promise<Row[]> {
  const ids = rows.map((r) => r.episode_id).filter(Boolean);
  if (!ids.length) return rows;
  const { data } = await supabase
    .from("episodes")
    .select("id,image_url,topics,people,mentioned,companies")
    .in("id", ids);
  const byId = new Map((data || []).map((r: any) => [r.id, r]));
  return rows.map((row) => {
    const full = byId.get(row.episode_id);
    if (!full) return row;
    return {
      ...row,
      image_url: full.image_url || row.image_url || null,
      topics: full.topics || row.topics || [],
      people: full.people || [],
      mentioned: full.mentioned || [],
      companies: full.companies || [],
    };
  });
}

export function SimilarEpisodes({ episodeId, limit = 8 }: { episodeId: string; limit?: number }) {
  if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return null;

  const [items, setItems] = useState<EpisodeLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    async function load() {
      const [{ data: cur }, { data, error }] = await Promise.all([
        supabase
          .from("episodes")
          .select("id,title,display_title,topics,people,mentioned,companies,podcasts!inner(title,display_title,category)")
          .eq("id", episodeId)
          .maybeSingle(),
        supabase.rpc("get_related_episodes_by_embedding", {
          p_episode_id: episodeId,
          p_limit: limit,
          p_downweight_same_podcast: true,
        }),
      ]);
      if (cancelled) return;
      if (error || !Array.isArray(data)) {
        setItems([]);
      } else {
        const hydrated = await hydrateRows(data as Row[]);
        if (cancelled) return;
        const safeRows = filterSafeRelatedEpisodes(
          sourceFromEpisode(cur),
          hydrated.filter(hasSafeRelatedReason).map(rowToCandidate),
          limit,
        ) as Row[];
        setItems(safeRows.map(rowToEpisode));
      }
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [episodeId, limit]);

  if (loading || items.length < MIN_RESULTS) return null;
  return (
    <section className="mt-10">
      <div className="flex items-center gap-2 mb-1">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="font-semibold">Kapcsolódó epizódok</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-3">Hasonló témájú magyar podcast epizódok.</p>
      <EpisodeList items={items} />
    </section>
  );
}
