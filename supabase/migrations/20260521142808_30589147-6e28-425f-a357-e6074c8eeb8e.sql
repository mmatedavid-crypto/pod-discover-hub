
-- 1. Events log
CREATE TABLE IF NOT EXISTS public.watchdog_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  runner text NOT NULL,
  rule text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warn','critical')),
  reason text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  auto_paused boolean NOT NULL DEFAULT false,
  dry_run boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_note text
);

CREATE INDEX IF NOT EXISTS idx_watchdog_events_runner ON public.watchdog_events (runner, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchdog_events_open ON public.watchdog_events (runner, rule) WHERE resolved_at IS NULL;

ALTER TABLE public.watchdog_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read watchdog events" ON public.watchdog_events;
CREATE POLICY "Admins read watchdog events"
  ON public.watchdog_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins update watchdog events" ON public.watchdog_events;
CREATE POLICY "Admins update watchdog events"
  ON public.watchdog_events FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Inserts done by edge fn (service role). No insert policy needed.

-- 2. Seed watchdog_state config (dry_run true initially, runner registry)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'watchdog_state',
  jsonb_build_object(
    'dry_run', true,
    'enabled', true,
    'alert_dedup_minutes', 30,
    'budget_overshoot_ratio', 1.20,
    'stale_lock_minutes', 60,
    'runners', jsonb_build_array(
      jsonb_build_object('name','embed_episode_chunks','controls_key','embed_episode_chunks_controls','progress_key','embed_episode_chunks_progress','spend_key','embed_episode_chunks_usd','cadence_minutes',1),
      jsonb_build_object('name','embed_episode','controls_key','embed_episode_controls','progress_key','embed_episode_progress','spend_key','embed_episode_usd','cadence_minutes',30),
      jsonb_build_object('name','embed_podcast','controls_key','embed_podcast_controls','progress_key','embed_progress','spend_key','embed_podcast_usd','cadence_minutes',15),
      jsonb_build_object('name','seo_enrich','controls_key','ai_seo_controls','progress_key',null,'spend_key','seo_enrich','cadence_minutes',30),
      jsonb_build_object('name','entity_backfill','controls_key','entity_backfill_controls','progress_key',null,'spend_key','entity_backfill','cadence_minutes',15),
      jsonb_build_object('name','ai_categorize','controls_key','ai_categorize_controls','progress_key',null,'spend_key','categorize','cadence_minutes',360),
      jsonb_build_object('name','entity_profile','controls_key','entity_profile_controls','progress_key',null,'spend_key','entity_profile','cadence_minutes',360),
      jsonb_build_object('name','episode_topic_judge','controls_key','episode_topic_judge_controls','progress_key',null,'spend_key','topic_judge','cadence_minutes',5),
      jsonb_build_object('name','person_relevance_judge','controls_key','person_relevance_judge_controls','progress_key',null,'spend_key','person_relevance','cadence_minutes',2),
      jsonb_build_object('name','episode_classifier','controls_key','episode_ai_classifier_controls','progress_key',null,'spend_key','episode_classifier','cadence_minutes',1),
      jsonb_build_object('name','youtube_transcript','controls_key','youtube_transcript_controls','progress_key',null,'spend_key','youtube_transcript','cadence_minutes',5),
      jsonb_build_object('name','episode_clean_text','controls_key','episode_clean_text_controls','progress_key','episode_clean_text_progress','spend_key',null,'cadence_minutes',2)
    )
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
