ALTER TABLE public.page_events
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS dwell_ms integer,
  ADD COLUMN IF NOT EXISTS ua_browser text,
  ADD COLUMN IF NOT EXISTS ua_os text,
  ADD COLUMN IF NOT EXISTS is_bot boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_page_events_session_id ON public.page_events (session_id) WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_page_events_created_at_desc ON public.page_events (created_at DESC);

-- RPC for updating dwell_ms on an existing row (called from beforeunload via supabase-js; relies on RLS or open insert policy)
CREATE OR REPLACE FUNCTION public.update_page_event_dwell(_id uuid, _dwell_ms integer)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.page_events SET dwell_ms = _dwell_ms WHERE id = _id AND dwell_ms IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.update_page_event_dwell(uuid, integer) TO anon, authenticated;