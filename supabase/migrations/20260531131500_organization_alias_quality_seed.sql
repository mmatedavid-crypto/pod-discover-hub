-- High-value organization canonicalization for SEO/search.
-- Goal: one canonical public landing page for aliases such as
-- "Fradi podcast", "FTC podcast", "Magyar Telekom podcast", "MTEL podcast".

CREATE OR REPLACE FUNCTION public.merge_duplicate_organization_by_slug(
  p_canonical_slug text,
  p_duplicate_slug text,
  p_reason text DEFAULT 'manual_canonical_quality_merge'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  canonical_id uuid;
  duplicate_id uuid;
  moved_count integer := 0;
  removed_conflicts integer := 0;
  alias_count integer := 0;
BEGIN
  SELECT id INTO canonical_id
  FROM public.organizations
  WHERE slug = p_canonical_slug
  LIMIT 1;

  SELECT id INTO duplicate_id
  FROM public.organizations
  WHERE slug = p_duplicate_slug
  LIMIT 1;

  IF canonical_id IS NULL OR duplicate_id IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'missing_organization',
      'canonical_slug', p_canonical_slug,
      'duplicate_slug', p_duplicate_slug
    );
  END IF;

  IF canonical_id = duplicate_id THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason', 'same_row');
  END IF;

  INSERT INTO public.organization_aliases (
    organization_id, alias, normalized_alias, source, confidence, status
  )
  SELECT
    canonical_id,
    alias,
    public.normalize_entity_alias(alias),
    'canonical_merge',
    0.99,
    'accepted'
  FROM (
    SELECT name AS alias FROM public.organizations WHERE id = duplicate_id
    UNION ALL
    SELECT slug AS alias FROM public.organizations WHERE id = duplicate_id
    UNION ALL
    SELECT alias FROM public.organization_aliases WHERE organization_id = duplicate_id
  ) s
  WHERE alias IS NOT NULL AND length(trim(alias)) >= 2
  ON CONFLICT (organization_id, normalized_alias) DO UPDATE
  SET confidence = GREATEST(public.organization_aliases.confidence, EXCLUDED.confidence),
      status = 'accepted',
      source = EXCLUDED.source;

  GET DIAGNOSTICS alias_count = ROW_COUNT;

  DELETE FROM public.episode_organization_map dup
  USING public.episode_organization_map canon
  WHERE dup.organization_id = duplicate_id
    AND canon.organization_id = canonical_id
    AND canon.episode_id = dup.episode_id;

  GET DIAGNOSTICS removed_conflicts = ROW_COUNT;

  UPDATE public.episode_organization_map
  SET organization_id = canonical_id,
      source = 'canonical_merge',
      source_evidence = COALESCE(source_evidence, '{}'::jsonb) || jsonb_build_object(
        'merged_from_organization_id', duplicate_id,
        'merged_from_slug', p_duplicate_slug,
        'merge_reason', p_reason,
        'merged_at', now()
      )
  WHERE organization_id = duplicate_id;

  GET DIAGNOSTICS moved_count = ROW_COUNT;

  UPDATE public.organizations o
  SET
    episode_count = s.episode_count,
    gated_episode_count = s.gated_episode_count,
    podcast_count = s.podcast_count,
    gated_podcast_count = s.gated_podcast_count,
    distinct_podcast_count = s.podcast_count,
    mention_count = GREATEST(o.mention_count, s.episode_count),
    latest_episode_at = s.latest_episode_at,
    is_public = true,
    is_indexable = true,
    is_browsable_in_hub = true,
    browsable_reason = 'canonical_high_value_entity',
    ai_review_status = CASE
      WHEN o.ai_review_status = 'pending' THEN 'reviewed'
      ELSE o.ai_review_status
    END,
    ai_recommended_action = 'keep_indexable',
    editorial_priority = true,
    editorial_priority_level = GREATEST(o.editorial_priority_level, 80),
    editorial_notes = trim(both E'\n' from concat_ws(E'\n', o.editorial_notes, p_reason)),
    updated_at = now()
  FROM (
    SELECT
      count(DISTINCT eom.episode_id)::int AS episode_count,
      count(DISTINCT eom.episode_id)::int AS gated_episode_count,
      count(DISTINCT eom.podcast_id)::int AS podcast_count,
      count(DISTINCT eom.podcast_id)::int AS gated_podcast_count,
      max(e.published_at) AS latest_episode_at
    FROM public.episode_organization_map eom
    LEFT JOIN public.episodes e ON e.id = eom.episode_id
    WHERE eom.organization_id = canonical_id
  ) s
  WHERE o.id = canonical_id;

  UPDATE public.organizations
  SET
    is_public = false,
    is_indexable = false,
    is_browsable_in_hub = false,
    browsable_reason = 'merged_into_canonical_organization',
    ai_review_status = 'duplicate_candidate',
    ai_recommended_action = 'merge',
    ai_duplicate_of_organization_id = canonical_id,
    editorial_notes = trim(both E'\n' from concat_ws(E'\n', editorial_notes, p_reason)),
    updated_at = now()
  WHERE id = duplicate_id;

  RETURN jsonb_build_object(
    'ok', true,
    'canonical_slug', p_canonical_slug,
    'duplicate_slug', p_duplicate_slug,
    'aliases_upserted', alias_count,
    'conflicting_mentions_removed', removed_conflicts,
    'mentions_moved', moved_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_duplicate_organization_by_slug(text, text, text) TO service_role;

WITH seed(canonical_slug, canonical_name, alias, confidence, notes) AS (
  VALUES
    -- Ferencvárosi Torna Club / Fradi / FTC
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'Fradi', 0.99, 'high_value_sport_alias'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'FTC', 0.99, 'high_value_sport_alias'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'Ferencvárosi Torna Club', 1.00, 'canonical_name'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'Ferencvárosi Torna Klub', 0.98, 'orthographic_variant'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'Ferencvárosi TC', 0.95, 'common_abbreviation'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'FTC-Telekom', 0.85, 'sponsor_name_variant'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'fradi.hu', 0.80, 'site_variant'),

    -- Magyar Telekom / MTEL
    ('magyar-telekom', 'Magyar Telekom', 'Magyar Telekom', 1.00, 'canonical_name'),
    ('magyar-telekom', 'Magyar Telekom', 'MTEL', 0.99, 'ticker_alias'),
    ('magyar-telekom', 'Magyar Telekom', 'Telekom HU', 0.95, 'brand_alias'),
    ('magyar-telekom', 'Magyar Telekom', 'Telekom Hungary', 0.95, 'brand_alias'),
    ('magyar-telekom', 'Magyar Telekom', 'Magyar Telekom Nyrt.', 0.98, 'legal_name'),
    ('magyar-telekom', 'Magyar Telekom', 'T-Mobile Hungary', 0.85, 'legacy_brand_alias')
)
INSERT INTO public.canonical_entity_aliases (
  entity_kind, canonical_slug, canonical_name, alias, normalized_alias,
  weight, status, source, notes, updated_at
)
SELECT
  'organization',
  canonical_slug,
  canonical_name,
  alias,
  public.normalize_entity_alias(alias),
  round(confidence * 100)::int,
  'active',
  'high_value_seo_seed',
  notes,
  now()
FROM seed
ON CONFLICT (entity_kind, normalized_alias, canonical_slug) DO UPDATE
SET canonical_name = EXCLUDED.canonical_name,
    alias = EXCLUDED.alias,
    weight = GREATEST(public.canonical_entity_aliases.weight, EXCLUDED.weight),
    status = 'active',
    source = EXCLUDED.source,
    notes = EXCLUDED.notes,
    updated_at = now();

INSERT INTO public.organization_aliases (
  organization_id, alias, normalized_alias, source, confidence, status
)
SELECT
  o.id,
  a.alias,
  a.normalized_alias,
  'canonical_entity_aliases',
  LEAST(1.0, GREATEST(0.45, a.weight::numeric / 100.0)),
  'accepted'
FROM public.canonical_entity_aliases a
JOIN public.organizations o ON o.slug = a.canonical_slug
WHERE a.entity_kind = 'organization'
  AND a.status = 'active'
  AND a.source = 'high_value_seo_seed'
ON CONFLICT (organization_id, normalized_alias) DO UPDATE
SET alias = EXCLUDED.alias,
    confidence = GREATEST(public.organization_aliases.confidence, EXCLUDED.confidence),
    status = 'accepted',
    source = EXCLUDED.source;

-- Canonical rows must be public/indexable before their aliases are useful.
UPDATE public.organizations
SET
  is_public = true,
  is_indexable = true,
  is_browsable_in_hub = true,
  browsable_reason = 'high_value_seo_seed',
  editorial_priority = true,
  editorial_priority_level = GREATEST(editorial_priority_level, 85),
  ai_review_status = CASE WHEN ai_review_status = 'pending' THEN 'reviewed' ELSE ai_review_status END,
  ai_recommended_action = 'keep_indexable',
  updated_at = now()
WHERE slug IN ('ferencvarosi-torna-club', 'magyar-telekom');

-- Known high-value duplicates observed in production.
SELECT public.merge_duplicate_organization_by_slug(
  'ferencvarosi-torna-club',
  'ferencvarosi-torna-club-a3bi',
  'merge_duplicate_ftc_clean_slug_for_fradi_podcast_seo'
);

SELECT public.merge_duplicate_organization_by_slug(
  'magyar-telekom',
  'telekom',
  'merge_generic_telekom_brand_into_magyar_telekom_for_mtel_seo'
);

CREATE OR REPLACE VIEW public.v_organization_alias_quality_v1 AS
SELECT
  o.id AS organization_id,
  o.slug,
  o.name,
  o.org_type,
  o.is_public,
  o.is_indexable,
  o.gated_episode_count,
  count(a.id)::int AS accepted_alias_count,
  array_agg(a.alias ORDER BY a.confidence DESC, a.alias) FILTER (WHERE a.status = 'accepted') AS accepted_aliases,
  o.ai_review_status,
  o.ai_duplicate_of_organization_id,
  o.updated_at
FROM public.organizations o
LEFT JOIN public.organization_aliases a
  ON a.organization_id = o.id
 AND a.status = 'accepted'
WHERE o.is_public = true OR o.is_indexable = true OR o.ai_duplicate_of_organization_id IS NOT NULL
GROUP BY o.id;

GRANT SELECT ON public.v_organization_alias_quality_v1 TO authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'entity_quality_controls',
  COALESCE((SELECT value FROM public.app_settings WHERE key = 'entity_quality_controls'), '{}'::jsonb)
  || jsonb_build_object(
    'organization_alias_quality_version', 'org_alias_quality_v1',
    'high_value_seeded_entities', jsonb_build_array('ferencvarosi-torna-club', 'magyar-telekom'),
    'last_manual_seed_at', now(),
    'note', 'High-value organization aliases and duplicate merges enabled for SEO/search.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'organization_alias_quality_version', 'org_alias_quality_v1',
    'high_value_seeded_entities', jsonb_build_array('ferencvarosi-torna-club', 'magyar-telekom'),
    'last_manual_seed_at', now(),
    'note', 'High-value organization aliases and duplicate merges enabled for SEO/search.'
  ),
  updated_at = now();
