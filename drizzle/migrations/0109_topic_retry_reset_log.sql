CREATE TABLE IF NOT EXISTS public.topic_retry_reset_log (
  episode_id uuid NOT NULL,
  reset_batch text NOT NULL,
  old_status text NOT NULL,
  reset_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, reset_batch)
);
GRANT ALL ON public.topic_retry_reset_log TO service_role;
ALTER TABLE public.topic_retry_reset_log ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.topic_retry_reset_log IS 'Owner-authorized one-time topic re-queues (error -> pending); undo by setting these episodes back to old_status if still pending.';