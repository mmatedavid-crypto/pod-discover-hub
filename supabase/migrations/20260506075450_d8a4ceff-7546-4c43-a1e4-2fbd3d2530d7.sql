ALTER TABLE public.discovery_queue
  ADD COLUMN IF NOT EXISTS import_status text,
  ADD COLUMN IF NOT EXISTS import_error text,
  ADD COLUMN IF NOT EXISTS last_import_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS imported_podcast_id uuid,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;