
CREATE TABLE IF NOT EXISTS public.live_events (
  id BIGSERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  session_id TEXT,
  payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_live_events_kind_created ON public.live_events (kind, created_at DESC);
GRANT ALL ON public.live_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.live_events_id_seq TO service_role;
ALTER TABLE public.live_events ENABLE ROW LEVEL SECURITY;
