UPDATE public.pi_feed_staging
SET processed = false,
    decision = 'accept',
    ai_decision = 'accept',
    ai_detected_language = 'hu',
    ai_likely_category = 'society-culture',
    reject_reason = NULL,
    processed_at = NULL,
    process_attempts = 0,
    next_process_attempt_at = NULL
WHERE id = '5ba45142-5a7b-46a4-a4c0-e0bc0086ff98';