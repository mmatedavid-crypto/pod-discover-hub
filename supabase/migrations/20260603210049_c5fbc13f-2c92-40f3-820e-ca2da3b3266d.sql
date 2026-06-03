-- Reddit link bot: tables + name index matview
CREATE TABLE public.reddit_bot_log (
  id BIGSERIAL PRIMARY KEY,
  ts TIMESTAMPTZ NOT NULL DEFAULT now(),
  subreddit TEXT,
  thing_id TEXT,
  thing_kind TEXT,
  thing_author TEXT,
  thing_url TEXT,
  matched_kind TEXT,
  matched_name TEXT,
  matched_url TEXT,
  action TEXT NOT NULL,
  reason TEXT,
  response_id TEXT,
  raw JSONB
);
GRANT SELECT, INSERT ON public.reddit_bot_log TO authenticated;
GRANT ALL ON public.reddit_bot_log TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.reddit_bot_log_id_seq TO authenticated, service_role;
ALTER TABLE public.reddit_bot_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin read reddit_bot_log" ON public.reddit_bot_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
CREATE INDEX reddit_bot_log_ts_idx ON public.reddit_bot_log (ts DESC);
CREATE INDEX reddit_bot_log_thing_idx ON public.reddit_bot_log (thing_id);
CREATE INDEX reddit_bot_log_action_idx ON public.reddit_bot_log (action);

CREATE TABLE public.reddit_bot_opt_out (
  username TEXT PRIMARY KEY,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, DELETE ON public.reddit_bot_opt_out TO authenticated;
GRANT ALL ON public.reddit_bot_opt_out TO service_role;
ALTER TABLE public.reddit_bot_opt_out ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin manage opt_out" ON public.reddit_bot_opt_out
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE MATERIALIZED VIEW public.reddit_name_index AS
WITH stop_names AS (
  SELECT unnest(ARRAY[
    'index','hir','hirek','het','heti','nap','napi','reggel','este','podcast',
    'radio','tv','show','klub','kor','ido','elet','vilag','penz','sport','foci',
    'film','konyv','zene','jatek','etel','ital','haz','auto','telefon','net',
    'magyar','hungary','budapest','europa','allam','part','partok',
    'orszag','varos','utca','iskola','egyetem','asztal','beszel',
    'evek','hetek','honap','honapok','ev'
  ]) AS w
)
SELECT
  'podcast'::text AS kind,
  p.id AS entity_id,
  p.title AS name,
  lower(unaccent(p.title)) AS norm_name,
  '/podcast/' || p.slug AS path,
  p.rank_label,
  COALESCE(p.hydrated_episode_count, 0) AS weight
FROM public.podcasts p
WHERE p.language ILIKE 'hu%'
  AND p.slug IS NOT NULL
  AND length(p.title) >= 4
  AND lower(unaccent(p.title)) NOT IN (SELECT w FROM stop_names)

UNION ALL

SELECT
  'person'::text AS kind,
  pe.id AS entity_id,
  pe.name AS name,
  lower(unaccent(pe.name)) AS norm_name,
  '/szemelyek/' || pe.slug AS path,
  NULL::text AS rank_label,
  COALESCE(pe.episode_count, 0) AS weight
FROM public.people pe
WHERE pe.is_indexable = true
  AND pe.slug IS NOT NULL
  AND length(pe.name) >= 5
  AND position(' ' IN pe.name) > 0
  AND lower(unaccent(pe.name)) NOT IN (SELECT w FROM stop_names)

UNION ALL

SELECT
  'organization'::text AS kind,
  o.id AS entity_id,
  o.name AS name,
  lower(unaccent(o.name)) AS norm_name,
  '/ceg/' || o.slug AS path,
  NULL::text AS rank_label,
  COALESCE(o.episode_count, 0) AS weight
FROM public.organizations o
WHERE o.is_indexable = true
  AND o.slug IS NOT NULL
  AND length(o.name) >= 4
  AND lower(unaccent(o.name)) NOT IN (SELECT w FROM stop_names);

CREATE UNIQUE INDEX reddit_name_index_unique
  ON public.reddit_name_index (kind, entity_id);
CREATE INDEX reddit_name_index_norm_idx
  ON public.reddit_name_index (norm_name);

GRANT SELECT ON public.reddit_name_index TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.refresh_reddit_name_index()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.reddit_name_index;
END;
$$;
GRANT EXECUTE ON FUNCTION public.refresh_reddit_name_index() TO authenticated, service_role;

INSERT INTO public.app_settings (key, value)
VALUES (
  'reddit_link_bot_controls',
  jsonb_build_object(
    'enabled', false,
    'dry_run', true,
    'daily_cap', 30,
    'comment_cooldown_s', 90,
    'max_thread_age_days', 7,
    'subs', jsonb_build_array('hungary', 'Magyarorszag', 'podcasts'),
    'last_seen', jsonb_build_object(),
    'access_token', null,
    'access_token_expires_at', null,
    'updated_at', now()
  )
)
ON CONFLICT (key) DO NOTHING;