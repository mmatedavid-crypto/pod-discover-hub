
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE OR REPLACE FUNCTION public.clean_slug(input text, fallback text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    NULLIF(
      substring(
        regexp_replace(
          regexp_replace(
            lower(public.unaccent(coalesce(input, ''))),
            '[^a-z0-9]+', '-', 'g'
          ),
          '(^-+|-+$)', '', 'g'
        ) FOR 80
      ), ''
    ),
    fallback
  );
$$;

CREATE OR REPLACE FUNCTION public.slug_with_suffix(base text, n int)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN n <= 1 THEN base
    ELSE regexp_replace(substring(base FOR (80 - length('-' || n::text))), '-+$', '', 'g') || '-' || n::text
  END;
$$;
