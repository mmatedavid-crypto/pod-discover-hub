
CREATE TABLE public.discovery_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pi_id bigint,
  title text NOT NULL,
  rss_url text NOT NULL,
  website_url text,
  image_url text,
  description text,
  language text,
  author text,
  episode_count integer,
  last_episode_at timestamptz,
  candidate_rank integer NOT NULL DEFAULT 1,
  rank_reason jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending',
  source text,
  category text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rss_url)
);
ALTER TABLE public.discovery_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "queue public read" ON public.discovery_queue FOR SELECT USING (true);
CREATE POLICY "queue admin write" ON public.discovery_queue FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

CREATE TABLE public.growth_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  ok boolean NOT NULL DEFAULT false,
  stats jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  trigger text NOT NULL DEFAULT 'manual'
);
ALTER TABLE public.growth_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "runs public read" ON public.growth_runs FOR SELECT USING (true);
CREATE POLICY "runs admin write" ON public.growth_runs FOR ALL
  USING (has_role(auth.uid(),'admin'::app_role))
  WITH CHECK (has_role(auth.uid(),'admin'::app_role));

INSERT INTO public.app_settings (key, value) VALUES (
  'growth',
  jsonb_build_object(
    'autonomous_growth_enabled', false,
    'auto_add_enabled', false,
    'approval_queue_enabled', true,
    'min_rank_for_auto_add', 8,
    'max_auto_add_per_run', 20,
    'max_discovery_per_run', 50,
    'max_ai_summaries_per_day', 200,
    'discovery_categories', jsonb_build_array('technology','business','science','news','education'),
    'language', 'en',
    'max_episode_age_days', 90
  )
) ON CONFLICT (key) DO NOTHING;
