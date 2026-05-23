
CREATE OR REPLACE FUNCTION public.refresh_user_taste_vec(p_user uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pos vector(768);
  v_neg vector(768);
  v_has_pos boolean := false;
  v_has_neg boolean := false;
BEGIN
  -- Positive: like / play_complete / play_30s within last 90 days, weighted average.
  WITH pos AS (
    SELECT ee.embedding, GREATEST(uei.weight, 0)::real AS w
    FROM public.user_episode_interactions uei
    JOIN public.episode_embeddings ee ON ee.episode_id = uei.episode_id
    WHERE uei.user_id = p_user
      AND uei.kind IN ('like','play_complete','play_30s','play_start')
      AND uei.weight > 0
      AND uei.created_at > now() - interval '90 days'
    ORDER BY uei.created_at DESC
    LIMIT 80
  ),
  agg AS (
    SELECT AVG(embedding)::vector(768) AS v, COUNT(*) AS n FROM pos
  )
  SELECT v, n > 0 INTO v_pos, v_has_pos FROM agg;

  -- Negative: dislike / skip / dismiss
  WITH neg AS (
    SELECT ee.embedding
    FROM public.user_episode_interactions uei
    JOIN public.episode_embeddings ee ON ee.episode_id = uei.episode_id
    WHERE uei.user_id = p_user
      AND uei.kind IN ('dislike','skip','dismiss')
      AND uei.created_at > now() - interval '90 days'
    ORDER BY uei.created_at DESC
    LIMIT 40
  ),
  agg2 AS (
    SELECT AVG(embedding)::vector(768) AS v, COUNT(*) AS n FROM neg
  )
  SELECT v, n > 0 INTO v_neg, v_has_neg FROM agg2;

  IF NOT v_has_pos THEN
    -- Nothing positive yet: clear so fallback path runs.
    UPDATE public.profiles
       SET taste_vec = NULL,
           taste_vec_updated_at = now()
     WHERE user_id = p_user;
    RETURN;
  END IF;

  UPDATE public.profiles
     SET taste_vec = CASE
           WHEN v_has_neg THEN (v_pos - (v_neg * 0.3))
           ELSE v_pos
         END,
         taste_vec_updated_at = now()
   WHERE user_id = p_user;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_user_taste_vec(uuid) TO authenticated, service_role;
