
CREATE OR REPLACE FUNCTION public.immutable_unaccent(s text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT public.unaccent('public.unaccent', coalesce(s,''))
$$;

CREATE OR REPLACE FUNCTION public.normalize_podcast_title(s text)
RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE
SET search_path TO 'public'
AS $$
  SELECT btrim(regexp_replace(regexp_replace(lower(public.immutable_unaccent(coalesce(s,''))), '[^a-z0-9]+', ' ', 'g'), '\s+', ' ', 'g'))
$$;

ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS normalized_title text
  GENERATED ALWAYS AS (public.normalize_podcast_title(title)) STORED;

CREATE INDEX IF NOT EXISTS idx_podcasts_normalized_title
  ON public.podcasts (normalized_title);

CREATE INDEX IF NOT EXISTS idx_podcasts_normalized_title_trgm
  ON public.podcasts USING gin (normalized_title gin_trgm_ops);
