-- Corrective Lovable Cloud backend deploy for Codex migrations that GitHub Actions could not apply.

-- Weekly editorial controls and cron.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'weekly_editorial_controls',
  jsonb_build_object(
    'enabled', true,
    'policy', 'weekly_editorial_v3_auto_public_hu_diverse',
    'cadence', 'weekly_monday_morning',
    'min_text_chars', 180,
    'max_candidates', 500,
    'allow_reuse_existing_week', true,
    'auto_publish', true,
    'model', 'google/gemini-2.5-flash',
    'note', 'Weekly public editorial. Reuses the current week post, publishes automatically, and avoids repeat AI billing for the same week.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-weekly-editorial-post') THEN
    PERFORM cron.unschedule('podiverzum-weekly-editorial-post');
  END IF;

  PERFORM cron.schedule(
    'podiverzum-weekly-editorial-post',
    '30 6 * * 1',
    $cmd$
    SELECT net.http_post(
      url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/weekly-editorial-post',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"weekly_cron","publish":true,"ts":"', now(), '"}')::jsonb
    );
    $cmd$
  );
END $$;

WITH bounds AS (
  SELECT (current_date - interval '7 days')::date AS week_start, current_date::date AS week_end
),
base_candidates AS (
  SELECT
    e.id AS episode_id,
    e.slug AS episode_slug,
    COALESCE(NULLIF(e.display_title, ''), e.title) AS episode_title,
    e.published_at,
    p.id AS podcast_id,
    p.slug AS podcast_slug,
    COALESCE(NULLIF(p.display_title, ''), p.title) AS podcast_name,
    regexp_replace(
      regexp_replace(lower(COALESCE(NULLIF(p.display_title, ''), p.title, p.slug)), '\m(podcast|podcastok|radio|rádió|musor|műsor)\M', '', 'gi'),
      '[^a-z0-9áéíóöőúüű]+', '', 'g'
    ) AS brand_key,
    COALESCE(NULLIF(ct.cleaned_text, ''), NULLIF(e.ai_summary, ''), NULLIF(e.summary, ''), NULLIF(e.description, ''), '') AS source_text,
    (
      CASE p.rank_label WHEN 'S' THEN 140 WHEN 'A' THEN 95 WHEN 'B' THEN 55 WHEN 'C' THEN 20 ELSE 0 END
      + LEAST(40, GREATEST(0, 8 - EXTRACT(day FROM (now() - e.published_at)))::int * 5)
      + LEAST(20, COALESCE(p.podiverzum_rank, 0)::int * 2)
    ) AS score
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  LEFT JOIN public.episode_clean_text ct ON ct.episode_id = e.id
  WHERE e.published_at >= now() - interval '9 days'
    AND e.slug IS NOT NULL
    AND p.slug IS NOT NULL
    AND p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND COALESCE(p.rss_status, '') NOT IN ('failed', 'inactive', 'deleted')
    AND COALESCE(p.category, '') <> 'Religion & Spirituality'
    AND (p.rank_label IN ('S', 'A', 'B', 'C') OR p.featured = true)
    AND length(COALESCE(NULLIF(ct.cleaned_text, ''), NULLIF(e.ai_summary, ''), NULLIF(e.summary, ''), NULLIF(e.description, ''), '')) >= 180
),
candidates AS (
  SELECT b.*, row_number() OVER (PARTITION BY b.podcast_id ORDER BY b.published_at DESC NULLS LAST) AS podcast_rn,
         row_number() OVER (PARTITION BY b.brand_key ORDER BY b.score DESC, b.published_at DESC NULLS LAST) AS brand_rn
  FROM base_candidates b
),
picked AS (
  SELECT * FROM candidates WHERE podcast_rn = 1 AND brand_rn = 1 ORDER BY score DESC, published_at DESC NULLS LAST LIMIT 5
),
numbered AS (
  SELECT row_number() OVER (ORDER BY score DESC, published_at DESC NULLS LAST) AS rn, * FROM picked
),
payload AS (
  SELECT b.week_start, b.week_end,
    jsonb_agg(jsonb_build_object(
      'episode_id', n.episode_id,
      'title', n.episode_title,
      'podcast_name', n.podcast_name,
      'podcast_slug', n.podcast_slug,
      'episode_slug', n.episode_slug,
      'url', 'https://podiverzum.hu/podcast/' || n.podcast_slug || '/' || n.episode_slug,
      'teaser', left(regexp_replace(n.source_text, '\s+', ' ', 'g'), 420),
      'quote', null,
      'cover_card_url', null,
      'score', n.score,
      'source_quality', null,
      'source_text_chars', length(n.source_text)
    ) ORDER BY n.rn) AS items
  FROM bounds b
  JOIN numbered n ON true
  GROUP BY b.week_start, b.week_end
)
INSERT INTO public.editorial_posts (
  week_start, week_end, status, title, intro, items, ig_caption, fb_caption,
  ai_model, generation_meta, trigger, approved_at, published_at
)
SELECT
  p.week_start,
  p.week_end,
  'published',
  'A hét a Podiverzumon',
  'Elindult a Podiverzum heti válogatása: friss magyar podcastok, erős témák és olyan epizódok, amelyekből látszik, miről beszél az ország.',
  p.items,
  'A hét a Podiverzumon: friss magyar podcastválogatás a Podiverzumon.',
  'A hét a Podiverzumon: friss magyar podcastválogatás a Podiverzumon. https://podiverzum.hu/heti',
  'sql_bootstrap_no_ai',
  jsonb_build_object('policy', 'weekly_editorial_public_bootstrap_v1', 'picked', jsonb_array_length(p.items), 'reason', 'Ensure /heti has a public current issue before the weekly AI cron creates the next editorial post.'),
  'migration_bootstrap',
  now(),
  now()
FROM payload p
WHERE jsonb_array_length(p.items) >= 3
  AND NOT EXISTS (
    SELECT 1 FROM public.editorial_posts ep
    WHERE ep.status = 'published'
      AND ep.week_start >= current_date - interval '10 days'
  );

-- News sitemap fast refresh controls and cron.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'news_sitemap_refresh_controls',
  jsonb_build_object(
    'enabled', true,
    'cadence_minutes', 15,
    'mode', 'refresh_sitemap_lite',
    'google_submit_policy', 'submit_only_when_news_sitemap_has_new_urls',
    'requires_google_secrets', jsonb_build_array('GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL', 'GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY', 'GOOGLE_SEARCH_CONSOLE_SITE_URL'),
    'note', 'Refreshes sitemap lite every 15 minutes; refresh-sitemap submits news-sitemap.xml to Google Search Console only when newly published news URLs appear.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-refresh-sitemap-lite-15min') THEN
    PERFORM cron.unschedule('podiverzum-refresh-sitemap-lite-15min');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-refresh-sitemap-lite-daily') THEN
    PERFORM cron.unschedule('podiverzum-refresh-sitemap-lite-daily');
  END IF;

  PERFORM cron.schedule(
    'podiverzum-refresh-sitemap-lite-15min',
    '*/15 * * * *',
    $cmd$
    SELECT net.http_post(
      url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/refresh-sitemap?type=lite',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8","Authorization":"Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"news_sitemap_fast_refresh","ts":"', now(), '"}')::jsonb
    );
    $cmd$
  );
END $$;

-- Hungarian-only public AI text guard.
CREATE OR REPLACE FUNCTION public.is_hungarianish_public_ai_text(_text text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  t text := lower(coalesce(_text, ''));
  words text[];
  total int;
  hu_hits int := 0;
  en_hits int := 0;
  dia_hits int := 0;
  w text;
  hu_ratio numeric;
  en_ratio numeric;
  dia_per100 numeric;
BEGIN
  IF _text IS NULL OR length(trim(_text)) < 20 THEN
    RETURN true;
  END IF;

  words := regexp_split_to_array(trim(regexp_replace(t, '[^[:alpha:]'']+', ' ', 'g')), '\s+');
  total := greatest(coalesce(array_length(words, 1), 0), 1);

  FOREACH w IN ARRAY words LOOP
    IF w = ANY (ARRAY[
      'és','hogy','a','az','egy','van','nem','mert','podcast','adás','adas','epizód','epizod',
      'beszélgetés','beszelgetes','magyar','témája','temaja','vendég','vendeg','műsor',
      'musor','hallgatók','hallgatok','szól','szol','bemutatja','körül','korul','kapcsolatban',
      'szerint','alapján','alapjan','közben','kozben','arról','arrol','erről','errol',
      'hazai','közéleti','kozeleti','gazdasági','gazdasagi','társadalmi','tarsadalmi'
    ]) THEN
      hu_hits := hu_hits + 1;
    ELSIF w = ANY (ARRAY[
      'the','and','of','to','in','is','for','on','with','that','this','are','was','were',
      'by','from','as','at','an','be','or','it','its','their','they','you','we','our',
      'your','has','have','had','but','not','which','also','more','than','these','those',
      'about','when','what','who','how','why','episode','discusses','explores','features',
      'conversation','interview','host','guest','listeners','summary'
    ]) THEN
      en_hits := en_hits + 1;
    END IF;
  END LOOP;

  dia_hits := length(t) - length(regexp_replace(t, '[áéíóöőúüű]', '', 'g'));
  hu_ratio := hu_hits::numeric / total::numeric;
  en_ratio := en_hits::numeric / total::numeric;
  dia_per100 := dia_hits::numeric / greatest(length(t), 1)::numeric * 100;

  IF en_ratio > 0.12 THEN
    RETURN false;
  END IF;

  IF en_ratio > 0.06 AND hu_ratio < 0.01 AND dia_per100 < 1.0 THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_hu_episode_public_ai_text()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.ai_summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.ai_summary) THEN
    NEW.ai_summary := NULL;
    NEW.ai_summary_source := NULL;
  END IF;
  IF NEW.summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.summary) THEN
    NEW.summary := NULL;
  END IF;
  IF NEW.seo_title IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.seo_title) THEN
    NEW.seo_title := NULL;
  END IF;
  IF NEW.seo_description IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.seo_description) THEN
    NEW.seo_description := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_hu_episode_ai_summary ON public.episodes;
DROP TRIGGER IF EXISTS trg_enforce_hu_episode_public_ai_text ON public.episodes;
CREATE TRIGGER trg_enforce_hu_episode_public_ai_text
BEFORE INSERT OR UPDATE OF ai_summary, summary, seo_title, seo_description ON public.episodes
FOR EACH ROW
EXECUTE FUNCTION public.enforce_hu_episode_public_ai_text();

CREATE OR REPLACE FUNCTION public.enforce_hu_podcast_public_ai_text()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.summary IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.summary) THEN
    NEW.summary := NULL;
  END IF;
  IF NEW.seo_title IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.seo_title) THEN
    NEW.seo_title := NULL;
  END IF;
  IF NEW.seo_description IS NOT NULL AND NOT public.is_hungarianish_public_ai_text(NEW.seo_description) THEN
    NEW.seo_description := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_hu_podcast_public_ai_text ON public.podcasts;
CREATE TRIGGER trg_enforce_hu_podcast_public_ai_text
BEFORE INSERT OR UPDATE OF summary, seo_title, seo_description ON public.podcasts
FOR EACH ROW
EXECUTE FUNCTION public.enforce_hu_podcast_public_ai_text();

CREATE TEMP TABLE tmp_non_hu_episode_public_text_v3 AS
SELECT e.id
FROM public.episodes e
JOIN public.podcasts p ON p.id = e.podcast_id
WHERE p.is_hungarian = TRUE
  AND p.language_decision = 'accept_hungarian'
  AND (
    (e.ai_summary IS NOT NULL AND length(trim(e.ai_summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.ai_summary))
    OR (e.summary IS NOT NULL AND length(trim(e.summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.summary))
    OR (e.seo_title IS NOT NULL AND length(trim(e.seo_title)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.seo_title))
    OR (e.seo_description IS NOT NULL AND length(trim(e.seo_description)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.seo_description))
  );

CREATE TEMP TABLE tmp_non_hu_podcast_public_text_v3 AS
SELECT p.id
FROM public.podcasts p
WHERE p.is_hungarian = TRUE
  AND p.language_decision = 'accept_hungarian'
  AND (
    (p.summary IS NOT NULL AND length(trim(p.summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(p.summary))
    OR (p.seo_title IS NOT NULL AND length(trim(p.seo_title)) >= 20 AND NOT public.is_hungarianish_public_ai_text(p.seo_title))
    OR (p.seo_description IS NOT NULL AND length(trim(p.seo_description)) >= 20 AND NOT public.is_hungarianish_public_ai_text(p.seo_description))
  );

UPDATE public.episodes e
SET
  ai_summary = CASE WHEN e.ai_summary IS NOT NULL AND length(trim(e.ai_summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.ai_summary) THEN NULL ELSE e.ai_summary END,
  ai_summary_source = CASE WHEN e.ai_summary IS NOT NULL AND length(trim(e.ai_summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.ai_summary) THEN NULL ELSE e.ai_summary_source END,
  summary = CASE WHEN e.summary IS NOT NULL AND length(trim(e.summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.summary) THEN NULL ELSE e.summary END,
  seo_title = CASE WHEN e.seo_title IS NOT NULL AND length(trim(e.seo_title)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.seo_title) THEN NULL ELSE e.seo_title END,
  seo_description = CASE WHEN e.seo_description IS NOT NULL AND length(trim(e.seo_description)) >= 20 AND NOT public.is_hungarianish_public_ai_text(e.seo_description) THEN NULL ELSE e.seo_description END,
  ai_enriched_at = NULL
FROM tmp_non_hu_episode_public_text_v3 bad
WHERE bad.id = e.id;

UPDATE public.podcasts p
SET
  summary = CASE WHEN p.summary IS NOT NULL AND length(trim(p.summary)) >= 20 AND NOT public.is_hungarianish_public_ai_text(p.summary) THEN NULL ELSE p.summary END,
  seo_title = CASE WHEN p.seo_title IS NOT NULL AND length(trim(p.seo_title)) >= 20 AND NOT public.is_hungarianish_public_ai_text(p.seo_title) THEN NULL ELSE p.seo_title END,
  seo_description = CASE WHEN p.seo_description IS NOT NULL AND length(trim(p.seo_description)) >= 20 AND NOT public.is_hungarianish_public_ai_text(p.seo_description) THEN NULL ELSE p.seo_description END,
  ai_enriched_at = NULL
FROM tmp_non_hu_podcast_public_text_v3 bad
WHERE bad.id = p.id;

INSERT INTO public.ai_enrichment_jobs (kind, target_type, target_id, priority, input_hash, status, result)
SELECT 'seo_episode', 'episode', bad.id, 100, md5('non_hu_public_text_repair_episode_v3:' || bad.id::text), 'pending', jsonb_build_object('reason', 'non_hu_public_text_repair', 'source', 'migration_20260603162000')
FROM tmp_non_hu_episode_public_text_v3 bad
ON CONFLICT (kind, target_type, target_id, input_hash) DO NOTHING;

INSERT INTO public.ai_enrichment_jobs (kind, target_type, target_id, priority, input_hash, status, result)
SELECT 'seo_podcast', 'podcast', bad.id, 100, md5('non_hu_public_text_repair_podcast_v3:' || bad.id::text), 'pending', jsonb_build_object('reason', 'non_hu_public_text_repair', 'source', 'migration_20260603162000')
FROM tmp_non_hu_podcast_public_text_v3 bad
ON CONFLICT (kind, target_type, target_id, input_hash) DO NOTHING;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'public_ai_language_guard_policy',
  jsonb_build_object(
    'version', 3,
    'language', 'hu',
    'applies_to', jsonb_build_array('episodes.ai_summary', 'episodes.summary', 'episodes.seo_title', 'episodes.seo_description', 'podcasts.summary', 'podcasts.seo_title', 'podcasts.seo_description'),
    'enforced_by', jsonb_build_array('edge_hu_language_guard', 'public.is_hungarianish_public_ai_text(text)', 'trg_enforce_hu_episode_public_ai_text', 'trg_enforce_hu_podcast_public_ai_text'),
    'repair_job_source', 'migration_20260603162000',
    'note', 'Public AI text on Podiverzum must be Hungarian. English-dominant fields are nulled by DB triggers and should be regenerated in Hungarian.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

DROP TABLE IF EXISTS tmp_non_hu_episode_public_text_v3;
DROP TABLE IF EXISTS tmp_non_hu_podcast_public_text_v3;

-- Publisher article pipeline.
CREATE TABLE IF NOT EXISTS public.episode_article_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  outlet text NOT NULL,
  article_url text NOT NULL,
  article_title text NOT NULL,
  article_excerpt text,
  article_text text,
  article_published_at timestamptz,
  match_score numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'candidate' CHECK (status IN ('candidate', 'confirmed', 'rejected', 'needs_review')),
  match_reasons text[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, article_url)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.episode_article_candidates TO authenticated;
GRANT ALL ON public.episode_article_candidates TO service_role;

CREATE INDEX IF NOT EXISTS episode_article_candidates_episode_idx ON public.episode_article_candidates (episode_id, match_score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS episode_article_candidates_podcast_idx ON public.episode_article_candidates (podcast_id, status, match_score DESC);
CREATE INDEX IF NOT EXISTS episode_article_candidates_outlet_idx ON public.episode_article_candidates (outlet, article_published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS episode_article_candidates_confirmed_idx ON public.episode_article_candidates (episode_id, match_score DESC) WHERE status = 'confirmed';

ALTER TABLE public.episode_article_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "episode article candidates admin read" ON public.episode_article_candidates;
CREATE POLICY "episode article candidates admin read"
  ON public.episode_article_candidates
  FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "episode article candidates service write" ON public.episode_article_candidates;
CREATE POLICY "episode article candidates service write"
  ON public.episode_article_candidates
  FOR ALL
  USING (auth.role() = 'service_role' OR has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.role() = 'service_role' OR has_role(auth.uid(), 'admin'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    GRANT SELECT ON public.episode_article_candidates TO readonly_codex;
  END IF;
END $$;

DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT c.conname
  INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'episode_best_text_source'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%source_type%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM pg_constraint c
       JOIN pg_class t ON t.oid = c.conrelid
       JOIN pg_namespace n ON n.oid = t.relnamespace
       WHERE n.nspname = 'public'
         AND t.relname = 'episode_best_text_source'
         AND c.contype = 'c'
         AND pg_get_constraintdef(c.oid) ILIKE '%source_type%'
         AND pg_get_constraintdef(c.oid) ILIKE '%article%'
     ) THEN
    EXECUTE format('ALTER TABLE public.episode_best_text_source DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'episode_best_text_source'
      AND c.conname = 'episode_best_text_source_source_type_check'
  ) THEN
    ALTER TABLE public.episode_best_text_source
      ADD CONSTRAINT episode_best_text_source_source_type_check
      CHECK (source_type IN ('rss', 'spotify', 'youtube', 'article'))
      NOT VALID;
  END IF;
END $$;

ALTER TABLE public.episode_best_text_source VALIDATE CONSTRAINT episode_best_text_source_source_type_check;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_article_pairer_controls',
  jsonb_build_object(
    'enabled', true,
    'policy', 'publisher_article_match_v1',
    'source_version', 'publisher_sources_v3',
    'batch_limit', 160,
    'article_feed_item_limit', 100,
    'max_article_fetches_per_run', 35,
    'fetch_article_html', true,
    'recent_episode_days', 60,
    'recent_article_days', 75,
    'auto_confirm_threshold', 0.82,
    'needs_review_threshold', 0.68,
    'sources', jsonb_build_array(
      jsonb_build_object('outlet', '444', 'feed_urls', jsonb_build_array('https://444.hu/feed'), 'listing_urls', jsonb_build_array('https://444.hu/category/podcast', 'https://444.hu/cimke/podcast'), 'podcast_title_patterns', jsonb_build_array('444', 'borízű', 'tyúkól', 'saját tőke', 'háromharmad')),
      jsonb_build_object('outlet', 'telex', 'feed_urls', jsonb_build_array('https://telex.hu/rss?tag=podcast', 'https://telex.hu/rss'), 'listing_urls', jsonb_build_array('https://telex.hu/rovat/podcast', 'https://telex.hu/cimke/podcast'), 'podcast_title_patterns', jsonb_build_array('telex', 'after', 'nyomozó', 'ízfokozó', 'téma', 'filmklub')),
      jsonb_build_object('outlet', 'hvg', 'feed_urls', jsonb_build_array('https://hvg.hu/rss', 'https://hvg.hu/rss/podcast'), 'listing_urls', jsonb_build_array('https://hvg.hu/podcastok', 'https://hvg.hu/itthon/podcast', 'https://hvg.hu/gazdasag/podcast', 'https://hvg.hu/tudomany/podcast'), 'podcast_title_patterns', jsonb_build_array('hvg', 'fülke', 'közélet', 'gazdaság', 'tech', 'tudomány')),
      jsonb_build_object('outlet', 'portfolio', 'feed_urls', jsonb_build_array('https://www.portfolio.hu/rss/all.xml'), 'listing_urls', jsonb_build_array('https://www.portfolio.hu/podcast', 'https://www.portfolio.hu/uzlet/podcast'), 'podcast_title_patterns', jsonb_build_array('portfolio', 'checklist', 'portfolio checklist', 'biznisz', 'forint', 'tőzsde')),
      jsonb_build_object('outlet', 'hold', 'feed_urls', jsonb_build_array('https://hold.hu/holdblog/feed/'), 'listing_urls', jsonb_build_array('https://hold.hu/holdblog/', 'https://hold.hu/holdblog/tag/podcast/', 'https://hold.hu/holdblog/tag/hold-after-hours/'), 'podcast_title_patterns', jsonb_build_array('hold', 'hold after hours', 'holdblog', 'after hours', 'befektetés')),
      jsonb_build_object('outlet', 'partizan', 'feed_urls', jsonb_build_array('https://www.partizan.hu/rss.xml'), 'listing_urls', jsonb_build_array('https://www.partizan.hu/podcastok', 'https://www.partizan.hu/blog'), 'podcast_title_patterns', jsonb_build_array('partizán', 'partizan', 'vétó', 'partizán podcast', 'háromharmad'))
    )
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'enabled', COALESCE(public.app_settings.value->'enabled', 'true'::jsonb),
    'policy', 'publisher_article_match_v1',
    'source_version', 'publisher_sources_v3',
    'batch_limit', 160,
    'article_feed_item_limit', 100,
    'max_article_fetches_per_run', 35,
    'fetch_article_html', true,
    'recent_episode_days', 60,
    'recent_article_days', 75,
    'auto_confirm_threshold', 0.82,
    'needs_review_threshold', 0.68,
    'sources', EXCLUDED.value->'sources'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_best_text_source_controls',
  jsonb_build_object(
    'enabled', true,
    'batch_limit', 10000,
    'youtube_min_confidence', 0.78,
    'spotify_min_confidence', 0.55,
    'prefer_external_gain_chars', 150,
    'article_min_confidence', 0.82,
    'article_prefer_gain_chars', 300,
    'policy', 'best_text_source_v2_confirmed_article_youtube_first'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'enabled', COALESCE(public.app_settings.value->'enabled', 'true'::jsonb),
    'batch_limit', COALESCE(public.app_settings.value->'batch_limit', '10000'::jsonb),
    'youtube_min_confidence', COALESCE(public.app_settings.value->'youtube_min_confidence', '0.78'::jsonb),
    'spotify_min_confidence', COALESCE(public.app_settings.value->'spotify_min_confidence', '0.55'::jsonb),
    'prefer_external_gain_chars', COALESCE(public.app_settings.value->'prefer_external_gain_chars', '150'::jsonb),
    'article_min_confidence', '0.82'::jsonb,
    'article_prefer_gain_chars', '300'::jsonb,
    'policy', 'best_text_source_v2_confirmed_article_youtube_first'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('database_quality_fast_lane', jsonb_build_object('run_article_pairer', true, 'article_pairer_limit', 160, 'run_best_text_source', true), now())
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object('run_article_pairer', true, 'article_pairer_limit', 160, 'run_best_text_source', true),
    updated_at = now();

-- Related/smart recommendation quality guard.
CREATE OR REPLACE FUNCTION public.recommendation_text_group(p_title text, p_podcast_title text, p_category text, p_topics text[])
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  WITH text_blob AS (
    SELECT lower(coalesce(p_title,'') || ' ' || coalesce(p_podcast_title,'') || ' ' || coalesce(p_category,'') || ' ' || array_to_string(coalesce(p_topics, ARRAY[]::text[]), ' ')) AS t
  )
  SELECT CASE
    WHEN t ~ '(mese|meseradio|meserádió|gyerek|gyermek|ovis|óvodás|altató|tündér|baba|esti mese|kids|children)' THEN 'children'
    WHEN t ~ '(közélet|kozelet|politika|politics|hírek|hirek|társadalom|tarsadalom|interjú|interju|közbeszéd|kozbeszed|orbán|orban|mészáros|meszaros|fidesz|tisza|kormány|kormany|parlament|párt|part|választás|valasztas|puzsér|puzser)' THEN 'public_affairs'
    WHEN t ~ '(üzlet|uzlet|business|gazdaság|gazdasag|pénz|penz|tőzsde|tozsde|befektetés|befektetes|milliárdos|milliardos|cég|ceg|vállalkozás|vallalkozas|ingatlan|karrier|menedzsment|részvény|reszveny)' THEN 'business'
    WHEN t ~ '(vallás|vallas|hit|keresztény|kereszteny|isten|biblia|egyház|egyhaz|istentisztelet|igehirdetés|igehirdetes|prédikáció|predikacio|katolikus|református|reformatus|baptista|evangélium|evangelium|áhítat|ahitat|religion|spirituality)' THEN 'religion'
    WHEN t ~ '(egészség|egeszseg|orvos|pszicho|mentális|mentalis|életmód|eletmod|sport)' THEN 'health'
    ELSE 'general'
  END
  FROM text_blob;
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_has_topic_bridge(p_source_topics text[], p_candidate_topics text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(coalesce(p_source_topics, ARRAY[]::text[])) s(topic)
    JOIN unnest(coalesce(p_candidate_topics, ARRAY[]::text[])) c(topic)
      ON lower(s.topic) = lower(c.topic)
  );
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_is_compatible(p_source_group text, p_candidate_group text, p_similarity double precision, p_has_topic_bridge boolean)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN (p_source_group = 'religion') <> (p_candidate_group = 'religion') THEN false
    WHEN p_candidate_group = 'children' AND p_source_group <> 'children' THEN false
    WHEN p_source_group = 'children' AND p_candidate_group <> 'children' AND NOT p_has_topic_bridge THEN false
    WHEN p_source_group <> 'general' AND p_candidate_group <> 'general' AND p_source_group <> p_candidate_group THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.72
    WHEN p_source_group <> 'general' AND p_candidate_group = 'general' THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.66
    WHEN p_candidate_group <> 'general' AND p_source_group = 'general' THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.66
    ELSE p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.56 OR p_source_group = p_candidate_group
  END;
$function$;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'related_episode_quality_policy',
  jsonb_build_object(
    'version', 3,
    'religion_cross_group', 'hard_block',
    'children_cross_group', 'hard_block_except_children_source_with_explicit_bridge',
    'public_affairs_override_terms', jsonb_build_array('orbán', 'mészáros', 'fidesz', 'tisza', 'kormány', 'parlament', 'párt', 'választás', 'puzsér'),
    'known_false_positive_fixed', 'puzser_public_affairs_title_with_isten_must_not_match_sermon',
    'note', 'Smart player and related episode recommendations block religion/non-religion vector false positives; public-affairs political context wins over a single religion word in titles.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

-- People identity-safety RPCs.
DROP FUNCTION IF EXISTS public.list_people_hub(integer, integer, text);
CREATE OR REPLACE FUNCTION public.list_people_hub(p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text)
 RETURNS TABLE(
  id uuid, slug text, name text, disambiguation_label text, short_bio text, ai_bio text, image_url text,
  identity_ambiguous boolean, manual_approved boolean, ai_bio_status text, ai_bio_confidence numeric,
  wikipedia_match_status text, wikipedia_match_confidence numeric,
  episode_count integer, podcast_count integer, distinct_podcast_count integer,
  gated_episode_count integer, gated_podcast_count integer, host_count integer, guest_count integer,
  strong_mention_count integer, recent_relevant_episode_count_30d integer,
  latest_accepted_relevant_episode_at timestamp with time zone, people_hub_score numeric, total_count bigint
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH base AS (
    SELECT *
    FROM public.people p
    WHERE p.is_browsable_in_people_hub = true
      AND (p_search IS NULL OR length(trim(p_search)) < 2 OR p.normalized_name ILIKE '%' || lower(trim(p_search)) || '%' OR p.name ILIKE '%' || trim(p_search) || '%')
  ),
  counted AS (SELECT COUNT(*)::bigint AS tc FROM base)
  SELECT
    b.id, b.slug, b.name, b.disambiguation_label, b.short_bio, b.ai_bio, b.image_url,
    b.identity_ambiguous, b.manual_approved, b.ai_bio_status, b.ai_bio_confidence,
    b.wikipedia_match_status, b.wikipedia_match_confidence,
    b.episode_count, b.podcast_count, b.distinct_podcast_count,
    b.gated_episode_count, b.gated_podcast_count,
    b.host_count, b.guest_count, b.strong_mention_count,
    b.recent_relevant_episode_count_30d,
    b.latest_accepted_relevant_episode_at,
    b.people_hub_score,
    c.tc AS total_count
  FROM base b CROSS JOIN counted c
  ORDER BY b.people_hub_score DESC NULLS LAST, b.gated_episode_count DESC, b.name ASC
  LIMIT GREATEST(LEAST(p_limit, 200), 1)
  OFFSET GREATEST(p_offset, 0);
$function$;

DROP FUNCTION IF EXISTS public.list_people_alpha(text, integer, integer);
CREATE OR REPLACE FUNCTION public.list_people_alpha(p_letter text DEFAULT NULL::text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
 RETURNS TABLE(
  id uuid, slug text, name text, disambiguation_label text, short_bio text, ai_bio text, image_url text,
  identity_ambiguous boolean, manual_approved boolean, ai_bio_status text, ai_bio_confidence numeric,
  wikipedia_match_status text, wikipedia_match_confidence numeric,
  gated_episode_count integer, gated_podcast_count integer, episode_count integer, podcast_count integer,
  latest_accepted_relevant_episode_at timestamp with time zone, host_count integer, guest_count integer,
  strong_mention_count integer, total_count bigint
 )
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH filtered AS (
    SELECT *
    FROM people p
    WHERE p.is_public = true
      AND p.is_browsable_in_people_hub = true
      AND COALESCE(p.gated_episode_count, 0) >= 1
      AND (p_letter IS NULL OR (p_letter = '#' AND NOT (upper(unaccent(left(p.name,1))) ~ '^[A-Z]$')) OR upper(unaccent(left(p.name,1))) = upper(p_letter))
  ),
  counted AS (SELECT count(*)::bigint AS total FROM filtered)
  SELECT
    f.id, f.slug, f.name, f.disambiguation_label, f.short_bio, f.ai_bio, f.image_url,
    f.identity_ambiguous, f.manual_approved, f.ai_bio_status, f.ai_bio_confidence,
    f.wikipedia_match_status, f.wikipedia_match_confidence,
    f.gated_episode_count, f.gated_podcast_count, f.episode_count, f.podcast_count,
    f.latest_accepted_relevant_episode_at, f.host_count, f.guest_count, f.strong_mention_count,
    c.total AS total_count
  FROM filtered f, counted c
  ORDER BY unaccent(f.name) ASC, f.name ASC
  LIMIT p_limit OFFSET p_offset;
$function$;

GRANT EXECUTE ON FUNCTION public.list_people_hub(integer, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_people_alpha(text, integer, integer) TO anon, authenticated;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'people_hub_identity_safety_policy',
  jsonb_build_object(
    'version', 2,
    'card_bio_rule', 'Do not show short_bio/ai_bio on ambiguous unapproved identities unless Wikipedia is verified with high confidence.',
    'prerender_bio_rule', 'Prerendered person HTML and JSON-LD must use the same safe generated-bio gate before publishing ai_bio or short_bio.',
    'verified_wikipedia_threshold', 0.8,
    'generated_bio_min_confidence', 0.75,
    'fields_added_to_rpc', jsonb_build_array('identity_ambiguous', 'manual_approved', 'ai_bio_status', 'ai_bio_confidence', 'wikipedia_match_status', 'wikipedia_match_confidence')
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

-- Clean-text backfill quality gate.
CREATE OR REPLACE FUNCTION public.requeue_legacy_clean_text_v4_backfill(_limit integer DEFAULT 1000, _tiers text[] DEFAULT ARRAY['S','A','B','C','D'])
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_limit integer := GREATEST(1, LEAST(COALESCE(_limit, 1000), 5000));
  v_result jsonb;
BEGIN
  WITH chosen AS (
    SELECT e.id, COALESCE(p.shadow_rank_tier, p.rank_label, 'D') AS tier,
      CASE COALESCE(p.shadow_rank_tier, p.rank_label, 'D') WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 WHEN 'C' THEN 3 WHEN 'D' THEN 4 ELSE 5 END AS tier_order,
      e.published_at
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    JOIN public.episode_clean_text ct ON ct.episode_id = e.id
    WHERE p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND COALESCE(e.description, e.summary, '') <> ''
      AND COALESCE(e.clean_text_status, 'pending') = 'done'
      AND COALESCE(ct.cleaner_method, '') NOT LIKE 'deterministic_v4%'
      AND COALESCE(p.shadow_rank_tier, p.rank_label, 'D') = ANY(_tiers)
    ORDER BY tier_order, e.published_at DESC NULLS LAST, e.updated_at DESC NULLS LAST
    LIMIT v_limit
  ),
  updated AS (
    UPDATE public.episodes e
    SET clean_text_status = 'pending'
    FROM chosen c
    WHERE e.id = c.id
    RETURNING e.id, c.tier
  ),
  by_tier AS (
    SELECT tier, count(*) AS n FROM updated GROUP BY tier
  )
  SELECT jsonb_build_object(
    'ok', true,
    'policy', 'legacy_v3_to_pending_for_deterministic_v4_manual_canary',
    'requested_limit', v_limit,
    'tiers', to_jsonb(_tiers),
    'requeued', COALESCE((SELECT count(*) FROM updated), 0),
    'by_tier', COALESCE((SELECT jsonb_object_agg(tier, n) FROM by_tier), '{}'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.requeue_legacy_clean_text_v4_backfill(integer, text[]) TO service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_clean_text_controls',
  jsonb_build_object(
    'enabled', true,
    'batch_limit', 1000,
    'method_version', 'deterministic_v4',
    'time_budget_seconds', 75,
    'min_description_chars', 40,
    'use_best_text_source', true,
    'legacy_v3_backfill_enabled', false,
    'legacy_v3_backfill_mode', 'manual_canary_only',
    'legacy_v3_backfill_limit', 100,
    'legacy_v3_backfill_tiers', jsonb_build_array('S','A','B','C','D'),
    'quality_gate_required_before_global_backfill', true,
    'quality_gate_min_sample_size', 300,
    'quality_gate_max_overcut_rate', 0.01,
    'quality_gate_max_remaining_dirty_rate', 0.05,
    'quality_gate_min_improvement_rate_on_dirty_rows', 0.70,
    'note', 'Use best text source for new clean text. Legacy v3 global backfill is frozen; only bounded manual canaries may reopen old rows until quality proof passes.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'enabled', true,
    'batch_limit', COALESCE(public.app_settings.value->'batch_limit', '1000'::jsonb),
    'method_version', 'deterministic_v4',
    'time_budget_seconds', 75,
    'min_description_chars', COALESCE(public.app_settings.value->'min_description_chars', '40'::jsonb),
    'use_best_text_source', true,
    'legacy_v3_backfill_enabled', false,
    'legacy_v3_backfill_mode', 'manual_canary_only',
    'legacy_v3_backfill_limit', 100,
    'legacy_v3_backfill_tiers', jsonb_build_array('S','A','B','C','D'),
    'quality_gate_required_before_global_backfill', true,
    'quality_gate_min_sample_size', 300,
    'quality_gate_max_overcut_rate', 0.01,
    'quality_gate_max_remaining_dirty_rate', 0.05,
    'quality_gate_min_improvement_rate_on_dirty_rows', 0.70,
    'note', 'Use best text source for new clean text. Legacy v3 global backfill is frozen; only bounded manual canaries may reopen old rows until quality proof passes.'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'text_processing_policy',
  jsonb_build_object(
    'version', 'best_source_clean_text_first_v4_quality_gated',
    'order', jsonb_build_array('episode_best_text_source', 'episode_clean_text.deterministic_v4_family', 'seo_ai_summary_entities', 'episode_chunks_embeddings'),
    'embedding_requires_clean_text', true,
    'seo_episode_requires_clean_text_or_transcript', true,
    'accepted_cleaner_method_prefix', 'deterministic_v4',
    'legacy_v3_backfill', 'manual_canary_only_until_quality_proof',
    'clean_text_backfill_status', 'frozen_pending_quality_proof',
    'clean_text_quality_audit_required', true,
    'note', 'Do not globally reprocess legacy v3 clean text until sampled audit proves improvement without overcut. New processing uses best text source first.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'version', 'best_source_clean_text_first_v4_quality_gated',
    'accepted_cleaner_method_prefix', 'deterministic_v4',
    'legacy_v3_backfill', 'manual_canary_only_until_quality_proof',
    'clean_text_backfill_status', 'frozen_pending_quality_proof',
    'clean_text_quality_audit_required', true,
    'note', 'Do not globally reprocess legacy v3 clean text until sampled audit proves improvement without overcut. New processing uses best text source first.'
  ),
  updated_at = now();

-- Mark the original Codex migration versions as applied only after applying their effective end state above.
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES
  ('20260602200000', 'weekly_editorial_public_bootstrap', ARRAY['Applied by corrective Lovable Cloud migration after GitHub Actions target/secret mismatch.']),
  ('20260603111500', 'news_sitemap_fast_refresh_cron', ARRAY['Applied by corrective Lovable Cloud migration after GitHub Actions target/secret mismatch.']),
  ('20260603124500', 'expand_publisher_article_sources_v3', ARRAY['Superseded and applied by article_pipeline_consolidated in corrective Lovable Cloud migration.']),
  ('20260603131000', 'stricter_hu_public_ai_text_guard', ARRAY['Superseded and applied by public_ai_language_guard_consolidated in corrective Lovable Cloud migration.']),
  ('20260603143000', 'related_episode_religion_hard_guard', ARRAY['Superseded and applied by related_episode_quality_consolidated in corrective Lovable Cloud migration.']),
  ('20260603150000', 'people_hub_identity_safety_fields', ARRAY['Superseded and applied by people_identity_safety_consolidated in corrective Lovable Cloud migration.']),
  ('20260603162000', 'public_ai_language_guard_consolidated', ARRAY['Applied by corrective Lovable Cloud migration after GitHub Actions target/secret mismatch.']),
  ('20260603164000', 'article_pipeline_consolidated', ARRAY['Applied by corrective Lovable Cloud migration after GitHub Actions target/secret mismatch; includes explicit Data API grants.']),
  ('20260603165000', 'related_episode_quality_consolidated', ARRAY['Applied by corrective Lovable Cloud migration after GitHub Actions target/secret mismatch.']),
  ('20260603170000', 'people_identity_safety_consolidated', ARRAY['Applied by corrective Lovable Cloud migration after GitHub Actions target/secret mismatch.']),
  ('20260603171000', 'clean_text_backfill_quality_gate_consolidated', ARRAY['Applied by corrective Lovable Cloud migration after GitHub Actions target/secret mismatch.'])
ON CONFLICT (version) DO NOTHING;