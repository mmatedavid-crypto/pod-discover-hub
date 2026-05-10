
-- 1. Trigger function: compute search_text + search_tsv on insert/update
CREATE OR REPLACE FUNCTION public.episodes_search_text_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pod_title text;
  v_pod_cat text;
  v_text text;
BEGIN
  SELECT coalesce(p.display_title, p.title, ''), coalesce(p.category, '')
    INTO v_pod_title, v_pod_cat
  FROM public.podcasts p WHERE p.id = NEW.podcast_id;

  v_text := lower(unaccent(
    coalesce(NEW.display_title, NEW.title, '') || ' ' ||
    coalesce(NEW.ai_summary, '') || ' ' ||
    coalesce(NEW.summary, '') || ' ' ||
    coalesce(array_to_string(NEW.topics, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.people, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.companies, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.ingredients, ' '), '') || ' ' ||
    coalesce(array_to_string(NEW.tickers, ' '), '') || ' ' ||
    coalesce(v_pod_title, '') || ' ' ||
    coalesce(v_pod_cat, '')
  ));

  NEW.search_text := v_text;
  NEW.search_tsv := to_tsvector('simple', v_text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_episodes_search_text ON public.episodes;
CREATE TRIGGER trg_episodes_search_text
BEFORE INSERT OR UPDATE OF title, display_title, ai_summary, summary, topics, people, companies, ingredients, tickers, podcast_id
ON public.episodes
FOR EACH ROW
EXECUTE FUNCTION public.episodes_search_text_trigger();

-- 2. Hourly safety cron (idempotent — only does work if rows are missing)
SELECT cron.schedule(
  'podiverzum-search-text-safety-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/search-text-backfill',
    headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlxemtheW9xcWFnb3d2eGVhcGhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMDA3NzAsImV4cCI6MjA5MzU3Njc3MH0.KaeRcYcljGjrP_OAcTp_lapPSRsAYRq6gPJ2vYV7fz4"}'::jsonb,
    body := '{"trigger":"safety_hourly"}'::jsonb
  );
  $$
);

-- 3. Reset cursor so the safety cron will pick up any future stragglers from the start
UPDATE public.app_settings
SET value = jsonb_build_object('created_at', (now() - interval '1 hour')::text),
    updated_at = now()
WHERE key = 'search_text_backfill_cursor';
