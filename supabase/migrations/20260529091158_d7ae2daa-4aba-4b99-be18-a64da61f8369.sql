TRUNCATE TABLE public.episode_clean_text;
UPDATE public.episodes SET clean_text_status = 'pending' WHERE clean_text_status IN ('done','skipped','error');