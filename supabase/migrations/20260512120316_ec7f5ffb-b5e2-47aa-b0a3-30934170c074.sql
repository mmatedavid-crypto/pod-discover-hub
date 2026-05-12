
-- Fázis 1: Teljes podcast/episode adat wipe HU újraindításhoz
-- Megmarad: app_settings, categories, search_synonyms, user_roles, email_*, suppressed_emails

BEGIN;

-- Episode/podcast tartalom és származtatott adatok
TRUNCATE TABLE
  public.episode_embeddings,
  public.podcast_embeddings,
  public.episodes,
  public.rss_url_history,
  public.discovery_queue,
  public.pi_feed_staging,
  public.pi_dump_imports,
  public.ai_enrichment_jobs,
  public.podcasts
RESTART IDENTITY CASCADE;

-- Cache + analitika reset
TRUNCATE TABLE
  public.search_query_cache,
  public.search_suggest_cache,
  public.search_events,
  public.page_events,
  public.beta_feedback,
  public.email_send_log,
  public.social_posts,
  public.growth_runs,
  public.mood_collections,
  public.ai_spend_daily
RESTART IDENTITY CASCADE;

-- Régi backup tábla törlése (Formula C v3 előtti, már nem releváns)
DROP TABLE IF EXISTS public.podcasts_backup_pre_c_v3;

-- Default nyelv váltás EN → HU az új podcastokhoz
ALTER TABLE public.podcasts ALTER COLUMN language SET DEFAULT 'hu';

-- Üres MV-k frissítése (különben a régi cache marad)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname='public' AND matviewname='mv_homepage_feed') THEN
    REFRESH MATERIALIZED VIEW public.mv_homepage_feed;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname='public' AND matviewname='mv_homepage_evergreen') THEN
    REFRESH MATERIALIZED VIEW public.mv_homepage_evergreen;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname='public' AND matviewname='embed_episode_eligible_cache') THEN
    REFRESH MATERIALIZED VIEW public.embed_episode_eligible_cache;
  END IF;
END $$;

COMMIT;
