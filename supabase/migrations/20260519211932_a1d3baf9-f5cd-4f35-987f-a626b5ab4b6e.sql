UPDATE app_settings
SET value = jsonb_set(value, '{batch_limit}', '350'::jsonb),
    updated_at = now()
WHERE key = 'person_relevance_judge_controls';