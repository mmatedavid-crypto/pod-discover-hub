-- Canonical synonym registry. This is the source table for aliases that should
-- collapse to one public entity/topic across homepage rails, search, extraction
-- and future weekly quality jobs.

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
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Create canonical topics that did not exist as first-class topic pages yet.
INSERT INTO public.topics (
  slug, name, short_name, domain, seo_title, seo_description, h1, intro_text,
  priority, sort_order, topic_type, is_public, is_indexable
)
VALUES
  (
    'labdarugas', 'Labdarúgás', 'Labdarúgás', 'sport',
    'Labdarúgás podcastok magyarul | Podiverzum',
    'Magyar és nemzetközi labdarúgás, foci és futball témájú podcast epizódok.',
    'Labdarúgás podcastok magyarul',
    'Magyar nyelvű labdarúgó beszélgetések, elemzések és történetek.',
    96, 149, 'seo', true, true
  )
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    short_name = EXCLUDED.short_name,
    domain = EXCLUDED.domain,
    seo_title = EXCLUDED.seo_title,
    seo_description = EXCLUDED.seo_description,
    h1 = EXCLUDED.h1,
    intro_text = EXCLUDED.intro_text,
    priority = GREATEST(public.topics.priority, EXCLUDED.priority),
    sort_order = LEAST(public.topics.sort_order, EXCLUDED.sort_order),
    is_public = true,
    is_indexable = true,
    updated_at = now();

UPDATE public.topics child
SET parent_topic_id = parent.id,
    is_indexable = false,
    updated_at = now()
FROM public.topics parent
WHERE parent.slug = 'labdarugas'
  AND child.slug IN ('foci','futball')
  AND child.id <> parent.id;

WITH seed(entity_kind, canonical_slug, canonical_name, alias, weight, source, notes) AS (
  VALUES
    -- Sport
    ('topic','labdarugas','Labdarúgás','Labdarúgás',100,'manual_seed','primary'),
    ('topic','labdarugas','Labdarúgás','foci',95,'manual_seed','hu common alias'),
    ('topic','labdarugas','Labdarúgás','futball',95,'manual_seed','hu common alias'),
    ('topic','labdarugas','Labdarúgás','football',75,'manual_seed','en alias'),
    ('topic','labdarugas','Labdarúgás','soccer',65,'manual_seed','en alias'),
    ('topic','labdarugas','Labdarúgás','magyar foci',80,'manual_seed','compound alias'),
    ('topic','labdarugas','Labdarúgás','válogatott foci',70,'manual_seed','compound alias'),

    -- AI / tech
    ('topic','mesterseges-intelligencia','Mesterséges intelligencia','mesterséges intelligencia',100,'manual_seed','primary'),
    ('topic','mesterseges-intelligencia','Mesterséges intelligencia','MI',98,'manual_seed','hu abbreviation'),
    ('topic','mesterseges-intelligencia','Mesterséges intelligencia','AI',95,'manual_seed','common abbreviation'),
    ('topic','mesterseges-intelligencia','Mesterséges intelligencia','artificial intelligence',80,'manual_seed','en alias'),
    ('topic','mesterseges-intelligencia','Mesterséges intelligencia','gépi tanulás',65,'manual_seed','related alias'),
    ('topic','mesterseges-intelligencia','Mesterséges intelligencia','machine learning',60,'manual_seed','related en alias'),
    ('topic','technologia','Technológia','technológia',100,'manual_seed','primary'),
    ('topic','technologia','Technológia','tech',90,'manual_seed','common alias'),
    ('topic','technologia','Technológia','IT',75,'manual_seed','common alias'),

    -- Public life / business
    ('topic','kozelet','Közélet','közélet',100,'manual_seed','primary'),
    ('topic','kozelet','Közélet','közéleti',70,'manual_seed','inflected alias'),
    ('topic','magyar-politika','Magyar politika','politika',100,'manual_seed','primary'),
    ('topic','magyar-politika','Magyar politika','politikai',80,'manual_seed','inflected alias'),
    ('topic','gazdasag','Gazdaság','gazdaság',100,'manual_seed','primary'),
    ('topic','gazdasag','Gazdaság','gazdasági',80,'manual_seed','inflected alias'),
    ('topic','vallalkozas','Vállalkozás','üzlet',100,'manual_seed','primary'),
    ('topic','vallalkozas','Vállalkozás','business',80,'manual_seed','en alias'),
    ('topic','penzugy','Pénzügy','pénzügy',100,'manual_seed','primary'),
    ('topic','penzugy','Pénzügy','pénzügyek',85,'manual_seed','plural alias'),
    ('topic','befektetes','Befektetés','befektetés',100,'manual_seed','primary'),
    ('topic','befektetes','Befektetés','befektetések',85,'manual_seed','plural alias'),

    -- Health / self
    ('topic','egeszseg','Egészség','egészség',100,'manual_seed','primary'),
    ('topic','egeszseg','Egészség','egészségügy',75,'manual_seed','related alias'),
    ('topic','mentalis-egeszseg','Mentális egészség','mentális egészség',100,'manual_seed','primary'),
    ('topic','mentalis-egeszseg','Mentális egészség','lelki egészség',85,'manual_seed','hu alias'),
    ('topic','pszichologia','Pszichológia','pszichológia',100,'manual_seed','primary'),
    ('topic','pszichologia','Pszichológia','pszicho',70,'manual_seed','short alias'),
    ('topic','parkapcsolat','Párkapcsolat','párkapcsolat',100,'manual_seed','primary'),
    ('topic','parkapcsolat','Párkapcsolat','kapcsolatok',80,'manual_seed','related alias'),
    ('topic','onismeret','Önismeret','önfejlesztés',100,'manual_seed','primary'),
    ('topic','onismeret','Önismeret','self improvement',70,'manual_seed','en alias'),

    -- Culture / history / spirituality
    ('topic','tortenelem','Történelem','történelem',100,'manual_seed','primary'),
    ('topic','tortenelem','Történelem','história',65,'manual_seed','alias'),
    ('topic','magyar-kultura','Magyar kultúra','kultúra',100,'manual_seed','primary'),
    ('topic','magyar-kultura','Magyar kultúra','művészet',100,'manual_seed','primary'),
    ('topic','vallas','Vallás','vallás',100,'manual_seed','primary'),
    ('topic','vallas','Vallás','hit',80,'manual_seed','related alias'),
    ('topic','spiritualitas','Spiritualitás','spiritualitás',100,'manual_seed','primary'),
    ('topic','spiritualitas','Spiritualitás','spirituális',75,'manual_seed','inflected alias'),
    ('topic','oktatas','Oktatás','oktatás',100,'manual_seed','primary'),
    ('topic','oktatas','Oktatás','edukáció',75,'manual_seed','alias')
)
INSERT INTO public.canonical_entity_aliases (
  entity_kind, canonical_slug, canonical_name, alias, normalized_alias, weight, source, notes, updated_at
)
SELECT
  entity_kind,
  canonical_slug,
  canonical_name,
  alias,
  public.normalize_entity_alias(alias),
  weight,
  source,
  notes,
  now()
FROM seed
ON CONFLICT (entity_kind, normalized_alias, canonical_slug) DO UPDATE
SET canonical_name = EXCLUDED.canonical_name,
    alias = EXCLUDED.alias,
    weight = GREATEST(public.canonical_entity_aliases.weight, EXCLUDED.weight),
    status = 'active',
    source = EXCLUDED.source,
    notes = COALESCE(EXCLUDED.notes, public.canonical_entity_aliases.notes),
    updated_at = now();

-- Project active canonical topic aliases into the legacy topic_aliases table
-- used by search-hybrid and person-entity-extractor.
INSERT INTO public.topic_aliases (topic_id, alias, normalized_alias, weight)
SELECT
  t.id,
  a.alias,
  a.normalized_alias,
  a.weight
FROM public.canonical_entity_aliases a
JOIN public.topics t ON t.slug = a.canonical_slug
WHERE a.entity_kind = 'topic'
  AND a.status = 'active'
ON CONFLICT (topic_id, normalized_alias) DO UPDATE
SET alias = EXCLUDED.alias,
    weight = GREATEST(public.topic_aliases.weight, EXCLUDED.weight);

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

GRANT EXECUTE ON FUNCTION public.resolve_canonical_entity_alias(text, text) TO anon, authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'canonical_alias_policy',
  jsonb_build_object(
    'version', 'canonical_aliases_v1',
    'source_table', 'canonical_entity_aliases',
    'legacy_topic_projection', 'topic_aliases',
    'weekly_growth_plan', true,
    'active_seed_count', (
      SELECT count(*)
      FROM public.canonical_entity_aliases
      WHERE status = 'active'
    ),
    'note', 'Canonical aliases are the shared synonym source for topics first, then people/org/podcast aliases.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
