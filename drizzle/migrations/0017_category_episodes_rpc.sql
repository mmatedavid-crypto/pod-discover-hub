-- Containment lookups on secondary_categories were seq-scanning 150k rows.
CREATE INDEX IF NOT EXISTS eac_secondary_categories_gin
  ON public.episode_ai_classifications USING gin (secondary_categories);

CREATE OR REPLACE FUNCTION public.category_episodes(_slug text, _limit integer DEFAULT 120)
RETURNS TABLE (
  id uuid, title text, display_title text, slug text, image_url text,
  published_at timestamptz, ai_summary text, audio_url text,
  people text[], mentioned text[], topics text[], companies text[], tickers text[],
  podcast_id uuid, podcast_slug text, podcast_title text, podcast_display_title text,
  podcast_image_url text, podcast_category text, podcast_rank numeric,
  podcast_rank_label text, podcast_rss_status text, podcast_featured boolean,
  source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET statement_timeout = '12s'
AS $$
  WITH candidates AS (
    SELECT c.episode_id
    FROM episode_ai_classifications c
    WHERE c.classification_status = 'classified'
      AND (c.primary_category = _slug OR c.secondary_categories @> to_jsonb(array[_slug]))
  ),
  picked AS (
    SELECT e.episode_id, e.published_at
    FROM candidates k
    JOIN episode_cards e ON e.episode_id = k.episode_id
    ORDER BY e.published_at DESC NULLS LAST
    LIMIT greatest(1, least(coalesce(_limit, 120), 300))
  )
  SELECT e.episode_id, e.title, e.display_title, e.slug, e.image_url, e.published_at,
         e.card_summary, e.audio_url, e.people, e.mentioned, e.topics, e.companies, e.tickers,
         e.podcast_id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured, 'classification'
  FROM picked k
  JOIN episode_cards e ON e.episode_id = k.episode_id
  JOIN podcasts p ON p.id = e.podcast_id
  WHERE p.language_decision = 'accept_hungarian'
  ORDER BY k.published_at DESC NULLS LAST;
$$;

GRANT EXECUTE ON FUNCTION public.category_episodes(text, integer) TO anon, authenticated, service_role;