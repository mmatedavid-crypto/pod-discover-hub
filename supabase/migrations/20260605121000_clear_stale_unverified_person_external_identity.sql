-- If a Wikimedia/Wikidata candidate is not verified, its public identity fields
-- must not remain on the person row. Name collisions are common in Hungary:
-- the podcast participant can share a name with an unrelated actor, director,
-- artist or historical figure.

WITH cleared AS (
  UPDATE public.people p
  SET
    wikidata_id = NULL,
    wikipedia_title = NULL,
    wikipedia_url = NULL,
    wikipedia_extract = NULL,
    wikipedia_description = NULL,
    short_bio = CASE
      WHEN COALESCE(p.manual_approved, false) = false
       AND COALESCE(p.has_archival_evidence, false) = false
       AND (
         p.wikidata_id IS NOT NULL
         OR p.wikipedia_title IS NOT NULL
         OR p.wikipedia_description IS NOT NULL
         OR p.wikipedia_extract IS NOT NULL
       )
      THEN NULL
      ELSE p.short_bio
    END,
    image_url = CASE
      WHEN p.image_source = 'wikimedia'
        OR p.image_original_url ILIKE '%wikimedia%'
        OR p.image_original_url ILIKE '%wikipedia%'
      THEN NULL
      ELSE p.image_url
    END,
    image_source = CASE
      WHEN p.image_source = 'wikimedia'
        OR p.image_original_url ILIKE '%wikimedia%'
        OR p.image_original_url ILIKE '%wikipedia%'
      THEN NULL
      ELSE p.image_source
    END,
    image_original_url = CASE
      WHEN p.image_source = 'wikimedia'
        OR p.image_original_url ILIKE '%wikimedia%'
        OR p.image_original_url ILIKE '%wikipedia%'
      THEN NULL
      ELSE p.image_original_url
    END,
    image_attribution = CASE
      WHEN p.image_source = 'wikimedia'
        OR p.image_original_url ILIKE '%wikimedia%'
        OR p.image_original_url ILIKE '%wikipedia%'
      THEN NULL
      ELSE p.image_attribution
    END,
    image_license = CASE
      WHEN p.image_source = 'wikimedia'
        OR p.image_original_url ILIKE '%wikimedia%'
        OR p.image_original_url ILIKE '%wikipedia%'
      THEN NULL
      ELSE p.image_license
    END,
    image_license_url = CASE
      WHEN p.image_source = 'wikimedia'
        OR p.image_original_url ILIKE '%wikimedia%'
        OR p.image_original_url ILIKE '%wikipedia%'
      THEN NULL
      ELSE p.image_license_url
    END,
    image_author = CASE
      WHEN p.image_source = 'wikimedia'
        OR p.image_original_url ILIKE '%wikimedia%'
        OR p.image_original_url ILIKE '%wikipedia%'
      THEN NULL
      ELSE p.image_author
    END,
    image_status = CASE
      WHEN p.image_source = 'wikimedia'
        OR p.image_original_url ILIKE '%wikimedia%'
        OR p.image_original_url ILIKE '%wikipedia%'
      THEN 'needs_review'
      ELSE p.image_status
    END,
    identity_ambiguous = CASE
      WHEN COALESCE(p.manual_approved, false) = false THEN true
      ELSE p.identity_ambiguous
    END,
    disambiguation_context = COALESCE(
      p.disambiguation_context,
      'Unverified external identity cleared; podcast context must resolve name collision.'
    ),
    editorial_notes = trim(both E'\n' from concat_ws(
      E'\n',
      nullif(p.editorial_notes, ''),
      'clear_stale_unverified_person_external_identity_v1: cleared stale wiki/image/bio fields because wikipedia_match_status is not verified.'
    )),
    updated_at = now()
  WHERE p.wikipedia_match_status IS DISTINCT FROM 'verified'
    AND (
      p.wikidata_id IS NOT NULL
      OR p.wikipedia_title IS NOT NULL
      OR p.wikipedia_url IS NOT NULL
      OR p.wikipedia_extract IS NOT NULL
      OR p.wikipedia_description IS NOT NULL
      OR p.image_source = 'wikimedia'
      OR p.image_original_url ILIKE '%wikimedia%'
      OR p.image_original_url ILIKE '%wikipedia%'
    )
  RETURNING p.id
),
known_collision AS (
  UPDATE public.people p
  SET
    short_bio = NULL,
    disambiguation_label = COALESCE(p.disambiguation_label, 'pénzügyi és üzleti témákban szereplő Szabó László'),
    disambiguation_context = 'finance_business_name_collision',
    identity_ambiguous = true,
    editorial_notes = trim(both E'\n' from concat_ws(
      E'\n',
      nullif(p.editorial_notes, ''),
      'known_collision_szabo_laszlo_v2: podcast evidence points to finance/business context; unrelated film-director wiki identity must not be used.'
    )),
    updated_at = now()
  WHERE p.slug = 'szabo-laszlo'
    AND p.wikipedia_match_status IS DISTINCT FROM 'verified'
    AND (
      p.short_bio ILIKE '%filmrendező%'
      OR p.disambiguation_context IS DISTINCT FROM 'finance_business_name_collision'
    )
  RETURNING p.id
)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'person_external_identity_cleanup_policy',
  jsonb_build_object(
    'version', 1,
    'cleared_unverified_count', (SELECT count(*) FROM cleared),
    'known_collision_count', (SELECT count(*) FROM known_collision),
    'rule', 'Public person rows may use Wikidata/Wikipedia biography, title or image fields only when wikipedia_match_status=verified. Unverified matches are internal evidence only.',
    'updated_at', now()
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
