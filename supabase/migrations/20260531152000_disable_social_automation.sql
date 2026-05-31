INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'social_automation_controls',
  jsonb_build_object(
    'enabled', false,
    'allow_manual_posting', false,
    'allow_dry_run_preview', false,
    'disabled_at', now(),
    'disabled_reason', 'Automatic X/TikTok/social content generation was unused and intentionally disabled.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

DO $$
DECLARE
  r record;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT jobid
    FROM cron.job
    WHERE lower(coalesce(jobname, '')) SIMILAR TO '%(social|tweet|twitter|x-metrics|daily-social)%'
       OR lower(coalesce(command, '')) SIMILAR TO '%(daily-social-post|x-metrics-fetch|generate-social-card)%'
  LOOP
    BEGIN
      PERFORM cron.unschedule(r.jobid);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'Could not unschedule social cron job %: %', r.jobid, SQLERRM;
    END;
  END LOOP;
END $$;
