-- Consolidated publisher article pipeline.
-- Keeps the Telex/444/HVG/Portfolio/Hold/Partizan article matcher deploy-safe:
-- table, grants, best-text-source article support, v3 source policy and fast-lane
-- orchestration are all restated idempotently here.

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
  status text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate', 'confirmed', 'rejected', 'needs_review')),
  match_reasons text[] NOT NULL DEFAULT '{}',
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, article_url)
);

CREATE INDEX IF NOT EXISTS episode_article_candidates_episode_idx
  ON public.episode_article_candidates (episode_id, match_score DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS episode_article_candidates_podcast_idx
  ON public.episode_article_candidates (podcast_id, status, match_score DESC);

CREATE INDEX IF NOT EXISTS episode_article_candidates_outlet_idx
  ON public.episode_article_candidates (outlet, article_published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS episode_article_candidates_confirmed_idx
  ON public.episode_article_candidates (episode_id, match_score DESC)
  WHERE status = 'confirmed';

ALTER TABLE public.episode_article_candidates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "episode article candidates admin read" ON public.episode_article_candidates;
CREATE POLICY "episode article candidates admin read"
  ON public.episode_article_candidates
  FOR SELECT
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

ALTER TABLE public.episode_best_text_source
  VALIDATE CONSTRAINT episode_best_text_source_source_type_check;

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
      jsonb_build_object(
        'outlet', '444',
        'feed_urls', jsonb_build_array('https://444.hu/feed'),
        'listing_urls', jsonb_build_array('https://444.hu/category/podcast', 'https://444.hu/cimke/podcast'),
        'podcast_title_patterns', jsonb_build_array('444', 'borízű', 'tyúkól', 'saját tőke', 'háromharmad')
      ),
      jsonb_build_object(
        'outlet', 'telex',
        'feed_urls', jsonb_build_array('https://telex.hu/rss?tag=podcast', 'https://telex.hu/rss'),
        'listing_urls', jsonb_build_array('https://telex.hu/rovat/podcast', 'https://telex.hu/cimke/podcast'),
        'podcast_title_patterns', jsonb_build_array('telex', 'after', 'nyomozó', 'ízfokozó', 'téma', 'filmklub')
      ),
      jsonb_build_object(
        'outlet', 'hvg',
        'feed_urls', jsonb_build_array('https://hvg.hu/rss', 'https://hvg.hu/rss/podcast'),
        'listing_urls', jsonb_build_array('https://hvg.hu/podcastok', 'https://hvg.hu/itthon/podcast', 'https://hvg.hu/gazdasag/podcast', 'https://hvg.hu/tudomany/podcast'),
        'podcast_title_patterns', jsonb_build_array('hvg', 'fülke', 'közélet', 'gazdaság', 'tech', 'tudomány')
      ),
      jsonb_build_object(
        'outlet', 'portfolio',
        'feed_urls', jsonb_build_array('https://www.portfolio.hu/rss/all.xml'),
        'listing_urls', jsonb_build_array('https://www.portfolio.hu/podcast', 'https://www.portfolio.hu/uzlet/podcast'),
        'podcast_title_patterns', jsonb_build_array('portfolio', 'checklist', 'portfolio checklist', 'biznisz', 'forint', 'tőzsde')
      ),
      jsonb_build_object(
        'outlet', 'hold',
        'feed_urls', jsonb_build_array('https://hold.hu/holdblog/feed/'),
        'listing_urls', jsonb_build_array('https://hold.hu/holdblog/', 'https://hold.hu/holdblog/tag/podcast/', 'https://hold.hu/holdblog/tag/hold-after-hours/'),
        'podcast_title_patterns', jsonb_build_array('hold', 'hold after hours', 'holdblog', 'after hours', 'befektetés')
      ),
      jsonb_build_object(
        'outlet', 'partizan',
        'feed_urls', jsonb_build_array('https://www.partizan.hu/rss.xml'),
        'listing_urls', jsonb_build_array('https://www.partizan.hu/podcastok', 'https://www.partizan.hu/blog'),
        'podcast_title_patterns', jsonb_build_array('partizán', 'partizan', 'vétó', 'partizán podcast', 'háromharmad')
      )
    )
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
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
SET value = public.app_settings.value
  || jsonb_build_object(
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
VALUES (
  'database_quality_fast_lane',
  jsonb_build_object(
    'run_article_pairer', true,
    'article_pairer_limit', 160,
    'run_best_text_source', true
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'run_article_pairer', true,
    'article_pairer_limit', 160,
    'run_best_text_source', true
  ),
  updated_at = now();
