-- Episode-level search vectors (episode_embeddings) stopped on 2026-05-21 when the old runner was
-- paused and later deleted, while search_episodes_hybrid still reads them. v2 runner restores them
-- for every accepted Hungarian episode with verified clean text, newest first.

CREATE TABLE IF NOT EXISTS public.episode_embedding_skips (
  episode_id uuid PRIMARY KEY,
  reason text NOT NULL,
  attempts integer NOT NULL DEFAULT 1,
  next_attempt_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.episode_embedding_skips TO service_role;
ALTER TABLE public.episode_embedding_skips ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.episode_embedding_skips IS 'embed-episode-runner backoff: unembeddable or failing episodes are not re-claimed before next_attempt_at.';

CREATE OR REPLACE FUNCTION public.select_embed_episode_candidates_v2(_limit integer)
RETURNS TABLE(id uuid, podcast_id uuid, title text, display_title text, seo_description text, ai_summary text,
  topics text[], people text[], companies text[], tickers text[], ingredients text[],
  podcast_title text, podcast_display_title text, podcast_category text, clean_text text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20s'
AS $$
  SELECT e.id, e.podcast_id, e.title, e.display_title, e.seo_description, e.ai_summary,
         e.topics, e.people, e.companies, e.tickers, e.ingredients,
         p.title, p.display_title, p.category, left(ct.cleaned_text, 1600)
    FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    JOIN public.episode_clean_text ct ON ct.episode_id = e.id AND ct.cleaner_method LIKE 'deterministic_v4%'
   WHERE p.language_decision = 'accept_hungarian'
     AND e.clean_text_status = 'done'
     AND length(ct.cleaned_text) >= 80
     AND NOT EXISTS (SELECT 1 FROM public.episode_embeddings x WHERE x.episode_id = e.id)
     AND NOT EXISTS (SELECT 1 FROM public.episode_embedding_skips s WHERE s.episode_id = e.id AND s.next_attempt_at > now())
   ORDER BY e.published_at DESC NULLS LAST
   LIMIT LEAST(GREATEST(COALESCE(_limit, 50), 1), 200)
$$;
REVOKE ALL ON FUNCTION public.select_embed_episode_candidates_v2(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.select_embed_episode_candidates_v2(integer) TO service_role;

-- Coverage of fresh episodes, independent of which runners exist: a stopped or deleted runner
-- shows up here even though no runner reports a failure.
CREATE OR REPLACE FUNCTION public.fresh_episode_coverage_v1(_from_days integer DEFAULT 7, _to_days integer DEFAULT 1)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '20s'
AS $$
  WITH f AS (
    SELECT e.id, e.seo_description, e.ai_entities_version, e.topic_extraction_status
      FROM public.episodes e JOIN public.podcasts p ON p.id = e.podcast_id
     WHERE p.language_decision = 'accept_hungarian' AND e.clean_text_status = 'done'
       AND e.published_at >= now() - make_interval(days => _from_days)
       AND e.published_at < now() - make_interval(days => _to_days)
  )
  SELECT jsonb_build_object(
    'window_days', jsonb_build_array(_to_days, _from_days),
    'clean_episodes', count(*),
    'missing_embedding', count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.episode_embeddings x WHERE x.episode_id = f.id)),
    'missing_seo', count(*) FILTER (WHERE f.seo_description IS NULL),
    'missing_entities', count(*) FILTER (WHERE COALESCE(f.ai_entities_version, 0) < 3),
    'topic_pending', count(*) FILTER (WHERE f.topic_extraction_status IN ('pending', 'error')))
  FROM f
$$;
REVOKE ALL ON FUNCTION public.fresh_episode_coverage_v1(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fresh_episode_coverage_v1(integer, integer) TO service_role;

INSERT INTO public.internal_job_tokens (job) VALUES ('embed-episode-runner') ON CONFLICT (job) DO NOTHING;

SELECT cron.schedule('embed-episode-runner-hourly', '23 * * * *', $cmd$SELECT net.http_post(
  url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/embed-episode-runner',
  headers := jsonb_build_object('Content-Type','application/json','x-internal-token',(SELECT token FROM public.internal_job_tokens WHERE job = 'embed-episode-runner')),
  body := '{"trigger":"cron"}'::jsonb,
  timeout_milliseconds := 150000
);$cmd$);