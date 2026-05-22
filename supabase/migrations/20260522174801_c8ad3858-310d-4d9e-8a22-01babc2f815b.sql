-- 1) Add negative_title_patterns column
ALTER TABLE public.mood_collections
  ADD COLUMN IF NOT EXISTS negative_title_patterns text[] DEFAULT NULL;

-- 2) Seed sane defaults for the two time-of-day-sensitive moods
UPDATE public.mood_collections
   SET negative_title_patterns = ARRAY['jó est', 'jo est', 'esti ', 'éjszak', 'ejszak', 'elalv', 'altató']
 WHERE slug = 'reggeli-radio';

UPDATE public.mood_collections
   SET negative_title_patterns = ARRAY['reggel', 'jó reggelt', 'jo reggelt', 'napindít', 'ébredj']
 WHERE slug IN ('elalvashoz','elalvas','elalvashoz-csendes','esti-csendes','esti');

-- 3) Patch the RPC to apply the title filter on BOTH episode + podcast titles
CREATE OR REPLACE FUNCTION public.get_mood_episode_recommendations(
  p_mood_slug text, p_limit integer DEFAULT 12, p_exclude uuid[] DEFAULT '{}'::uuid[]
)
RETURNS TABLE(episode_id uuid, podcast_id uuid, similarity double precision, final_score double precision, title text, display_title text, slug text, ai_summary text, summary text, description text, published_at timestamp with time zone, audio_url text, image_url text, topics text[], podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text, podcast_category text, podiverzum_rank numeric, rank_label text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_seed vector(768);
  v_fresh numeric;
  v_ever numeric;
  v_quality numeric;
  v_neg_patterns text[];
  v_neg_regex text;
BEGIN
  PERFORM set_config('hnsw.ef_search', '600', true);

  SELECT mc.seed_embedding,
         COALESCE(mc.freshness_weight, 0.5),
         COALESCE(mc.evergreen_weight, 0.5),
         COALESCE(mc.source_quality_weight, 0.5),
         mc.negative_title_patterns
    INTO v_seed, v_fresh, v_ever, v_quality, v_neg_patterns
  FROM public.mood_collections mc
  WHERE mc.slug = p_mood_slug AND mc.active = true;

  IF v_seed IS NULL THEN RETURN; END IF;

  -- Build a single combined regex from the patterns (case-insensitive match handled with ~*)
  v_neg_regex := NULL;
  IF v_neg_patterns IS NOT NULL AND array_length(v_neg_patterns, 1) > 0 THEN
    v_neg_regex := array_to_string(v_neg_patterns, '|');
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT ee.episode_id AS ep_id, ee.podcast_id AS pod_id,
           1.0 - (ee.embedding <=> v_seed) AS sim
    FROM public.episode_embeddings ee
    JOIN public.podcasts p ON p.id = ee.podcast_id
    WHERE p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND COALESCE(p.rss_status, 'unknown') NOT IN ('dead','removed')
      AND NOT (ee.episode_id = ANY(p_exclude))
    ORDER BY ee.embedding <=> v_seed
    LIMIT 400
  ),
  enriched AS (
    SELECT
      c.ep_id, c.pod_id, c.sim,
      e.title AS e_title, e.display_title AS e_display_title, e.slug AS e_slug,
      e.ai_summary AS e_ai_summary, e.summary AS e_summary, e.description AS e_description,
      e.published_at AS e_published_at, e.audio_url AS e_audio_url, e.image_url AS e_image_url,
      e.topics AS e_topics,
      p.slug AS p_slug, p.title AS p_title, p.display_title AS p_display_title,
      p.image_url AS p_image_url, p.category AS p_category,
      p.podiverzum_rank AS p_rank, p.rank_label AS p_label,
      (CASE p.rank_label WHEN 'S' THEN 0.10 WHEN 'A' THEN 0.06 WHEN 'B' THEN 0.02 ELSE 0 END) * v_quality * 2 AS quality_boost,
      CASE
        WHEN e.published_at IS NULL THEN 0
        WHEN e.published_at >= now() - interval '30 days' THEN 0.10 * v_fresh
        WHEN e.published_at >= now() - interval '90 days' THEN 0.05 * v_fresh
        ELSE 0
      END AS fresh_boost,
      CASE
        WHEN e.published_at IS NULL THEN 0
        WHEN e.published_at < now() - interval '180 days'
             AND e.ai_summary IS NOT NULL
             AND length(e.ai_summary) > 200 THEN 0.06 * v_ever
        ELSE 0
      END AS ever_boost,
      CASE
        WHEN e.ai_summary IS NULL OR length(COALESCE(e.ai_summary, '')) < 60 THEN -0.06
        ELSE 0
      END AS meta_penalty
    FROM candidates c
    JOIN public.episodes e ON e.id = c.ep_id
    JOIN public.podcasts p ON p.id = c.pod_id
    WHERE c.sim >= 0.5
      AND (
        v_neg_regex IS NULL
        OR (
          COALESCE(e.title, '')          !~* v_neg_regex
          AND COALESCE(e.display_title, '') !~* v_neg_regex
          AND COALESCE(p.title, '')      !~* v_neg_regex
          AND COALESCE(p.display_title, '') !~* v_neg_regex
        )
      )
  ),
  scored AS (
    SELECT *,
      (sim + quality_boost + fresh_boost + ever_boost + meta_penalty) AS score,
      row_number() OVER (
        PARTITION BY pod_id
        ORDER BY (sim + quality_boost + fresh_boost + ever_boost + meta_penalty) DESC
      ) AS rn
    FROM enriched
  )
  SELECT
    s.ep_id, s.pod_id, s.sim, s.score,
    s.e_title, s.e_display_title, s.e_slug, s.e_ai_summary, s.e_summary, s.e_description,
    s.e_published_at, s.e_audio_url, s.e_image_url, s.e_topics,
    s.p_slug, s.p_title, s.p_display_title, s.p_image_url, s.p_category,
    s.p_rank, s.p_label
  FROM scored s
  WHERE s.rn <= 2
  ORDER BY s.score DESC
  LIMIT GREATEST(1, LEAST(p_limit, 40));
END;
$function$;