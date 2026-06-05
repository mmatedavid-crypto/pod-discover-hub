-- Reassert the strict public-person rule after the v5 compatibility reassert:
-- a deceased or historical identity is not a podcast participant page merely
-- because an extractor counted a title/subject collision as a role.

WITH demoted_temporal_people AS (
  UPDATE public.people p
  SET
    is_public = false,
    is_indexable = false,
    is_browsable_in_people_hub = false,
    activation_status = 'inactive',
    ai_recommended_action = CASE
      WHEN (
        COALESCE(p.participant_count, 0)
        + COALESCE(p.host_count, 0)
        + COALESCE(p.guest_count, 0)
      ) > 0 THEN 'review'
      ELSE 'hide'
    END,
    ai_review_status = CASE
      WHEN (
        COALESCE(p.participant_count, 0)
        + COALESCE(p.host_count, 0)
        + COALESCE(p.guest_count, 0)
      ) > 0 THEN 'needs_human_review'
      ELSE COALESCE(p.ai_review_status, 'reviewed')
    END,
    identity_ambiguous = CASE
      WHEN (
        COALESCE(p.participant_count, 0)
        + COALESCE(p.host_count, 0)
        + COALESCE(p.guest_count, 0)
      ) > 0 THEN true
      ELSE COALESCE(p.identity_ambiguous, false)
    END,
    browsable_reason = 'strict_temporal_person_guard_v6',
    editorial_notes = trim(both E'\n' from concat_ws(
      E'\n',
      nullif(p.editorial_notes, ''),
      'strict_temporal_person_guard_v6: hidden because deceased/historical/date_of_death rows are not podcast-person profiles without manual_approved or has_archival_evidence; participant counters can be title/subject collisions.'
    )),
    updated_at = now()
  WHERE COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND (
      p.is_deceased IS TRUE
      OR p.is_historical IS TRUE
      OR p.persona = 'historical'
      OR p.date_of_death IS NOT NULL
      OR p.is_living IS FALSE
    )
    AND (
      p.is_public IS TRUE
      OR p.is_indexable IS TRUE
      OR p.is_browsable_in_people_hub IS TRUE
      OR p.activation_status <> 'inactive'
      OR COALESCE(p.ai_recommended_action, '') NOT IN ('hide', 'review')
      OR (
        (
          COALESCE(p.participant_count, 0)
          + COALESCE(p.host_count, 0)
          + COALESCE(p.guest_count, 0)
        ) > 0
        AND COALESCE(p.ai_review_status, '') <> 'needs_human_review'
      )
    )
  RETURNING p.id
),
rejected_temporal_aliases AS (
  UPDATE public.person_aliases pa
  SET
    status = 'rejected',
    source = 'strict_temporal_person_guard_v6'
  FROM public.people p
  WHERE pa.person_id = p.id
    AND COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND (
      p.is_deceased IS TRUE
      OR p.is_historical IS TRUE
      OR p.persona = 'historical'
      OR p.date_of_death IS NOT NULL
      OR p.is_living IS FALSE
    )
  RETURNING pa.id
)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'temporal_person_public_guard_policy',
  jsonb_build_object(
    'version', 6,
    'demoted_temporal_people_count', (SELECT count(*) FROM demoted_temporal_people),
    'rejected_temporal_alias_count', (SELECT count(*) FROM rejected_temporal_aliases),
    'rule', 'Dead, historical, date_of_death or is_living=false rows are not public/indexable podcast-person profiles without manual_approved or has_archival_evidence.',
    'participant_collision_rule', 'Fail closed: participant/host/guest counters do not override temporal identity evidence because old historical subjects can be misread as podcast guests.',
    'updated_at', now()
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
