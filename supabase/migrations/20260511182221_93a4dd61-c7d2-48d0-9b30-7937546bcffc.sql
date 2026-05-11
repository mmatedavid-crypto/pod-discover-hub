
ALTER TABLE public.social_posts
  ADD COLUMN IF NOT EXISTS post_type text,
  ADD COLUMN IF NOT EXISTS hook_type text,
  ADD COLUMN IF NOT EXISTS slot_utc text,
  ADD COLUMN IF NOT EXISTS link_placement text,
  ADD COLUMN IF NOT EXISTS score numeric,
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS parent_post_id text,
  ADD COLUMN IF NOT EXISTS impressions integer,
  ADD COLUMN IF NOT EXISTS likes integer,
  ADD COLUMN IF NOT EXISTS replies_count integer,
  ADD COLUMN IF NOT EXISTS reposts integer,
  ADD COLUMN IF NOT EXISTS bookmarks integer,
  ADD COLUMN IF NOT EXISTS link_clicks integer,
  ADD COLUMN IF NOT EXISTS follows integer,
  ADD COLUMN IF NOT EXISTS ctr numeric,
  ADD COLUMN IF NOT EXISTS engagement_rate numeric,
  ADD COLUMN IF NOT EXISTS metrics_refreshed_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_social_posts_slot_day
  ON public.social_posts (platform, created_at DESC)
  WHERE status = 'success';
CREATE INDEX IF NOT EXISTS idx_social_posts_post_type
  ON public.social_posts (post_type, created_at DESC);
