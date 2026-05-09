UPDATE public.app_settings 
   SET value = jsonb_set(value, '{model}', '"google/gemini-embedding-001"'::jsonb),
       updated_at = now()
 WHERE key = 'embed_episode_controls';