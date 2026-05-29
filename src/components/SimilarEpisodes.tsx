import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { EpisodeList, EpisodeLite } from "./EpisodeCard";
import { Sparkles } from "lucide-react";

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
    topics: r.topics,
    why_matched: r.related_reason || relatedReasonFromSimilarity(r.similarity),
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

function relatedReasonFromSimilarity(similarity: number): string {
  if (similarity >= 0.72) return "Erős tartalmi hasonlóság az epizód metaadatai alapján.";
  if (similarity >= 0.6) return "Hasonló témájú epizód más magyar műsorból.";
  return "Tartalmilag rokon epizód.";
}

const MIN_RESULTS = 3;

export function SimilarEpisodes({ episodeId, limit = 8 }: { episodeId: string; limit?: number }) {
  const [items, setItems] = useState<EpisodeLite[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .rpc("get_related_episodes_by_embedding" as any, {
        p_episode_id: episodeId,
        p_limit: limit,
        p_downweight_same_podcast: true,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !Array.isArray(data)) {
          setItems([]);
        } else {
          setItems((data as Row[]).map(rowToEpisode));
        }
        setLoading(false);
      });
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
