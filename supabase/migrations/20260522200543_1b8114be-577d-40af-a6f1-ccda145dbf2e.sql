
CREATE OR REPLACE FUNCTION public.set_updated_at_now()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.taste_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  locale text NOT NULL DEFAULT 'hu',
  type text NOT NULL,
  title text NOT NULL,
  subtitle text,
  hidden_embedding_prompt text NOT NULL,
  image_url text,
  card_embedding vector(768),
  topic_tags text[] NOT NULL DEFAULT '{}',
  mood_tags text[] NOT NULL DEFAULT '{}',
  format_tags text[] NOT NULL DEFAULT '{}',
  psych_tags text[] NOT NULL DEFAULT '{}',
  archetype_tags text[] NOT NULL DEFAULT '{}',
  primary_axis text,
  secondary_axis text,
  stage text NOT NULL DEFAULT 'broad',
  sensitivity_level text NOT NULL DEFAULT 'normal',
  active boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 0,
  catalog_fit_score numeric,
  top_episode_similarity numeric,
  validation_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS taste_cards_title_locale_uniq ON public.taste_cards (locale, title);
CREATE INDEX IF NOT EXISTS taste_cards_active_stage_idx ON public.taste_cards (active, stage) WHERE active = true;
CREATE INDEX IF NOT EXISTS taste_cards_embedding_hnsw ON public.taste_cards USING hnsw (card_embedding vector_cosine_ops);

ALTER TABLE public.taste_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "taste_cards public read active" ON public.taste_cards;
CREATE POLICY "taste_cards public read active"
  ON public.taste_cards FOR SELECT
  USING (active = true);

DROP POLICY IF EXISTS "taste_cards admin all" ON public.taste_cards;
CREATE POLICY "taste_cards admin all"
  ON public.taste_cards FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS taste_cards_updated_at ON public.taste_cards;
CREATE TRIGGER taste_cards_updated_at
  BEFORE UPDATE ON public.taste_cards
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_now();

CREATE OR REPLACE FUNCTION public.get_active_taste_cards(p_limit integer DEFAULT 500)
RETURNS TABLE (
  id uuid,
  title text,
  subtitle text,
  image_url text,
  stage text,
  sensitivity_level text,
  priority integer,
  topic_tags text[],
  mood_tags text[],
  format_tags text[],
  psych_tags text[],
  archetype_tags text[],
  catalog_fit_score numeric,
  top_episode_similarity numeric,
  card_embedding vector
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, title, subtitle, image_url, stage, sensitivity_level, priority,
         topic_tags, mood_tags, format_tags, psych_tags, archetype_tags,
         catalog_fit_score, top_episode_similarity, card_embedding
  FROM public.taste_cards
  WHERE active = true
    AND card_embedding IS NOT NULL
    AND validation_status <> 'broken'
  ORDER BY priority DESC, created_at ASC
  LIMIT GREATEST(p_limit, 50);
$$;

CREATE OR REPLACE FUNCTION public.match_episodes_by_taste_vector(
  p_user_vector vector(768),
  p_negative_vector vector(768) DEFAULT NULL,
  p_exclude_episode_ids uuid[] DEFAULT '{}',
  p_limit integer DEFAULT 16
)
RETURNS TABLE (
  episode_id uuid,
  podcast_id uuid,
  title text,
  display_title text,
  slug text,
  image_url text,
  ai_summary text,
  podcast_title text,
  podcast_slug text,
  podcast_image_url text,
  published_at timestamptz,
  similarity numeric,
  final_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  has_neg boolean := p_negative_vector IS NOT NULL;
BEGIN
  RETURN QUERY
  WITH scored AS (
    SELECT
      e.id AS episode_id,
      e.podcast_id,
      e.title,
      e.display_title,
      e.slug,
      e.image_url,
      e.ai_summary,
      p.title AS podcast_title,
      p.slug AS podcast_slug,
      p.image_url AS podcast_image_url,
      e.published_at,
      (1 - (ee.embedding <=> p_user_vector))::numeric AS similarity,
      CASE WHEN has_neg THEN (1 - (ee.embedding <=> p_negative_vector))::numeric ELSE 0::numeric END AS neg_sim,
      CASE p.rank_label
        WHEN 'S' THEN 0.10
        WHEN 'A' THEN 0.06
        WHEN 'B' THEN 0.03
        WHEN 'C' THEN 0.01
        ELSE 0.0
      END::numeric AS quality_boost,
      CASE
        WHEN e.published_at IS NULL THEN 0.0
        WHEN e.published_at > now() - interval '14 days' THEN 0.06
        WHEN e.published_at > now() - interval '90 days' THEN 0.03
        ELSE 0.0
      END::numeric AS recency_boost
    FROM public.episode_embeddings ee
    JOIN public.episodes e ON e.id = ee.episode_id
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE p.language ILIKE 'hu%'
      AND (p_exclude_episode_ids IS NULL OR NOT (e.id = ANY(p_exclude_episode_ids)))
    ORDER BY ee.embedding <=> p_user_vector
    LIMIT 200
  ),
  ranked AS (
    SELECT s.*,
      (s.similarity - 0.15 * s.neg_sim + s.quality_boost + s.recency_boost)::numeric AS final_score,
      ROW_NUMBER() OVER (PARTITION BY s.podcast_id
                         ORDER BY (s.similarity - 0.15 * s.neg_sim + s.quality_boost + s.recency_boost) DESC) AS rn
    FROM scored s
  )
  SELECT r.episode_id, r.podcast_id, r.title, r.display_title, r.slug, r.image_url,
         r.ai_summary, r.podcast_title, r.podcast_slug, r.podcast_image_url, r.published_at,
         r.similarity, r.final_score
  FROM ranked r
  WHERE r.rn <= 2
  ORDER BY r.final_score DESC
  LIMIT GREATEST(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_active_taste_cards(integer) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_episodes_by_taste_vector(vector, vector, uuid[], integer) TO anon, authenticated;
