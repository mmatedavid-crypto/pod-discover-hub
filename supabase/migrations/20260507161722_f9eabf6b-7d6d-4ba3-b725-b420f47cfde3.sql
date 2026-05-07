
DROP TABLE IF EXISTS public.podcasts_backup_pre_c_v3;
CREATE TABLE public.podcasts_backup_pre_c_v3 AS
SELECT id, podiverzum_rank, rank_label, rank_reason, rank_updated_at,
       refresh_interval_minutes, shadow_rank, shadow_rank_tier, shadow_rank_components,
       now() AS backed_up_at
FROM public.podcasts;

DROP TRIGGER IF EXISTS trg_podcasts_sync_refresh_interval ON public.podcasts;
DROP TRIGGER IF EXISTS sync_refresh_interval_from_rank ON public.podcasts;

ALTER TABLE public.podcasts
  ALTER COLUMN podiverzum_rank DROP DEFAULT,
  ALTER COLUMN podiverzum_rank TYPE numeric(4,2)
  USING podiverzum_rank::numeric(4,2);

ALTER TABLE public.podcasts
  ALTER COLUMN podiverzum_rank SET DEFAULT 1.0;

UPDATE public.podcasts
   SET podiverzum_rank = COALESCE(shadow_rank, podiverzum_rank),
       rank_label = COALESCE(shadow_rank_tier, rank_label),
       rank_reason = COALESCE(shadow_rank_components, rank_reason),
       rank_updated_at = now()
 WHERE shadow_rank IS NOT NULL;

CREATE OR REPLACE FUNCTION public.sync_refresh_interval_from_rank()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  hs text;
BEGIN
  hs := COALESCE(NEW.shadow_rank_components->>'health_state', '');
  IF hs = 'recovered_rss_url' THEN
    NEW.refresh_interval_minutes := 60;
  ELSIF hs IN ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam') THEN
    NEW.refresh_interval_minutes := 10080;
  ELSE
    NEW.refresh_interval_minutes := CASE NEW.rank_label
      WHEN 'S' THEN 30
      WHEN 'A' THEN 120
      WHEN 'B' THEN 360
      WHEN 'C' THEN 1440
      WHEN 'D' THEN 4320
      WHEN 'E' THEN 10080
      ELSE
        CASE
          WHEN NEW.podiverzum_rank >= 8.5 THEN 30
          WHEN NEW.podiverzum_rank >= 7.0 THEN 120
          WHEN NEW.podiverzum_rank >= 5.5 THEN 360
          WHEN NEW.podiverzum_rank >= 4.0 THEN 1440
          WHEN NEW.podiverzum_rank >= 2.5 THEN 4320
          ELSE 10080
        END
    END;
  END IF;
  RETURN NEW;
END
$function$;

CREATE TRIGGER trg_podcasts_sync_refresh_interval
BEFORE INSERT OR UPDATE ON public.podcasts
FOR EACH ROW EXECUTE FUNCTION public.sync_refresh_interval_from_rank();

UPDATE public.podcasts SET
  refresh_interval_minutes = CASE
    WHEN COALESCE(shadow_rank_components->>'health_state','') = 'recovered_rss_url' THEN 60
    WHEN COALESCE(shadow_rank_components->>'health_state','') IN ('rss_url_not_found','needs_manual_rss_review','confirmed_dead','quarantined_spam') THEN 10080
    WHEN rank_label = 'S' THEN 30
    WHEN rank_label = 'A' THEN 120
    WHEN rank_label = 'B' THEN 360
    WHEN rank_label = 'C' THEN 1440
    WHEN rank_label = 'D' THEN 4320
    WHEN rank_label = 'E' THEN 10080
    WHEN podiverzum_rank >= 8.5 THEN 30
    WHEN podiverzum_rank >= 7.0 THEN 120
    WHEN podiverzum_rank >= 5.5 THEN 360
    WHEN podiverzum_rank >= 4.0 THEN 1440
    WHEN podiverzum_rank >= 2.5 THEN 4320
    ELSE 10080
  END;

CREATE INDEX IF NOT EXISTS podcasts_rank_label_idx
  ON public.podcasts (rank_label, podiverzum_rank DESC);

CREATE INDEX IF NOT EXISTS podcasts_shadow_health_idx
  ON public.podcasts ((shadow_rank_components->>'health_state'));
