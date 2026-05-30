CREATE TABLE IF NOT EXISTS public.episode_best_text_source (
  episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('rss', 'spotify', 'youtube')),
  source_ref_id uuid,
  source_confidence numeric NOT NULL DEFAULT 0,
  source_reason text[] NOT NULL DEFAULT '{}',
  raw_text text NOT NULL,
  cleaned_preview text,
  raw_len integer NOT NULL DEFAULT 0,
  cleaned_len integer NOT NULL DEFAULT 0,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS episode_best_text_source_type_idx
  ON public.episode_best_text_source (source_type, source_confidence DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS episode_best_text_source_podcast_idx
  ON public.episode_best_text_source (podcast_id, updated_at DESC);

ALTER TABLE public.episode_best_text_source ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "episode best text source admin read" ON public.episode_best_text_source;
CREATE POLICY "episode best text source admin read"
  ON public.episode_best_text_source
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "episode best text source service write" ON public.episode_best_text_source;
CREATE POLICY "episode best text source service write"
  ON public.episode_best_text_source
  FOR ALL
  USING (auth.role() = 'service_role' OR has_role(auth.uid(), 'admin'))
  WITH CHECK (auth.role() = 'service_role' OR has_role(auth.uid(), 'admin'));

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    GRANT SELECT ON public.episode_best_text_source TO readonly_codex;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS episode_youtube_links_confirmed_episode_idx
  ON public.episode_youtube_links (episode_id, match_score DESC)
  WHERE status = 'confirmed';

CREATE INDEX IF NOT EXISTS episode_youtube_links_video_idx
  ON public.episode_youtube_links (youtube_video_id);

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'youtube_episode_pairer_controls',
  jsonb_build_object(
    'enabled', true,
    'tiers', jsonb_build_array('S','A','B','C','D','E'),
    'podcast_batch', 10,
    'strict_auto_pair_threshold', 0.84,
    'strict_ai_pair_threshold', 0.78,
    'min_ambiguity_gap', 0.04,
    'ai_validate_model', 'google/gemini-2.5-flash-lite',
    'max_videos_per_channel', 500,
    'rescan_after_days', 7,
    'policy', 'youtube_episode_match_v3'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'tiers', jsonb_build_array('S','A','B','C','D','E'),
    'strict_auto_pair_threshold', 0.84,
    'strict_ai_pair_threshold', 0.78,
    'min_ambiguity_gap', 0.04,
    'policy', 'youtube_episode_match_v3'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'database_quality_fast_lane',
  jsonb_build_object(
    'run_best_text_source', true,
    'best_text_source_limit', 1000
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'run_best_text_source', true,
    'best_text_source_limit', 1000
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_best_text_source_controls',
  jsonb_build_object(
    'enabled', true,
    'batch_limit', 1000,
    'youtube_min_confidence', 0.78,
    'spotify_min_confidence', 0.55,
    'prefer_external_gain_chars', 150,
    'rescan_after_days', 7,
    'policy', 'best_text_source_v1_confirmed_youtube_only'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'enabled', true,
    'policy', 'best_text_source_v1_confirmed_youtube_only'
  ),
  updated_at = now();
