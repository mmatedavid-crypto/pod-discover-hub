-- Constants:
--   person_id = 8bff7f36-9ffc-41fb-b1f0-6f1ccfeda3f1  (Orbán Viktor)
--   podcast_ids: aabd8ec6-..., 9dac9dbd-...

-- 1) Update existing mentions in the two PM-interview podcasts → participant
UPDATE person_episode_mentions pem
SET role_type = 'participant',
    role_confidence = GREATEST(COALESCE(pem.role_confidence, 0), 0.95),
    role_reason = 'Heti miniszterelnöki interjú a közmédiában (Orbán PM-szabály, ≤2026-04-12)',
    source_evidence = jsonb_set(
      COALESCE(pem.source_evidence, '{}'::jsonb),
      '{pm_weekly_interview}', 'true'::jsonb, true
    ),
    mention_type = 'host',
    relevance_status = 'accepted',
    final_relevance_score = GREATEST(COALESCE(pem.final_relevance_score, 0), 0.95)
FROM episodes e
WHERE pem.episode_id = e.id
  AND pem.person_id = '8bff7f36-9ffc-41fb-b1f0-6f1ccfeda3f1'
  AND e.podcast_id IN ('aabd8ec6-ad16-4ca6-a7a1-3eb2f6f0252f','9dac9dbd-334b-4eea-a1a4-1b12c159cb3c')
  AND e.published_at <= '2026-04-12'::timestamptz;

-- 2) Insert missing mentions for episodes with no Orbán mention yet
INSERT INTO person_episode_mentions (
  person_id, episode_id, podcast_id, mention_type, confidence, evidence, source,
  relevance_status, final_relevance_score,
  role_type, role_confidence, role_reason, source_evidence
)
SELECT
  '8bff7f36-9ffc-41fb-b1f0-6f1ccfeda3f1'::uuid,
  e.id,
  e.podcast_id,
  'host',
  0.95,
  'Heti miniszterelnöki interjú – Orbán Viktor saját megszólalása.',
  'orban_pm_rule_2026_05_20',
  'accepted',
  0.95,
  'participant',
  0.95,
  'Heti miniszterelnöki interjú a közmédiában (Orbán PM-szabály, ≤2026-04-12)',
  '{"pm_weekly_interview": true, "rule_applied_at": "2026-05-20"}'::jsonb
FROM episodes e
WHERE e.podcast_id IN ('aabd8ec6-ad16-4ca6-a7a1-3eb2f6f0252f','9dac9dbd-334b-4eea-a1a4-1b12c159cb3c')
  AND e.published_at <= '2026-04-12'::timestamptz
  AND NOT EXISTS (
    SELECT 1 FROM person_episode_mentions pem2
    WHERE pem2.person_id = '8bff7f36-9ffc-41fb-b1f0-6f1ccfeda3f1'
      AND pem2.episode_id = e.id
  );

-- 3) Recompute Orbán's role counts on people
SELECT public.recompute_person_role_counts();
