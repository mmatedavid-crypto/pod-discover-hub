UPDATE public.pi_feed_staging
SET processed = false,
    decision = 'accept',
    reject_reason = NULL,
    processed_at = NULL,
    next_process_attempt_at = NULL,
    process_attempts = 0
WHERE id IN (
  '686d46e4-9b17-488d-96f1-3d84fdf8c763',
  'fb5ca838-2311-4e1a-9c07-4c432f609152'
);