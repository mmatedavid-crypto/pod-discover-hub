
-- Episode transcripts table
CREATE TABLE IF NOT EXISTS public.episode_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL,
  podcast_id uuid NOT NULL,
  model text NOT NULL,
  language text,
  transcript text NOT NULL,
  segments jsonb,
  duration_seconds integer,
  audio_bytes bigint,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric,
  content_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, model)
);

CREATE INDEX IF NOT EXISTS idx_episode_transcripts_podcast ON public.episode_transcripts(podcast_id);
CREATE INDEX IF NOT EXISTS idx_episode_transcripts_model ON public.episode_transcripts(model);
CREATE INDEX IF NOT EXISTS idx_episode_transcripts_created ON public.episode_transcripts(created_at DESC);

ALTER TABLE public.episode_transcripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ep_transcripts public read"
  ON public.episode_transcripts FOR SELECT USING (true);

CREATE POLICY "ep_transcripts admin write"
  ON public.episode_transcripts FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_episode_transcripts()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_touch_episode_transcripts ON public.episode_transcripts;
CREATE TRIGGER trg_touch_episode_transcripts
  BEFORE UPDATE ON public.episode_transcripts
  FOR EACH ROW EXECUTE FUNCTION public.touch_episode_transcripts();

-- Kind-filtered job claim (so STT runner doesn't steal SEO jobs and vice versa)
CREATE OR REPLACE FUNCTION public.claim_ai_jobs_by_kind(
  _kind text,
  _limit integer,
  _lock_seconds integer DEFAULT 300
)
RETURNS SETOF public.ai_enrichment_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.ai_enrichment_jobs j
     SET status = 'processing',
         locked_until = now() + make_interval(secs => _lock_seconds),
         started_at = now(),
         attempts = attempts + 1
   WHERE j.id IN (
     SELECT id FROM public.ai_enrichment_jobs
      WHERE kind = _kind
        AND ((status = 'pending')
          OR (status = 'processing' AND locked_until < now()))
      ORDER BY priority DESC, created_at ASC
      LIMIT _limit
      FOR UPDATE SKIP LOCKED
   )
   RETURNING *;
END $$;

-- Seed STT controls (disabled by default; you enable after pilot)
INSERT INTO public.app_settings (key, value)
VALUES ('stt_controls', jsonb_build_object(
  'enabled', false,
  'model', 'google/gemini-2.5-flash',
  'daily_budget_usd', 5,
  'batch_size', 4,
  'concurrency', 2,
  'max_audio_mb', 25,
  'max_duration_min', 120,
  'tiers', jsonb_build_array('S','A'),
  'skip_if_no_audio', true,
  'max_attempts', 2
))
ON CONFLICT (key) DO NOTHING;
