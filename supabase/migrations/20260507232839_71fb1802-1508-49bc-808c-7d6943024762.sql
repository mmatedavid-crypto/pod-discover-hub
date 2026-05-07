UPDATE public.app_settings
   SET value = jsonb_set(value, '{batch_size}', '50'::jsonb),
       updated_at = now()
 WHERE key = 'embed_controls';