UPDATE app_settings 
SET value = jsonb_set(value, '{max_audio_mb}', '30'::jsonb),
    updated_at = now()
WHERE key = 'stt_controls';