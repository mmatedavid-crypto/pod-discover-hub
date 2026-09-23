-- Keep the new published_at column in sync when classifications change.
CREATE OR REPLACE FUNCTION public.episode_topic_slug_map_sync()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.episode_topic_slug_map WHERE episode_id = NEW.episode_id;
  IF NEW.classification_status = 'classified' AND NEW.topics IS NOT NULL THEN
    INSERT INTO public.episode_topic_slug_map (slug, episode_id, confidence, published_at)
    SELECT DISTINCT ON (slug) slug, NEW.episode_id, confidence,
           (SELECT c.published_at FROM public.episode_cards c WHERE c.episode_id = NEW.episode_id)
    FROM (
      SELECT t->>'slug' AS slug, nullif(t->>'confidence', '')::numeric AS confidence
      FROM jsonb_array_elements(NEW.topics) AS t
      WHERE coalesce(t->>'slug', '') <> ''
    ) s
    ORDER BY slug, confidence DESC NULLS LAST
    ON CONFLICT (slug, episode_id) DO UPDATE
      SET confidence = excluded.confidence, published_at = excluded.published_at;
  END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.episode_topic_slug_backfill_tick()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '150s'
AS $function$
DECLARE
  cursor_id uuid;
  max_id uuid;
  seen integer := 0;
BEGIN
  IF NOT pg_try_advisory_lock(771122335) THEN
    RETURN -1;
  END IF;

  SELECT last_id INTO cursor_id FROM public.episode_topic_slug_backfill_state WHERE id;

  DROP TABLE IF EXISTS _etsm_todo;
  CREATE TEMP TABLE _etsm_todo ON COMMIT DROP AS
    SELECT c.episode_id, c.topics
    FROM public.episode_ai_classifications c
    WHERE c.classification_status = 'classified'
      AND (cursor_id IS NULL OR c.episode_id > cursor_id)
    ORDER BY c.episode_id
    LIMIT 4000;

  INSERT INTO public.episode_topic_slug_map (slug, episode_id, confidence, published_at)
  SELECT DISTINCT ON (episode_id, slug) slug, episode_id, confidence, published_at
  FROM (
    SELECT d.episode_id, t->>'slug' AS slug, nullif(t->>'confidence', '')::numeric AS confidence,
           (SELECT ec.published_at FROM public.episode_cards ec WHERE ec.episode_id = d.episode_id) AS published_at
    FROM _etsm_todo d, jsonb_array_elements(d.topics) AS t
    WHERE coalesce(t->>'slug', '') <> ''
  ) s
  ORDER BY episode_id, slug, confidence DESC NULLS LAST
  ON CONFLICT (slug, episode_id) DO UPDATE
    SET confidence = excluded.confidence, published_at = excluded.published_at;

  SELECT count(*)::int INTO seen FROM _etsm_todo;
  SELECT episode_id INTO max_id FROM _etsm_todo ORDER BY episode_id DESC LIMIT 1;

  IF max_id IS NULL THEN
    UPDATE public.episode_topic_slug_backfill_state SET done = true, updated_at = now() WHERE id;
  ELSE
    UPDATE public.episode_topic_slug_backfill_state SET last_id = max_id, updated_at = now() WHERE id;
  END IF;

  PERFORM pg_advisory_unlock(771122335);
  RETURN seen;
END;
$function$;

-- The classification branch now orders straight off (slug, published_at) index,
-- so a large topic reads only the page it needs instead of thousands of cards.
CREATE OR REPLACE FUNCTION public.topic_episodes(_topic_id uuid, _slug text DEFAULT NULL::text, _limit integer DEFAULT 150)
 RETURNS TABLE(id uuid, title text, display_title text, slug text, image_url text, published_at timestamp with time zone, ai_summary text, audio_url text, people text[], mentioned text[], topics text[], companies text[], tickers text[], podcast_id uuid, podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text, podcast_category text, podcast_rank numeric, podcast_rank_label text, podcast_rss_status text, podcast_featured boolean, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '12s'
AS $function$
  WITH lim AS (SELECT greatest(1, least(coalesce(_limit, 150), 300)) AS n),
  branches AS (
    (SELECT r.episode_id, 0 AS pref, c.published_at
       FROM episode_topic_relevance_reviews r
       JOIN episode_cards c ON c.episode_id = r.episode_id
      WHERE r.topic_id = _topic_id AND r.status = 'accepted'
      ORDER BY c.published_at DESC NULLS LAST
      LIMIT (SELECT n FROM lim))
    UNION ALL
    (SELECT m.episode_id, 1 AS pref, m.published_at
       FROM episode_topic_slug_map m
      WHERE _slug IS NOT NULL AND m.slug = _slug AND coalesce(m.confidence, 1) >= 0.6
      ORDER BY m.published_at DESC NULLS LAST
      LIMIT (SELECT n FROM lim))
    UNION ALL
    (SELECT t.episode_id, 2 AS pref, c.published_at
       FROM episode_topic_map t
       JOIN episode_cards c ON c.episode_id = t.episode_id
      WHERE t.topic_id = _topic_id
      ORDER BY c.published_at DESC NULLS LAST
      LIMIT (SELECT n FROM lim))
  ),
  ranked AS (
    SELECT b.episode_id, min(b.pref) AS pref, max(b.published_at) AS published_at
      FROM branches b
     WHERE NOT EXISTS (
       SELECT 1 FROM episode_topic_relevance_reviews r
        WHERE r.topic_id = _topic_id AND r.episode_id = b.episode_id AND r.status = 'rejected'
     )
     GROUP BY b.episode_id
  ),
  picked AS (
    SELECT * FROM ranked ORDER BY pref, published_at DESC NULLS LAST LIMIT (SELECT n FROM lim)
  )
  SELECT e.episode_id, e.title, e.display_title, e.slug, e.image_url, e.published_at,
         e.card_summary, e.audio_url, e.people, e.mentioned, e.topics, e.companies, e.tickers,
         e.podcast_id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured,
         CASE k.pref WHEN 0 THEN 'review' WHEN 1 THEN 'classification' ELSE 'map' END
    FROM picked k
    JOIN episode_cards e ON e.episode_id = k.episode_id
    JOIN podcasts p ON p.id = e.podcast_id
   WHERE p.language_decision = 'accept_hungarian'
   ORDER BY k.pref, k.published_at DESC NULLS LAST;
$function$;