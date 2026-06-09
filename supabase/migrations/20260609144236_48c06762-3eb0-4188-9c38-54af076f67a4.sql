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
GRANT SELECT ON public.episode_article_candidates TO authenticated;
GRANT ALL ON public.episode_article_candidates TO service_role;
CREATE INDEX IF NOT EXISTS episode_article_candidates_episode_idx ON public.episode_article_candidates (episode_id, match_score DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS episode_article_candidates_podcast_idx ON public.episode_article_candidates (podcast_id, status, match_score DESC);
CREATE INDEX IF NOT EXISTS episode_article_candidates_outlet_idx ON public.episode_article_candidates (outlet, article_published_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS episode_article_candidates_confirmed_idx ON public.episode_article_candidates (episode_id, match_score DESC) WHERE status = 'confirmed';

ALTER TABLE public.episode_article_candidates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "episode article candidates admin read" ON public.episode_article_candidates;
CREATE POLICY "episode article candidates admin read" ON public.episode_article_candidates FOR SELECT USING (has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "episode article candidates service write" ON public.episode_article_candidates;
CREATE POLICY "episode article candidates service write" ON public.episode_article_candidates FOR ALL USING (auth.role() = 'service_role' OR has_role(auth.uid(), 'admin')) WITH CHECK (auth.role() = 'service_role' OR has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "episode article candidates readonly verifier read" ON public.episode_article_candidates;
CREATE POLICY "episode article candidates readonly verifier read" ON public.episode_article_candidates FOR SELECT USING (current_user = 'readonly_codex');
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN GRANT SELECT ON public.episode_article_candidates TO readonly_codex; END IF; END $$;

ALTER TABLE public.episode_best_text_source DROP CONSTRAINT IF EXISTS episode_best_text_source_source_type_check;
ALTER TABLE public.episode_best_text_source
  ADD CONSTRAINT episode_best_text_source_source_type_check
  CHECK (source_type IN ('rss', 'spotify', 'youtube', 'article', 'transcript'));
ALTER TABLE public.episode_best_text_source VALIDATE CONSTRAINT episode_best_text_source_source_type_check;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_article_pairer_controls',
  jsonb_build_object(
    'enabled', true,
    'policy', 'publisher_article_match_v1',
    'source_version', 'publisher_sources_v4',
    'pattern_safety_version', 'brand_anchor_no_topic_words_v2',
    'patterns_policy', 'brand_or_show_name_only_no_topic_words',
    'blocked_generic_title_patterns', jsonb_build_array(
      'téma', 'közélet', 'gazdaság', 'tech', 'tudomány',
      'biznisz', 'forint', 'tőzsde', 'befektetés', 'checklist', 'after'
    ),
    'batch_limit', 220, 'sources_per_run', 3, 'article_feed_item_limit', 120,
    'max_article_fetches_per_run', 40, 'fetch_article_html', true,
    'recent_episode_days', 90, 'recent_article_days', 90,
    'auto_confirm_threshold', 0.82, 'needs_review_threshold', 0.68,
    'reasserted_by', '20260608192000_reassert_article_pipeline_policy_v5_final',
    'sources', jsonb_build_array(
      jsonb_build_object('outlet','444','feed_urls',jsonb_build_array('https://444.hu/feed'),'listing_urls',jsonb_build_array('https://444.hu/category/podcast','https://444.hu/cimke/podcast'),'podcast_title_patterns',jsonb_build_array('444','borízű','tyúkól','saját tőke','háromharmad')),
      jsonb_build_object('outlet','telex','feed_urls',jsonb_build_array('https://telex.hu/rss?tag=podcast','https://telex.hu/rss'),'listing_urls',jsonb_build_array('https://telex.hu/rovat/podcast','https://telex.hu/cimke/podcast'),'podcast_title_patterns',jsonb_build_array('telex','telex after','nyomozó podcast','ízfokozó','telex filmklub')),
      jsonb_build_object('outlet','hvg','feed_urls',jsonb_build_array('https://hvg.hu/rss','https://hvg.hu/rss/podcast'),'listing_urls',jsonb_build_array('https://hvg.hu/podcastok','https://hvg.hu/itthon/podcast','https://hvg.hu/gazdasag/podcast','https://hvg.hu/tudomany/podcast'),'podcast_title_patterns',jsonb_build_array('hvg','fülke')),
      jsonb_build_object('outlet','portfolio','feed_urls',jsonb_build_array('https://www.portfolio.hu/rss/all.xml'),'listing_urls',jsonb_build_array('https://www.portfolio.hu/podcast','https://www.portfolio.hu/uzlet/podcast'),'podcast_title_patterns',jsonb_build_array('portfolio','portfolio checklist')),
      jsonb_build_object('outlet','hold','feed_urls',jsonb_build_array('https://hold.hu/holdblog/feed/'),'listing_urls',jsonb_build_array('https://hold.hu/holdblog/','https://hold.hu/holdblog/tag/podcast/','https://hold.hu/holdblog/tag/hold-after-hours/'),'podcast_title_patterns',jsonb_build_array('hold','hold after hours','holdblog')),
      jsonb_build_object('outlet','partizan','feed_urls',jsonb_build_array('https://www.partizan.hu/rss.xml'),'listing_urls',jsonb_build_array('https://www.partizan.hu/podcastok','https://www.partizan.hu/blog'),'podcast_title_patterns',jsonb_build_array('partizán','partizan','vétó','partizán podcast','háromharmad')),
      jsonb_build_object('outlet','qubit','feed_urls',jsonb_build_array('https://qubit.hu/feed'),'listing_urls',jsonb_build_array('https://qubit.hu/tag/podcast'),'podcast_title_patterns',jsonb_build_array('qubit','qubit podcast'))
    )
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_best_text_source_controls',
  jsonb_build_object(
    'enabled', true, 'batch_limit', 1000,
    'youtube_min_confidence', 0.78, 'spotify_min_confidence', 0.55,
    'article_min_confidence', 0.82, 'transcript_min_chars', 900,
    'prefer_external_gain_chars', 150, 'article_prefer_gain_chars', 300,
    'rescan_after_days', 7,
    'policy', 'best_text_source_v3_transcript_first_confirmed_article_youtube',
    'reasserted_by', '20260608192000_reassert_article_pipeline_policy_v5_final'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = public.app_settings.value || jsonb_build_object(
    'enabled', true, 'batch_limit', 1000,
    'youtube_min_confidence', 0.78, 'spotify_min_confidence', 0.55,
    'article_min_confidence', 0.82, 'transcript_min_chars', 900,
    'prefer_external_gain_chars', 150, 'article_prefer_gain_chars', 300,
    'rescan_after_days', 7,
    'policy', 'best_text_source_v3_transcript_first_confirmed_article_youtube',
    'reasserted_by', '20260608192000_reassert_article_pipeline_policy_v5_final'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'database_quality_fast_lane',
  jsonb_build_object('run_article_pairer', true, 'article_pairer_limit', 220, 'article_pairer_sources_per_run', 3, 'run_best_text_source', true),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_article_candidate_readonly_policy',
  jsonb_build_object('version', 1, 'policy', 'episode article candidates readonly verifier read', 'role', 'readonly_codex'),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();