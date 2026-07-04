
ALTER TABLE public.podcasts ADD COLUMN IF NOT EXISTS notify_new_episodes boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_podcasts_notify_new_episodes ON public.podcasts(id) WHERE notify_new_episodes = true;

CREATE TABLE IF NOT EXISTS public.podcast_email_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  email text NOT NULL,
  unsubscribe_token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(18), 'hex'),
  created_at timestamptz NOT NULL DEFAULT now(),
  unsubscribed_at timestamptz,
  last_sent_at timestamptz,
  source text,
  UNIQUE (podcast_id, email)
);

GRANT INSERT ON public.podcast_email_subscriptions TO anon, authenticated;
GRANT ALL ON public.podcast_email_subscriptions TO service_role;

ALTER TABLE public.podcast_email_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public can subscribe to enabled podcasts"
  ON public.podcast_email_subscriptions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.podcasts p
      WHERE p.id = podcast_id AND p.notify_new_episodes = true
    )
  );

CREATE POLICY "service_role full access"
  ON public.podcast_email_subscriptions
  FOR ALL
  TO service_role
  USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_pes_podcast_active
  ON public.podcast_email_subscriptions(podcast_id)
  WHERE unsubscribed_at IS NULL;
