-- Reset HU person-episode mentions tagged as 'mention' where description has participant keywords,
-- so the upgraded person-relevance-judge can re-promote them to participant/guest.
UPDATE person_episode_mentions pem
SET relevance_status = 'pending',
    ai_judged_at = NULL
FROM episodes e, podcasts p
WHERE pem.episode_id = e.id
  AND pem.podcast_id = p.id
  AND p.language ILIKE 'hu%'
  AND pem.role_type = 'mention'
  AND (
    e.description ILIKE '%Közreműköd%' OR
    e.description ILIKE '%Szereplők:%' OR
    e.description ILIKE '%Fellép%' OR
    e.description ILIKE '%Vendég:%' OR
    e.description ILIKE '%Vendégünk%' OR
    e.description ILIKE '%Beszélget%' OR
    e.description ILIKE '%Beszélgetőtárs%' OR
    e.description ILIKE '%Műsorvezet%' OR
    e.description ILIKE '%Házigazda%' OR
    e.description ILIKE '%Előadó%' OR
    e.description ILIKE '%Olvassa:%' OR
    e.description ILIKE '%Felolvas%' OR
    e.description ILIKE '%Énekel%' OR
    e.description ILIKE '%Játssza%' OR
    e.description ILIKE '%Rendező:%' OR
    e.description ILIKE '%Interjú:%' OR
    e.description ILIKE '%Riportalany%'
  );

-- Re-enable the judge runner in case it auto-disabled.
UPDATE app_settings
SET value = jsonb_set(COALESCE(value, '{}'::jsonb), '{enabled}', 'true'::jsonb, true)
WHERE key = 'person_relevance_judge_controls';
