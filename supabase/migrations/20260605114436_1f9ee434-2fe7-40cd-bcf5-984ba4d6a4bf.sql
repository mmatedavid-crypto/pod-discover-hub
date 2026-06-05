
ALTER TABLE public.episode_transcripts
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS rights_status text NOT NULL DEFAULT 'rss_public_index_only',
  ADD COLUMN IF NOT EXISTS public_display boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS latency_ms integer,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'ok',
  ADD COLUMN IF NOT EXISTS error_reason text;

CREATE INDEX IF NOT EXISTS idx_episode_transcripts_ok_episode
  ON public.episode_transcripts(episode_id) WHERE status = 'ok';

CREATE TABLE IF NOT EXISTS public.external_transcript_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid,
  model text,
  source text NOT NULL,
  status text NOT NULL,
  error_reason text,
  latency_ms integer,
  cost_usd numeric,
  audio_bytes bigint,
  duration_seconds integer,
  worker_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.external_transcript_audit TO service_role;

ALTER TABLE public.external_transcript_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny all auth" ON public.external_transcript_audit
  FOR ALL TO authenticated, anon USING (false) WITH CHECK (false);

CREATE INDEX IF NOT EXISTS idx_ext_audit_created ON public.external_transcript_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ext_audit_episode ON public.external_transcript_audit(episode_id);
