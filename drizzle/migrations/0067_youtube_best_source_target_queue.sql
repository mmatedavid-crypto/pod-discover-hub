-- Index-friendly staged queue of the verified-YouTube backfill target set
-- (computing it live costs ~3.5 s of description reads per call).
CREATE TABLE IF NOT EXISTS public.episode_best_source_youtube_queue (
  episode_id uuid PRIMARY KEY,
  link_id uuid,
  yt_len integer,
  rss_len integer,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.episode_best_source_youtube_queue TO service_role;
GRANT SELECT ON public.episode_best_source_youtube_queue TO authenticated;
ALTER TABLE public.episode_best_source_youtube_queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "youtube best source queue admin read" ON public.episode_best_source_youtube_queue
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::public.app_role));

INSERT INTO public.episode_best_source_youtube_queue (episode_id, link_id, yt_len, rss_len)
SELECT DISTINCT ON (l.episode_id) l.episode_id, l.id, length(coalesce(l.youtube_description, '')), length(coalesce(e.description, ''))
FROM public.episode_youtube_links l
JOIN public.episodes e ON e.id = l.episode_id
JOIN public.podcasts p ON p.id = e.podcast_id
WHERE l.status = 'confirmed'
  AND l.validation_reason->>'policy' = 'youtube_episode_match_v3'
  AND l.match_score >= 0.78
  AND p.language_decision = 'accept_hungarian'
  AND length(coalesce(l.youtube_description, '')) >= length(coalesce(e.description, '')) + 300
ORDER BY l.episode_id, l.match_score DESC
ON CONFLICT (episode_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.best_source_youtube_gain_targets_v1(p_after uuid DEFAULT NULL, p_limit integer DEFAULT 50)
RETURNS TABLE(episode_id uuid)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT q.episode_id
  FROM public.episode_best_source_youtube_queue q
  WHERE p_after IS NULL OR q.episode_id > p_after
  ORDER BY q.episode_id
  LIMIT least(greatest(coalesce(p_limit, 50), 1), 200)
$$;
REVOKE ALL ON FUNCTION public.best_source_youtube_gain_targets_v1(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.best_source_youtube_gain_targets_v1(uuid, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.youtube_source_quality_metrics_v1()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'targets', count(*),
    'best_none', count(*) FILTER (WHERE b.episode_id IS NULL),
    'best_rss', count(*) FILTER (WHERE b.source_type = 'rss'),
    'best_youtube', count(*) FILTER (WHERE b.source_type = 'youtube'),
    'best_other', count(*) FILTER (WHERE b.source_type NOT IN ('rss', 'youtube')),
    'gain_evaluated', count(*) FILTER (WHERE b.evidence ? 'youtube_gain'),
    'gain_youtube_better', count(*) FILTER (WHERE b.evidence->'youtube_gain'->>'decision' = 'youtube_better'),
    'clean_youtube_based', count(*) FILTER (WHERE c.cleaner_method LIKE '%youtube%' OR c.cleaner_method LIKE '%ytdesc%'),
    'clean_youtube_v1', count(*) FILTER (WHERE c.cleaner_method LIKE 'deterministic_v4+youtube%'),
    'reclean_pending', count(*) FILTER (WHERE b.reclean_status = 'pending'),
    'reclean_applied', count(*) FILTER (WHERE b.reclean_status = 'applied'),
    'reclean_rejected', count(*) FILTER (WHERE b.reclean_status = 'rejected_quality'),
    'reclean_conflict', count(*) FILTER (WHERE b.reclean_status = 'conflict'),
    'avg_clean_len', round(avg(length(c.cleaned_text)))
  )
  FROM public.episode_best_source_youtube_queue q
  LEFT JOIN public.episode_best_text_source b ON b.episode_id = q.episode_id
  LEFT JOIN public.episode_clean_text c ON c.episode_id = q.episode_id
$$;
REVOKE ALL ON FUNCTION public.youtube_source_quality_metrics_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.youtube_source_quality_metrics_v1() TO service_role;