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
  ON CONFLICT (normalized_alias) DO UPDATE
  SET organization_id = canonical_id,
      alias = EXCLUDED.alias,
      confidence = GREATEST(public.organization_aliases.confidence, EXCLUDED.confidence),
      status = 'accepted',
      source = EXCLUDED.source
  WHERE public.organization_aliases.organization_id IN (canonical_id, duplicate_id);

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

CREATE OR REPLACE FUNCTION public.merge_exact_duplicate_organization_groups(
  p_max_groups integer DEFAULT 250,
  p_min_name_length integer DEFAULT 6
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  grp record;
  dup record;
  merged_groups integer := 0;
  merged_rows integer := 0;
BEGIN
  FOR grp IN
    WITH candidates AS (
      SELECT
        normalized_name,
        max(org_type) AS org_type,
        count(*) AS row_count,
        count(DISTINCT coalesce(org_type, 'unknown')) AS type_count
      FROM public.organizations
      WHERE normalized_name IS NOT NULL
        AND length(normalized_name) >= p_min_name_length
        AND ai_duplicate_of_organization_id IS NULL
      GROUP BY normalized_name
      HAVING count(*) > 1
         AND count(DISTINCT coalesce(org_type, 'unknown')) <= 1
    ),
    ranked AS (
      SELECT
        o.*,
        row_number() OVER (
          PARTITION BY o.normalized_name
          ORDER BY
            coalesce(o.is_indexable, false) DESC,
            coalesce(o.is_public, false) DESC,
            coalesce(o.gated_episode_count, 0) DESC,
            coalesce(o.episode_count, 0) DESC,
            CASE WHEN o.slug ~ '-[a-z0-9]{4}$' THEN 1 ELSE 0 END,
            length(o.slug),
            o.slug
        ) AS rn
      FROM public.organizations o
      JOIN candidates c ON c.normalized_name = o.normalized_name
    )
    SELECT id, slug, name, normalized_name
    FROM ranked
    WHERE rn = 1
    ORDER BY coalesce(gated_episode_count, 0) DESC, normalized_name
    LIMIT p_max_groups
  LOOP
    merged_groups := merged_groups + 1;

    FOR dup IN
      SELECT id, slug
      FROM public.organizations
      WHERE normalized_name = grp.normalized_name
        AND id <> grp.id
        AND ai_duplicate_of_organization_id IS NULL
    LOOP
      PERFORM public.merge_duplicate_organization_by_slug(
        grp.slug,
        dup.slug,
        'auto_merge_exact_normalized_organization_duplicate'
      );
      merged_rows := merged_rows + 1;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'merged_groups', merged_groups,
    'merged_duplicate_rows', merged_rows
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_exact_duplicate_organization_groups(integer, integer) TO service_role;

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
    ('magyar-telekom', 'Magyar Telekom', 'T-Mobile Hungary', 0.85, 'legacy_brand_alias'),

    -- High-value parties and public organizations
    ('fidesz', 'Fidesz', 'Fidesz', 1.00, 'party_alias'),
    ('fidesz', 'Fidesz', 'Fidesz-KDNP', 0.95, 'party_alliance_alias'),
    ('fidesz', 'Fidesz', 'Magyar Polgári Szövetség', 0.85, 'legal_name_fragment'),
    ('kdnp', 'Kereszténydemokrata Néppárt', 'KDNP', 1.00, 'party_alias'),
    ('kdnp', 'Kereszténydemokrata Néppárt', 'Kereszténydemokrata Néppárt', 1.00, 'party_legal_name'),
    ('tisza-part', 'Tisza Párt', 'Tisza', 0.95, 'party_alias'),
    ('tisza-part', 'Tisza Párt', 'Tisza Párt', 1.00, 'party_legal_name'),
    ('tisza-part', 'Tisza Párt', 'Tisztelet és Szabadság Párt', 0.98, 'party_legal_name'),
    ('dk', 'Demokratikus Koalíció', 'DK', 1.00, 'party_alias'),
    ('dk', 'Demokratikus Koalíció', 'Demokratikus Koalíció', 1.00, 'party_legal_name'),
    ('momentum', 'Momentum', 'Momentum', 1.00, 'party_alias'),
    ('momentum', 'Momentum', 'Momentum Mozgalom', 0.95, 'party_legal_name'),
    ('jobbik', 'Jobbik', 'Jobbik', 1.00, 'party_alias'),
    ('jobbik', 'Jobbik', 'Jobbik Magyarországért Mozgalom', 0.95, 'party_legal_name'),
    ('mi-hazank', 'Mi Hazánk', 'Mi Hazánk', 1.00, 'party_alias'),
    ('mi-hazank', 'Mi Hazánk', 'Mi Hazánk Mozgalom', 0.95, 'party_legal_name'),
    ('lmp', 'Lehet Más a Politika', 'LMP', 1.00, 'party_alias'),
    ('lmp', 'Lehet Más a Politika', 'Lehet Más a Politika', 1.00, 'party_legal_name'),
    ('magyar-ketfarku-kutya-part', 'Magyar Kétfarkú Kutya Párt', 'MKKP', 1.00, 'party_alias'),
    ('magyar-ketfarku-kutya-part', 'Magyar Kétfarkú Kutya Párt', 'Kutyapárt', 0.95, 'party_alias'),
    ('magyar-ketfarku-kutya-part', 'Magyar Kétfarkú Kutya Párt', 'Magyar Kétfarkú Kutya Párt', 1.00, 'party_legal_name'),
    ('parbeszed', 'Párbeszéd', 'Párbeszéd', 1.00, 'party_alias'),
    ('parbeszed', 'Párbeszéd', 'Párbeszéd Magyarországért', 0.95, 'party_legal_name'),

    -- High-value universities / institutions
    ('eotvos-lorand-tudomanyegyetem', 'Eötvös Loránd Tudományegyetem', 'ELTE', 1.00, 'university_alias'),
    ('eotvos-lorand-tudomanyegyetem', 'Eötvös Loránd Tudományegyetem', 'Eötvös Loránd Tudományegyetem', 1.00, 'university_legal_name'),
    ('eotvos-lorand-tudomanyegyetem', 'Eötvös Loránd Tudományegyetem', 'Eötvös Lóránd Tudományegyetem', 0.95, 'accent_typo_variant'),
    ('bme', 'Budapesti Műszaki és Gazdaságtudományi Egyetem', 'BME', 1.00, 'university_alias'),
    ('bme', 'Budapesti Műszaki és Gazdaságtudományi Egyetem', 'Budapesti Műszaki és Gazdaságtudományi Egyetem', 1.00, 'university_legal_name'),
    ('mta', 'Magyar Tudományos Akadémia', 'MTA', 1.00, 'institution_alias'),
    ('mta', 'Magyar Tudományos Akadémia', 'Magyar Tudományos Akadémia', 1.00, 'institution_legal_name'),

    -- High-value Hungarian companies / market tickers
    ('otp-bank', 'OTP Bank', 'OTP', 0.98, 'brand_alias'),
    ('otp-bank', 'OTP Bank', 'OTP Bank', 1.00, 'canonical_name'),
    ('otp-bank', 'OTP Bank', 'OTP Bank Nyrt.', 0.98, 'legal_name'),
    ('mol', 'MOL', 'MOL', 1.00, 'ticker_alias'),
    ('mol', 'MOL', 'MOL Nyrt.', 0.98, 'legal_name'),
    ('richter-gedeon-nyrt', 'Richter Gedeon Nyrt.', 'Richter', 0.98, 'brand_alias'),
    ('richter-gedeon-nyrt', 'Richter Gedeon Nyrt.', 'Richter Gedeon', 1.00, 'canonical_name'),
    ('richter-gedeon-nyrt', 'Richter Gedeon Nyrt.', 'Richter Gedeon Nyrt.', 1.00, 'legal_name'),
    ('4ig', '4iG', '4iG', 1.00, 'ticker_alias'),
    ('4ig', '4iG', '4IG', 0.98, 'case_variant'),
    ('mbh-bank', 'MBH Bank', 'MBH', 0.98, 'brand_alias'),
    ('mbh-bank', 'MBH Bank', 'MBH Bank', 1.00, 'canonical_name'),
    ('opus-global-nyrt', 'OPUS Global Nyrt.', 'OPUS', 0.98, 'ticker_alias'),
    ('opus-global-nyrt', 'OPUS Global Nyrt.', 'OPUS Global', 1.00, 'canonical_name')
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
ON CONFLICT (normalized_alias) DO UPDATE
SET organization_id = EXCLUDED.organization_id,
    alias = EXCLUDED.alias,
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
WHERE slug IN (
  'ferencvarosi-torna-club', 'magyar-telekom',
  'fidesz', 'kdnp', 'tisza-part', 'dk', 'momentum', 'jobbik', 'mi-hazank',
  'lmp', 'magyar-ketfarku-kutya-part', 'parbeszed',
  'eotvos-lorand-tudomanyegyetem', 'bme', 'mta',
  'otp-bank', 'mol', 'richter-gedeon-nyrt', '4ig', 'mbh-bank', 'opus-global-nyrt'
);

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

-- Safe broad cleanup: exact normalized-name duplicates with the same org_type
-- are data-quality duplicates, not distinct public landing pages.
SELECT public.merge_exact_duplicate_organization_groups(250, 6);

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
    'high_value_seeded_entities', jsonb_build_array(
      'ferencvarosi-torna-club', 'magyar-telekom', 'fidesz', 'kdnp', 'tisza-part', 'dk',
      'momentum', 'jobbik', 'mi-hazank', 'lmp', 'magyar-ketfarku-kutya-part',
      'parbeszed', 'eotvos-lorand-tudomanyegyetem', 'bme', 'mta', 'otp-bank',
      'mol', 'richter-gedeon-nyrt', '4ig', 'mbh-bank', 'opus-global-nyrt'
    ),
    'exact_duplicate_auto_merge_enabled', true,
    'last_manual_seed_at', now(),
    'note', 'High-value organization aliases and duplicate merges enabled for SEO/search.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'organization_alias_quality_version', 'org_alias_quality_v1',
    'high_value_seeded_entities', jsonb_build_array(
      'ferencvarosi-torna-club', 'magyar-telekom', 'fidesz', 'kdnp', 'tisza-part', 'dk',
      'momentum', 'jobbik', 'mi-hazank', 'lmp', 'magyar-ketfarku-kutya-part',
      'parbeszed', 'eotvos-lorand-tudomanyegyetem', 'bme', 'mta', 'otp-bank',
      'mol', 'richter-gedeon-nyrt', '4ig', 'mbh-bank', 'opus-global-nyrt'
    ),
    'exact_duplicate_auto_merge_enabled', true,
    'last_manual_seed_at', now(),
    'note', 'High-value organization aliases and duplicate merges enabled for SEO/search.'
  ),
  updated_at = now();
