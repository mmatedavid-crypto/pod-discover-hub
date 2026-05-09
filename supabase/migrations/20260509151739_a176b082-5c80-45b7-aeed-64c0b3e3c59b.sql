
CREATE TABLE public.social_posts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  platform text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  content text NOT NULL,
  episode_ids uuid[] NOT NULL DEFAULT '{}',
  podcast_ids uuid[] NOT NULL DEFAULT '{}',
  ai_model text,
  cost_usd numeric,
  platform_post_id text,
  platform_post_url text,
  error text,
  trigger text NOT NULL DEFAULT 'cron',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_social_posts_created_at ON public.social_posts(created_at DESC);
CREATE INDEX idx_social_posts_platform_status ON public.social_posts(platform, status);

ALTER TABLE public.social_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "social_posts public read"
ON public.social_posts FOR SELECT
USING (true);

CREATE POLICY "social_posts admin write"
ON public.social_posts FOR ALL
USING (has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
