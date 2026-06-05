-- A public organization alias and an unapproved person with the same normalized
-- name is a high-risk type collision. The organization should remain the
-- default public entity unless the person has explicit editorial/archival
-- evidence. This is broader than hand-seeded eponyms such as Richter Gedeon.

WITH organization_names AS (
  SELECT DISTINCT oa.normalized_alias, o.name AS organization_name, o.slug AS organization_slug
  FROM public.organization_aliases oa
  JOIN public.organizations o ON o.id = oa.organization_id
  WHERE oa.status = 'accepted'
    AND oa.normalized_alias IS NOT NULL
    AND COALESCE(o.is_public, true) = true
    AND COALESCE(o.is_indexable, true) = true
),
colliding_people AS (
  SELECT
    p.id,
    p.name,
    onm.organization_name,
    onm.organization_slug,
    (
      COALESCE(p.participant_count, 0)
      + COALESCE(p.host_count, 0)
      + COALESCE(p.guest_count, 0)
    ) AS person_evidence
  FROM public.people p
  JOIN organization_names onm
    ON onm.normalized_alias = p.normalized_name
  WHERE COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
),
hidden_weak_people AS (
  UPDATE public.people p
  SET
    is_public = false,
    is_indexable = false,
    is_browsable_in_people_hub = false,
    activation_status = 'inactive',
    ai_recommended_action = 'reject',
    ai_review_status = 'reviewed',
    identity_ambiguous = true,
    disambiguation_context = 'Organization/person name collision; the public entity is the organization unless editorially approved as a person.',
    browsable_reason = 'organization_person_name_collision_guard_v1',
    editorial_notes = trim(both E'\n' from concat_ws(
      E'\n',
      nullif(p.editorial_notes, ''),
      'organization_person_name_collision_guard_v1: hidden because the same normalized name is an accepted organization alias and this person has no podcast-person evidence.'
    )),
    updated_at = now()
  FROM colliding_people cp
  WHERE p.id = cp.id
    AND cp.person_evidence = 0
  RETURNING p.id
),
review_people_with_evidence AS (
  UPDATE public.people p
  SET
    identity_ambiguous = true,
    ai_review_status = CASE
      WHEN COALESCE(p.ai_review_status, '') = 'reviewed' THEN p.ai_review_status
      ELSE 'needs_human_review'
    END,
    ai_recommended_action = CASE
      WHEN COALESCE(p.ai_recommended_action, '') IN ('hide', 'reject', 'merge') THEN p.ai_recommended_action
      ELSE 'review'
    END,
    disambiguation_context = COALESCE(
      p.disambiguation_context,
      'Organization/person name collision; keep person public only after identity review.'
    ),
    editorial_notes = trim(both E'\n' from concat_ws(
      E'\n',
      nullif(p.editorial_notes, ''),
      'organization_person_name_collision_guard_v1: review required because an accepted organization alias has the same normalized name as this podcast person.'
    )),
    updated_at = now()
  FROM colliding_people cp
  WHERE p.id = cp.id
    AND cp.person_evidence > 0
    AND COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
  RETURNING p.id
),
rejected_aliases AS (
  UPDATE public.person_aliases pa
  SET
    status = 'rejected',
    source = 'organization_person_name_collision_guard_v1',
    review_reason = 'Alias collides with accepted organization alias and the person is not editorially approved.',
    reviewed_at = now()
  FROM hidden_weak_people hp
  WHERE pa.person_id = hp.id
    AND pa.status = 'accepted'
  RETURNING pa.id
)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'organization_person_name_collision_policy',
  jsonb_build_object(
    'version', 1,
    'hidden_weak_people_count', (SELECT count(*) FROM hidden_weak_people),
    'review_people_with_evidence_count', (SELECT count(*) FROM review_people_with_evidence),
    'rejected_alias_count', (SELECT count(*) FROM rejected_aliases),
    'rule', 'Accepted organization aliases take precedence over unapproved person rows with the same normalized name. Weak person rows are hidden; evidence-bearing rows require identity review unless manual/archival approved.',
    'updated_at', now()
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
