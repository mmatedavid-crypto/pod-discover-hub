
ALTER TABLE public.pi_feed_staging ADD COLUMN IF NOT EXISTS rss_url_norm text;
ALTER TABLE public.podcasts ADD COLUMN IF NOT EXISTS rss_url_norm text;

CREATE OR REPLACE FUNCTION public.fill_rss_url_norm()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  NEW.rss_url_norm := public.normalize_rss_url(NEW.rss_url);
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS pi_feed_staging_norm ON public.pi_feed_staging;
CREATE TRIGGER pi_feed_staging_norm
BEFORE INSERT OR UPDATE OF rss_url ON public.pi_feed_staging
FOR EACH ROW EXECUTE FUNCTION public.fill_rss_url_norm();

DROP TRIGGER IF EXISTS podcasts_norm ON public.podcasts;
CREATE TRIGGER podcasts_norm
BEFORE INSERT OR UPDATE OF rss_url ON public.podcasts
FOR EACH ROW EXECUTE FUNCTION public.fill_rss_url_norm();

CREATE OR REPLACE FUNCTION public.merge_duplicate_podcasts(
  _canonical_id uuid, _duplicate_id uuid, _reason text DEFAULT 'fuzzy_dedup'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_moved int := 0; v_deleted_ep int := 0; v_deleted_emb int := 0;
BEGIN
  IF _canonical_id = _duplicate_id THEN RAISE EXCEPTION 'canonical and duplicate must differ'; END IF;
  WITH moved AS (
    UPDATE public.episodes e SET podcast_id = _canonical_id
     WHERE e.podcast_id = _duplicate_id
       AND NOT EXISTS (
         SELECT 1 FROM public.episodes e2 WHERE e2.podcast_id = _canonical_id
           AND ((e.guid IS NOT NULL AND e2.guid = e.guid)
                OR (e.guid IS NULL AND e2.audio_url = e.audio_url))
       ) RETURNING 1
  ) SELECT count(*) INTO v_moved FROM moved;
  WITH del AS (DELETE FROM public.episodes WHERE podcast_id = _duplicate_id RETURNING 1)
    SELECT count(*) INTO v_deleted_ep FROM del;
  WITH del AS (DELETE FROM public.podcast_embeddings WHERE podcast_id = _duplicate_id RETURNING 1)
    SELECT count(*) INTO v_deleted_emb FROM del;
  UPDATE public.podcasts
     SET crawl_state = 'merged_duplicate', rss_status = 'inactive',
         next_fetch_at = NULL, next_rss_hunt_at = NULL,
         deep_hydration_status = 'not_started',
         rank_reason = COALESCE(rank_reason,'{}'::jsonb)
                       || jsonb_build_object('merged_into', _canonical_id, 'merged_reason', _reason, 'merged_at', now()),
         updated_at = now()
   WHERE id = _duplicate_id;
  RETURN jsonb_build_object('canonical', _canonical_id, 'duplicate', _duplicate_id,
    'moved_episodes', v_moved, 'deleted_episodes', v_deleted_ep, 'deleted_embeddings', v_deleted_emb);
END $$;

CREATE OR REPLACE FUNCTION public.set_podcast_dedup_schedule(_schedule text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, cron AS $$
DECLARE v_jobid int;
BEGIN
  IF _schedule NOT IN ('0 4 * * 0','0 4 * * *','0 */12 * * *') THEN
    RAISE EXCEPTION 'invalid schedule: %', _schedule;
  END IF;
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='podiverzum-podcast-dedup-weekly';
  IF v_jobid IS NULL THEN RAISE EXCEPTION 'podcast-dedup cron not found'; END IF;
  PERFORM cron.alter_job(job_id := v_jobid, schedule := _schedule);
END $$;
