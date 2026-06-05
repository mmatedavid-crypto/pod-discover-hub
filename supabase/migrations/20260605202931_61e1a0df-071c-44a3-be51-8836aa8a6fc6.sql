WITH suspicious_temporal_participants AS (
  UPDATE public.people p
  SET
    date_of_death = NULL,
    is_living = NULL,
    wikidata_id = NULL,
    wikipedia_title = NULL,
    wikipedia_url = NULL,
    wikipedia_extract = NULL,
    wikipedia_description = NULL,
    wikipedia_match_status = 'needs_review',
    wikipedia_match_confidence = 0,
    image_status = CASE WHEN p.image_url IS NOT NULL THEN 'needs_review' ELSE COALESCE(p.image_status, 'none') END,
    image_original_url = NULL,
    image_attribution = NULL,
    image_license = NULL,
    identity_ambiguous = true,
    ai_review_status = 'needs_human_review',
    editorial_notes = trim(both E'\n' from concat_ws(
      E'\n',
      nullif(p.editorial_notes, ''),
      'temporal_person_public_guard_v5: cleared unsupported death/living metadata because podcast participant evidence conflicts with an unapproved external temporal identity.'
    )),
    updated_at = now()
  WHERE COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND COALESCE(p.is_deceased, false) = false
    AND COALESCE(p.is_historical, false) = false
    AND COALESCE(p.persona, '') <> 'historical'
    AND (p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
    AND (
      COALESCE(p.participant_count, 0)
      + COALESCE(p.host_count, 0)
      + COALESCE(p.guest_count, 0)
    ) > 0
  RETURNING p.id
),
demoted_temporal_people AS (
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
    browsable_reason = 'temporal_person_public_guard_v5',
    editorial_notes = trim(both E'\n' from concat_ws(
      E'\n',
      nullif(p.editorial_notes, ''),
      'temporal_person_public_guard_v5: hidden because deceased/historical/date_of_death rows are not podcast-person profiles without manual_approved or has_archival_evidence.'
    )),
    updated_at = now()
  WHERE COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND (
      p.is_deceased IS TRUE
      OR p.is_historical IS TRUE
      OR p.persona = 'historical'
      OR (
        p.date_of_death IS NOT NULL
        AND (
          COALESCE(p.participant_count, 0)
          + COALESCE(p.host_count, 0)
          + COALESCE(p.guest_count, 0)
        ) = 0
      )
      OR (
        p.is_living IS FALSE
        AND (
          COALESCE(p.participant_count, 0)
          + COALESCE(p.host_count, 0)
          + COALESCE(p.guest_count, 0)
        ) = 0
      )
    )
    AND (
      p.is_public IS TRUE
      OR p.is_indexable IS TRUE
      OR p.is_browsable_in_people_hub IS TRUE
      OR p.activation_status <> 'inactive'
      OR COALESCE(p.ai_recommended_action, '') NOT IN ('hide', 'review')
    )
  RETURNING p.id
),
rejected_temporal_aliases AS (
  UPDATE public.person_aliases pa
  SET
    status = 'rejected',
    source = 'temporal_person_public_guard_v5'
  FROM public.people p
  WHERE pa.person_id = p.id
    AND COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND (
      p.is_deceased IS TRUE
      OR p.is_historical IS TRUE
      OR p.persona = 'historical'
      OR (
        p.date_of_death IS NOT NULL
        AND (
          COALESCE(p.participant_count, 0)
          + COALESCE(p.host_count, 0)
          + COALESCE(p.guest_count, 0)
        ) = 0
      )
      OR (
        p.is_living IS FALSE
        AND (
          COALESCE(p.participant_count, 0)
          + COALESCE(p.host_count, 0)
          + COALESCE(p.guest_count, 0)
        ) = 0
      )
    )
  RETURNING pa.id
)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'temporal_person_public_guard_policy',
  jsonb_build_object(
    'version', 5,
    'demoted_temporal_people_count', (SELECT count(*) FROM demoted_temporal_people),
    'cleared_suspicious_temporal_participant_count', (SELECT count(*) FROM suspicious_temporal_participants),
    'rejected_temporal_alias_count', (SELECT count(*) FROM rejected_temporal_aliases),
    'rule', 'Dead, historical, date_of_death or is_living=false rows are not public/indexable podcast-person profiles without manual_approved or has_archival_evidence.',
    'participant_collision_rule', 'If an otherwise non-historical podcast participant only has unsupported death/living metadata, clear the temporal external identity and send the row to human review instead of publishing the stale biography.',
    'updated_at', now()
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();