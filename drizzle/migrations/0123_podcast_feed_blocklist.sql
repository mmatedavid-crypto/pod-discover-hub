-- Owner decision 2026-10-27: confirmed non-Hungarian feeds are deleted permanently and must
-- never be imported again. Any path that inserts a podcast is silently skipped for a blocked
-- feed URL. Unblocking = deleting the row (admin decision).
CREATE TABLE public.podcast_feed_blocklist (
  rss_url_key text PRIMARY KEY,
  rss_url text NOT NULL,
  title text,
  reason text NOT NULL,
  blocked_by text,
  blocked_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.podcast_feed_blocklist TO authenticated;
GRANT ALL ON public.podcast_feed_blocklist TO service_role;
ALTER TABLE public.podcast_feed_blocklist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read feed blocklist" ON public.podcast_feed_blocklist
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.feed_url_key_v1(p_url text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT nullif(regexp_replace(lower(btrim(coalesce(p_url, ''))), '/+$', ''), '') $$;

CREATE OR REPLACE FUNCTION public.skip_blocked_podcast_feed_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.rss_url IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.podcast_feed_blocklist b WHERE b.rss_url_key = public.feed_url_key_v1(NEW.rss_url)
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.skip_blocked_podcast_feed_v1() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_skip_blocked_podcast_feed ON public.podcasts;
CREATE TRIGGER trg_skip_blocked_podcast_feed
  BEFORE INSERT ON public.podcasts
  FOR EACH ROW EXECUTE FUNCTION public.skip_blocked_podcast_feed_v1();