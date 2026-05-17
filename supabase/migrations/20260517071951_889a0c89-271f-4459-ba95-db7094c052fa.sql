-- 1. episode_chunks
CREATE TABLE IF NOT EXISTS public.episode_chunks (
  episode_id   uuid NOT NULL,
  chunk_idx    int  NOT NULL,
  chunk_count  int  NOT NULL,
  podcast_id   uuid NOT NULL,
  content      text NOT NULL,
  content_hash text NOT NULL,
  char_start   int  NOT NULL DEFAULT 0,
  char_end     int  NOT NULL DEFAULT 0,
  model        text NOT NULL,
  embedding    vector(768) NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, chunk_idx)
);
CREATE INDEX IF NOT EXISTS episode_chunks_podcast_idx ON public.episode_chunks (podcast_id);
CREATE INDEX IF NOT EXISTS episode_chunks_model_idx ON public.episode_chunks (model);
CREATE INDEX IF NOT EXISTS episode_chunks_embedding_hnsw ON public.episode_chunks USING hnsw (embedding vector_cosine_ops);
ALTER TABLE public.episode_chunks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ep_chunks public read" ON public.episode_chunks;
CREATE POLICY "ep_chunks public read" ON public.episode_chunks FOR SELECT USING (true);
DROP POLICY IF EXISTS "ep_chunks admin write" ON public.episode_chunks;
CREATE POLICY "ep_chunks admin write" ON public.episode_chunks FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 2. episode_clean_text
CREATE TABLE IF NOT EXISTS public.episode_clean_text (
  episode_id         uuid PRIMARY KEY,
  source_hash        text NOT NULL,
  cleaned_text       text NOT NULL,
  removed_categories text[] NOT NULL DEFAULT '{}',
  cleaner_method     text NOT NULL,
  model              text,
  cost_usd           numeric,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS episode_clean_text_source_hash_idx ON public.episode_clean_text (source_hash);
ALTER TABLE public.episode_clean_text ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "ep_clean public read" ON public.episode_clean_text;
CREATE POLICY "ep_clean public read" ON public.episode_clean_text FOR SELECT USING (true);
DROP POLICY IF EXISTS "ep_clean admin write" ON public.episode_clean_text;
CREATE POLICY "ep_clean admin write" ON public.episode_clean_text FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 3. podcast_boilerplate_blocks
CREATE TABLE IF NOT EXISTS public.podcast_boilerplate_blocks (
  podcast_id  uuid NOT NULL,
  block_hash  text NOT NULL,
  block_text  text NOT NULL,
  hit_count   int  NOT NULL DEFAULT 0,
  detected_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (podcast_id, block_hash)
);
ALTER TABLE public.podcast_boilerplate_blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pbb public read" ON public.podcast_boilerplate_blocks;
CREATE POLICY "pbb public read" ON public.podcast_boilerplate_blocks FOR SELECT USING (true);
DROP POLICY IF EXISTS "pbb admin write" ON public.podcast_boilerplate_blocks;
CREATE POLICY "pbb admin write" ON public.podcast_boilerplate_blocks FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- 4. RPC: select_embed_chunks_candidates
CREATE OR REPLACE FUNCTION public.select_embed_chunks_candidates(_model text, _limit int)
RETURNS TABLE (
  id uuid, podcast_id uuid, title text, display_title text,
  ai_summary text, description text,
  topics text[], people text[], companies text[], tickers text[], ingredients text[],
  podcast_title text, podcast_display_title text, podcast_language text, podcast_tier text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.id, e.podcast_id, e.title, e.display_title,
    e.ai_summary, e.description, e.topics, e.people, e.companies, e.tickers, e.ingredients,
    p.title, p.display_title, p.language, p.shadow_rank_tier
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  WHERE p.language ILIKE 'hu%'
    AND p.shadow_rank_tier IN ('S','A','B','C')
    AND NOT EXISTS (
      SELECT 1 FROM public.episode_chunks c
      WHERE c.episode_id = e.id AND c.model = _model
    )
  ORDER BY
    CASE p.shadow_rank_tier WHEN 'S' THEN 0 WHEN 'A' THEN 1 WHEN 'B' THEN 2 ELSE 3 END,
    e.published_at DESC NULLS LAST
  LIMIT _limit;
$$;

-- 5. RPC: embed_chunks_candidate_stats
CREATE OR REPLACE FUNCTION public.embed_chunks_candidate_stats(_model text)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH eligible AS (
    SELECT e.id FROM public.episodes e
    JOIN public.podcasts p ON p.id = e.podcast_id
    WHERE p.language ILIKE 'hu%' AND p.shadow_rank_tier IN ('S','A','B','C')
  ),
  done AS (SELECT DISTINCT episode_id FROM public.episode_chunks WHERE model = _model)
  SELECT jsonb_build_object(
    'eligible_total', (SELECT count(*) FROM eligible),
    'already_chunked', (SELECT count(*) FROM done WHERE episode_id IN (SELECT id FROM eligible)),
    'missing', (SELECT count(*) FROM eligible WHERE id NOT IN (SELECT episode_id FROM done)),
    'total_chunks', (SELECT count(*) FROM public.episode_chunks WHERE model = _model)
  );
$$;

-- 6. RPC: set_embed_episode_chunks_schedule
CREATE OR REPLACE FUNCTION public.set_embed_episode_chunks_schedule(_schedule text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions AS $$
DECLARE
  allowed text[] := ARRAY['*', '*/2', '*/5', '*/10', '*/15', '*/30', '0 * * * *'];
  cron_expr text;
  job_record record;
  updated_count int := 0;
BEGIN
  IF _schedule = '0 * * * *' THEN cron_expr := '0 * * * *';
  ELSE cron_expr := _schedule || ' * * * *'; END IF;

  IF NOT (_schedule = ANY(allowed) OR cron_expr = ANY(allowed)) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'schedule_not_allowed', 'requested', _schedule);
  END IF;

  FOR job_record IN
    SELECT jobid, jobname, schedule FROM cron.job
    WHERE jobname IN ('podiverzum-embed-episode-chunks', 'podiverzum-embed-episode-chunks-runner')
  LOOP
    IF job_record.schedule <> cron_expr THEN
      PERFORM cron.alter_job(job_record.jobid, schedule => cron_expr);
      updated_count := updated_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'schedule', cron_expr, 'updated_jobs', updated_count);
END;
$$;
