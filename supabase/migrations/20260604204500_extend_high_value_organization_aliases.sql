-- Extend high-value Hungarian organization aliases used by search, SEO pages
-- and the organization backfill. This keeps common aliases on one canonical
-- public landing page instead of creating duplicate organization rows.

WITH canonical(slug, name, normalized_name, org_type, priority) AS (
  VALUES
    ('magyar-telekom', 'Magyar Telekom', public.normalize_entity_alias('Magyar Telekom'), 'company', 95),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', public.normalize_entity_alias('Ferencvárosi Torna Club'), 'sport_team', 95),
    ('otp-bank', 'OTP Bank', public.normalize_entity_alias('OTP Bank'), 'company', 90),
    ('mol', 'MOL', public.normalize_entity_alias('MOL'), 'company', 90),
    ('richter-gedeon-nyrt', 'Richter Gedeon Nyrt.', public.normalize_entity_alias('Richter Gedeon Nyrt.'), 'company', 88),
    ('4ig', '4iG', public.normalize_entity_alias('4iG'), 'company', 86),
    ('mav', 'MÁV', public.normalize_entity_alias('MÁV'), 'institution', 84),
    ('bkk', 'BKK', public.normalize_entity_alias('BKK'), 'institution', 84),
    ('mvm', 'MVM', public.normalize_entity_alias('MVM'), 'company', 84)
)
INSERT INTO public.organizations (
  slug, name, normalized_name, org_type, manually_seeded,
  editorial_priority, editorial_priority_level, is_public, is_indexable,
  is_browsable_in_hub, browsable_reason, editorial_notes, updated_at
)
SELECT
  slug, name, normalized_name, org_type, true,
  true, priority, true, true,
  true, 'high_value_alias_seed', 'high_value_hu_alias_canonical', now()
FROM canonical
ON CONFLICT (slug) DO UPDATE
SET name = EXCLUDED.name,
    normalized_name = EXCLUDED.normalized_name,
    org_type = EXCLUDED.org_type,
    manually_seeded = true,
    editorial_priority = true,
    editorial_priority_level = GREATEST(public.organizations.editorial_priority_level, EXCLUDED.editorial_priority_level),
    is_public = true,
    is_indexable = true,
    is_browsable_in_hub = true,
    browsable_reason = COALESCE(public.organizations.browsable_reason, 'high_value_alias_seed'),
    editorial_notes = trim(both E'\n' from concat_ws(E'\n', public.organizations.editorial_notes, 'high_value_hu_alias_canonical')),
    updated_at = now();

WITH seed(canonical_slug, canonical_name, alias, confidence, notes) AS (
  VALUES
    ('magyar-telekom', 'Magyar Telekom', 'Telekom', 0.99, 'common_brand_alias'),
    ('magyar-telekom', 'Magyar Telekom', 'Magyar Telekom', 1.00, 'canonical_name'),
    ('magyar-telekom', 'Magyar Telekom', 'MTELEKOM', 0.99, 'ticker_alias'),
    ('magyar-telekom', 'Magyar Telekom', 'MTEL', 0.99, 'ticker_alias'),
    ('magyar-telekom', 'Magyar Telekom', 'Magyar Telekom Nyrt', 0.98, 'legal_name'),
    ('magyar-telekom', 'Magyar Telekom', 'Magyar Telekom Nyrt.', 0.98, 'legal_name'),
    ('magyar-telekom', 'Magyar Telekom', 'Telekom HU', 0.95, 'brand_alias'),
    ('magyar-telekom', 'Magyar Telekom', 'Telekom Hungary', 0.95, 'brand_alias'),
    ('magyar-telekom', 'Magyar Telekom', 'T-Mobile Hungary', 0.85, 'legacy_brand_alias'),

    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'Fradi', 0.99, 'common_sport_alias'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'FTC', 0.99, 'common_sport_alias'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'Ferencváros', 0.98, 'common_short_name'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'Ferencvárosi Torna Club', 1.00, 'canonical_name'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'Ferencvárosi Torna Klub', 0.98, 'orthographic_variant'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'Ferencvárosi TC', 0.95, 'common_abbreviation'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'FTC-Telekom', 0.85, 'sponsor_name_variant'),
    ('ferencvarosi-torna-club', 'Ferencvárosi Torna Club', 'fradi.hu', 0.80, 'site_variant'),

    ('otp-bank', 'OTP Bank', 'OTP', 0.98, 'ticker_alias'),
    ('otp-bank', 'OTP Bank', 'OTP Bank', 1.00, 'canonical_name'),
    ('otp-bank', 'OTP Bank', 'OTP Bank Nyrt', 0.98, 'legal_name'),
    ('otp-bank', 'OTP Bank', 'OTP Bank Nyrt.', 0.98, 'legal_name'),
    ('mol', 'MOL', 'MOL', 1.00, 'ticker_alias'),
    ('mol', 'MOL', 'MOL Nyrt', 0.98, 'legal_name'),
    ('mol', 'MOL', 'MOL Nyrt.', 0.98, 'legal_name'),
    ('richter-gedeon-nyrt', 'Richter Gedeon Nyrt.', 'Richter', 0.98, 'brand_alias'),
    ('richter-gedeon-nyrt', 'Richter Gedeon Nyrt.', 'Richter Gedeon', 1.00, 'canonical_name'),
    ('richter-gedeon-nyrt', 'Richter Gedeon Nyrt.', 'Gedeon Richter', 0.98, 'name_order_variant'),
    ('richter-gedeon-nyrt', 'Richter Gedeon Nyrt.', 'Richter Gedeon Nyrt', 0.98, 'legal_name'),
    ('richter-gedeon-nyrt', 'Richter Gedeon Nyrt.', 'Richter Gedeon Nyrt.', 0.98, 'legal_name'),
    ('4ig', '4iG', '4iG', 1.00, 'ticker_alias'),
    ('4ig', '4iG', '4IG', 0.98, 'case_variant'),
    ('4ig', '4iG', '4iG Nyrt', 0.98, 'legal_name'),
    ('4ig', '4iG', '4iG Nyrt.', 0.98, 'legal_name'),
    ('mav', 'MÁV', 'MÁV', 1.00, 'institution_alias'),
    ('mav', 'MÁV', 'MAV', 0.98, 'accentless_alias'),
    ('mav', 'MÁV', 'MÁV Csoport', 0.98, 'group_alias'),
    ('mav', 'MÁV', 'MAV Csoport', 0.96, 'accentless_group_alias'),
    ('mav', 'MÁV', 'MÁV-START', 0.92, 'subsidiary_alias'),
    ('mav', 'MÁV', 'MAV-START', 0.90, 'accentless_subsidiary_alias'),
    ('bkk', 'BKK', 'BKK', 1.00, 'institution_alias'),
    ('bkk', 'BKK', 'Budapesti Közlekedési Központ', 1.00, 'legal_name'),
    ('bkk', 'BKK', 'Budapesti Kozlekedesi Kozpont', 0.98, 'accentless_legal_name'),
    ('mvm', 'MVM', 'MVM', 1.00, 'company_alias'),
    ('mvm', 'MVM', 'MVM Csoport', 0.98, 'group_alias'),
    ('mvm', 'MVM', 'Magyar Villamos Művek', 1.00, 'legal_name'),
    ('mvm', 'MVM', 'Magyar Villamos Muvek', 0.98, 'accentless_legal_name')
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
  'high_value_hu_alias_extension',
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
  'high_value_hu_alias_extension',
  LEAST(1.0, GREATEST(0.45, a.weight::numeric / 100.0)),
  'accepted'
FROM public.canonical_entity_aliases a
JOIN public.organizations o ON o.slug = a.canonical_slug
WHERE a.entity_kind = 'organization'
  AND a.status = 'active'
  AND a.source = 'high_value_hu_alias_extension'
ON CONFLICT (normalized_alias) DO UPDATE
SET organization_id = EXCLUDED.organization_id,
    alias = EXCLUDED.alias,
    confidence = GREATEST(public.organization_aliases.confidence, EXCLUDED.confidence),
    status = 'accepted',
    source = EXCLUDED.source;

-- The company is named after a historical person, but in this podcast catalog
-- "Richter Gedeon" should resolve to the organization unless there is explicit
-- archival person evidence. Hide any accidental person pages created from the
-- company alias so Google/users do not land on a misleading biography page.
UPDATE public.people
SET is_public = false,
    is_indexable = false,
    activation_status = 'inactive',
    ai_recommended_action = 'reject',
    ai_review_status = 'reviewed',
    editorial_notes = trim(both E'\n' from concat_ws(E'\n', editorial_notes, 'hidden_as_company_eponym_without_podcast_person_evidence')),
    updated_at = now()
WHERE slug IN ('richter-gedeon', 'gedeon-richter')
  AND COALESCE(has_archival_evidence, false) = false
  AND COALESCE(manual_approved, false) = false;

UPDATE public.person_aliases pa
SET status = 'rejected',
    source = 'hidden_as_company_eponym_without_podcast_person_evidence'
FROM public.people p
WHERE pa.person_id = p.id
  AND p.slug IN ('richter-gedeon', 'gedeon-richter')
  AND COALESCE(p.has_archival_evidence, false) = false
  AND COALESCE(p.manual_approved, false) = false;
