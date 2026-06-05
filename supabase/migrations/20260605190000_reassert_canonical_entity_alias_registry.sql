-- Reassert the shared canonical alias registry. Production drift showed that
-- canonical_entity_aliases / normalize_entity_alias may be missing while edge
-- workers already rely on them. Keep this migration source-of-truth neutral:
-- rebuild from the currently live topic_aliases and organization_aliases.

CREATE OR REPLACE FUNCTION public.normalize_entity_alias(input text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(regexp_replace(
    lower(translate(coalesce(input, ''),
      'áàäâãåéèëêíìïîóòöőôõúùüűûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖŐÔÕÚÙÜŰÛÑÇ',
      'aaaaaaeeeeiiiioooooouuuuuncAAAAAAEEEEIIIIOOOOOOUUUUUNC'
    )),
    '[^a-z0-9]+',
    ' ',
    'g'
  ));
$$;

CREATE TABLE IF NOT EXISTS public.canonical_entity_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL CHECK (entity_kind IN ('topic','person','organization','podcast','category')),
  canonical_slug text NOT NULL,
  canonical_name text NOT NULL,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  language text NOT NULL DEFAULT 'hu',
  weight integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','candidate','rejected','deprecated')),
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_kind, normalized_alias, canonical_slug)
);

CREATE INDEX IF NOT EXISTS canonical_entity_aliases_lookup_idx
  ON public.canonical_entity_aliases(entity_kind, normalized_alias)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS canonical_entity_aliases_canonical_idx
  ON public.canonical_entity_aliases(entity_kind, canonical_slug)
  WHERE status = 'active';

ALTER TABLE public.canonical_entity_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "canonical_entity_aliases public read" ON public.canonical_entity_aliases;
CREATE POLICY "canonical_entity_aliases public read"
  ON public.canonical_entity_aliases FOR SELECT
  USING (status = 'active');

DROP POLICY IF EXISTS "canonical_entity_aliases admin write" ON public.canonical_entity_aliases;
CREATE POLICY "canonical_entity_aliases admin write"
  ON public.canonical_entity_aliases FOR ALL
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.canonical_entity_aliases (
  entity_kind, canonical_slug, canonical_name, alias, normalized_alias,
  language, weight, status, source, notes, updated_at
)
SELECT
  'topic',
  t.slug,
  t.name,
  ta.alias,
  COALESCE(NULLIF(ta.normalized_alias, ''), public.normalize_entity_alias(ta.alias)),
  'hu',
  COALESCE(ta.weight, 10),
  'active',
  'topic_aliases_projection',
  'reasserted_from_topic_aliases_20260605',
  now()
FROM public.topic_aliases ta
JOIN public.topics t ON t.id = ta.topic_id
WHERE ta.alias IS NOT NULL
  AND COALESCE(NULLIF(ta.normalized_alias, ''), public.normalize_entity_alias(ta.alias)) <> ''
ON CONFLICT (entity_kind, normalized_alias, canonical_slug) DO UPDATE
SET canonical_name = EXCLUDED.canonical_name,
    alias = EXCLUDED.alias,
    weight = GREATEST(public.canonical_entity_aliases.weight, EXCLUDED.weight),
    status = 'active',
    source = EXCLUDED.source,
    notes = EXCLUDED.notes,
    updated_at = now();

INSERT INTO public.canonical_entity_aliases (
  entity_kind, canonical_slug, canonical_name, alias, normalized_alias,
  language, weight, status, source, notes, updated_at
)
SELECT
  'organization',
  o.slug,
  o.name,
  oa.alias,
  COALESCE(NULLIF(oa.normalized_alias, ''), public.normalize_entity_alias(oa.alias)),
  'hu',
  GREATEST(10, ROUND(COALESCE(oa.confidence, 0.5) * 100)::integer),
  'active',
  'organization_aliases_projection',
  'reasserted_from_organization_aliases_20260605',
  now()
FROM public.organization_aliases oa
JOIN public.organizations o ON o.id = oa.organization_id
WHERE oa.status = 'accepted'
  AND oa.alias IS NOT NULL
  AND COALESCE(o.slug, '') <> ''
  AND COALESCE(NULLIF(oa.normalized_alias, ''), public.normalize_entity_alias(oa.alias)) <> ''
ON CONFLICT (entity_kind, normalized_alias, canonical_slug) DO UPDATE
SET canonical_name = EXCLUDED.canonical_name,
    alias = EXCLUDED.alias,
    weight = GREATEST(public.canonical_entity_aliases.weight, EXCLUDED.weight),
    status = 'active',
    source = EXCLUDED.source,
    notes = EXCLUDED.notes,
    updated_at = now();

CREATE OR REPLACE VIEW public.v_canonical_topic_aliases AS
SELECT
  a.alias,
  a.normalized_alias,
  a.canonical_slug,
  a.canonical_name,
  t.id AS topic_id,
  t.domain,
  a.weight,
  a.source,
  a.updated_at
FROM public.canonical_entity_aliases a
JOIN public.topics t ON t.slug = a.canonical_slug
WHERE a.entity_kind = 'topic'
  AND a.status = 'active'
  AND t.is_public = true;

GRANT SELECT ON public.v_canonical_topic_aliases TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_canonical_entity_alias(
  p_entity_kind text,
  p_alias text
)
RETURNS TABLE (
  entity_kind text,
  canonical_slug text,
  canonical_name text,
  normalized_alias text,
  weight integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    a.entity_kind,
    a.canonical_slug,
    a.canonical_name,
    a.normalized_alias,
    a.weight
  FROM public.canonical_entity_aliases a
  WHERE a.entity_kind = p_entity_kind
    AND a.status = 'active'
    AND a.normalized_alias = public.normalize_entity_alias(p_alias)
  ORDER BY a.weight DESC, a.updated_at DESC
  LIMIT 1;
$$;

GRANT SELECT ON public.canonical_entity_aliases TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_canonical_entity_alias(text, text) TO anon, authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'canonical_alias_policy',
  jsonb_build_object(
    'version', 'canonical_aliases_reassert_20260605',
    'source_table', 'canonical_entity_aliases',
    'topic_projection', 'topic_aliases',
    'organization_projection', 'organization_aliases',
    'active_seed_count', (
      SELECT count(*)
      FROM public.canonical_entity_aliases
      WHERE status = 'active'
    ),
    'topic_alias_count', (
      SELECT count(*)
      FROM public.canonical_entity_aliases
      WHERE entity_kind = 'topic' AND status = 'active'
    ),
    'organization_alias_count', (
      SELECT count(*)
      FROM public.canonical_entity_aliases
      WHERE entity_kind = 'organization' AND status = 'active'
    ),
    'note', 'Reasserted because production drift had workers relying on canonical aliases while table/function were missing.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
