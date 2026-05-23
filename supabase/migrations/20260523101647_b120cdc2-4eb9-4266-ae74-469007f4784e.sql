
-- 1. Profiles: taste vector columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS taste_vec vector(768),
  ADD COLUMN IF NOT EXISTS taste_vec_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS taste_signal_count integer NOT NULL DEFAULT 0;

-- 2. Interactions table
CREATE TABLE IF NOT EXISTS public.user_episode_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('like','dislike','play_start','play_30s','play_complete','skip','dismiss')),
  weight real NOT NULL,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, episode_id, kind)
);

CREATE INDEX IF NOT EXISTS uei_user_created_idx
  ON public.user_episode_interactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS uei_episode_idx
  ON public.user_episode_interactions (episode_id);

ALTER TABLE public.user_episode_interactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own interactions" ON public.user_episode_interactions;
CREATE POLICY "Users read own interactions"
  ON public.user_episode_interactions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own interactions" ON public.user_episode_interactions;
CREATE POLICY "Users insert own interactions"
  ON public.user_episode_interactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users delete own interactions" ON public.user_episode_interactions;
CREATE POLICY "Users delete own interactions"
  ON public.user_episode_interactions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- 3. Weighted record RPC
CREATE OR REPLACE FUNCTION public.record_episode_interaction(
  p_episode_id uuid,
  p_kind text,
  p_source text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_weight real;
BEGIN
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  v_weight := CASE p_kind
    WHEN 'like' THEN 1.0
    WHEN 'play_complete' THEN 0.8
    WHEN 'play_30s' THEN 0.4
    WHEN 'play_start' THEN 0.1
    WHEN 'skip' THEN -0.2
    WHEN 'dismiss' THEN -0.3
    WHEN 'dislike' THEN -1.0
    ELSE NULL
  END;

  IF v_weight IS NULL THEN
    RAISE EXCEPTION 'unknown kind: %', p_kind;
  END IF;

  INSERT INTO public.user_episode_interactions (user_id, episode_id, kind, weight, source)
  VALUES (v_user, p_episode_id, p_kind, v_weight, p_source)
  ON CONFLICT (user_id, episode_id, kind) DO NOTHING;

  UPDATE public.profiles
     SET taste_signal_count = COALESCE(taste_signal_count, 0) + 1
   WHERE user_id = v_user;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_episode_interaction(uuid, text, text) TO authenticated;

-- 4. Match function — taste_vec ↔ episode_embeddings, HU + tier S/A/B, freshness 90d, dedupe podcast
CREATE OR REPLACE FUNCTION public.match_user_episodes(
  p_user uuid,
  p_limit int DEFAULT 24,
  p_freshness_days int DEFAULT 90
) RETURNS TABLE (
  episode_id uuid,
  podcast_id uuid,
  similarity real
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT taste_vec FROM public.profiles WHERE user_id = p_user
  ),
  seen AS (
    SELECT episode_id FROM public.user_episode_interactions
     WHERE user_id = p_user
       AND created_at > now() - interval '60 days'
  ),
  scored AS (
    SELECT
      ee.episode_id,
      ee.podcast_id,
      (1 - (ee.embedding <=> (SELECT taste_vec FROM me)))::real AS sim,
      ROW_NUMBER() OVER (
        PARTITION BY ee.podcast_id
        ORDER BY ee.embedding <=> (SELECT taste_vec FROM me)
      ) AS rn_pod
    FROM public.episode_embeddings ee
    JOIN public.podcasts p ON p.id = ee.podcast_id
    JOIN public.episodes e ON e.id = ee.episode_id
    WHERE p.language ILIKE 'hu%'
      AND COALESCE(p.rank_label, 'E') IN ('S','A','B')
      AND e.published_at IS NOT NULL
      AND e.published_at > now() - (p_freshness_days || ' days')::interval
      AND ee.episode_id NOT IN (SELECT episode_id FROM seen)
      AND (SELECT taste_vec FROM me) IS NOT NULL
  )
  SELECT episode_id, podcast_id, sim
  FROM scored
  WHERE rn_pod <= 2
  ORDER BY sim DESC
  LIMIT p_limit;
$$;

GRANT EXECUTE ON FUNCTION public.match_user_episodes(uuid, int, int) TO authenticated, service_role;
