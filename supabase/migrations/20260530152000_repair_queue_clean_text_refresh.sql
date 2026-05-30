UPDATE public.app_settings
SET value = value
  || jsonb_build_object(
    'mode', 'repair_queue',
    'note', 'Clean-text refresh now uses v_data_repair_queue priority when available. Full pipeline remains dry-run unless explicitly disabled.'
  ),
  updated_at = now()
WHERE key = 'clean_text_autopilot';
