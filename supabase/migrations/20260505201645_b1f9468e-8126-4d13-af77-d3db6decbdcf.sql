ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS last_fetch_new_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_fetch_duplicate_count integer NOT NULL DEFAULT 0;