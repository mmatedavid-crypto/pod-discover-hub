UPDATE public.app_settings
SET value = value || jsonb_build_object('enabled', true, 'consecutive_errors', 0),
    updated_at = now()
WHERE key IN ('clean_text_autopilot', 'database_quality_fast_lane');