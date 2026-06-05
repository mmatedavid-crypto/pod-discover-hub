-- A deceased external identity with podcast-person evidence is usually a name
-- collision, not proof that the dead person appeared in a podcast.
-- Fail closed: remove stale public bio/wiki/image evidence and require review.

WITH collision_rows AS (
  UPDATE public.people p
  SET
    is_public = false,
    is_indexable = false,
    is_browsable_in_people_hub = false,
    activation_status = 'inactive',
    ai_review_status = 'needs_human_review',
    ai_recommended_action = 'review',
    identity_ambiguous = true,
    wikipedia_match_status = 'needs_review',
    wikidata_id = null,
    wikipedia_title = null,
    wikipedia_url = null,
    wikipedia_extract = null,
    wikipedia_description = null,
    image_status = CASE WHEN p.image_url IS NOT NULL THEN 'needs_review' ELSE 'none' END,
    image_original_url = null,
    image_attribution = null,
    image_license = null,
    disambiguation_context = 'Halott/történelmi külső identitás ütközik podcast-szereplő bizonyítékkal; kézi névazonosság-ellenőrzés szükséges.',
    browsable_reason = 'dead_person_name_collision_fail_closed_v1',
    editorial_notes = trim(both E'\n' from concat_ws(
      E'\n',
      nullif(p.editorial_notes, ''),
      'dead_person_name_collision_fail_closed_v1: hidden/reviewed because a deceased external identity cannot be assumed to be the podcast participant with the same name.'
    )),
    updated_at = now()
  WHERE COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND (
      COALESCE(p.participant_count, 0)
      + COALESCE(p.host_count, 0)
      + COALESCE(p.guest_count, 0)
    ) > 0
    AND (
      p.is_deceased IS TRUE
      OR p.is_historical IS TRUE
      OR p.persona = 'historical'
      OR p.date_of_death IS NOT NULL
      OR p.is_living IS FALSE
    )
  RETURNING p.id
),
topic_only_rows AS (
  UPDATE public.people p
  SET
    is_public = false,
    is_indexable = false,
    is_browsable_in_people_hub = false,
    activation_status = 'inactive',
    ai_recommended_action = 'hide',
    browsable_reason = 'dead_person_no_podcast_profile_guard_v4',
    editorial_notes = trim(both E'\n' from concat_ws(
      E'\n',
      nullif(p.editorial_notes, ''),
      'dead_person_no_podcast_profile_guard_v4: hidden because deceased/historical rows without archival approval are not podcast-person profiles.'
    )),
    updated_at = now()
  WHERE COALESCE(p.manual_approved, false) = false
    AND COALESCE(p.has_archival_evidence, false) = false
    AND (
      COALESCE(p.participant_count, 0)
      + COALESCE(p.host_count, 0)
      + COALESCE(p.guest_count, 0)
    ) = 0
    AND (
      p.is_deceased IS TRUE
      OR p.is_historical IS TRUE
      OR p.persona = 'historical'
      OR p.date_of_death IS NOT NULL
      OR p.is_living IS FALSE
    )
  RETURNING p.id
)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'dead_person_name_collision_policy',
  jsonb_build_object(
    'version', 1,
    'collision_review_count', (SELECT count(*) FROM collision_rows),
    'topic_only_hidden_count', (SELECT count(*) FROM topic_only_rows),
    'rule', 'Dead/historical external identities are never treated as ordinary podcast participants. With participant evidence they become hidden review cases; without participant evidence they are hidden topic-only rows unless manually approved as archival.',
    'updated_at', now()
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
