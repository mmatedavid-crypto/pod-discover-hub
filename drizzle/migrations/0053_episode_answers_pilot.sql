-- Episode Q&A pilot: grounded "Milyen kérdésekre kapsz választ?" answers.
CREATE TABLE public.episode_answer_pilot (
  episode_id uuid PRIMARY KEY REFERENCES public.episodes(id) ON DELETE CASCADE,
  pilot_group text NOT NULL CHECK (pilot_group IN ('treatment','control')),
  pair_id integer NOT NULL,
  stratum text NOT NULL,
  baseline_chatgpt_sessions integer NOT NULL DEFAULT 0,
  baseline_all_sessions integer NOT NULL DEFAULT 0,
  baseline_window text NOT NULL DEFAULT '2026-09-04..2026-10-01',
  content_version text NOT NULL DEFAULT 'qa-v1',
  frozen_at timestamptz NOT NULL DEFAULT now(),
  generated_at timestamptz,
  generation_status text,
  generation_cost_usd numeric
);
GRANT SELECT ON public.episode_answer_pilot TO anon, authenticated;
GRANT ALL ON public.episode_answer_pilot TO service_role;
ALTER TABLE public.episode_answer_pilot ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pilot groups are public" ON public.episode_answer_pilot FOR SELECT USING (true);

CREATE TABLE public.episode_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  anchor text NOT NULL,
  position integer NOT NULL,
  question text NOT NULL,
  answer text NOT NULL,
  speaker text,
  excerpt text NOT NULL,
  excerpt_block_start integer NOT NULL,
  excerpt_block_end integer NOT NULL,
  start_sec numeric,
  end_sec numeric,
  timestamp_status text NOT NULL CHECK (timestamp_status IN ('audio_verified','youtube_only','none')),
  youtube_video_id text,
  source_type text NOT NULL,
  transcript_id uuid,
  sensitive_domain text,
  content_version text NOT NULL DEFAULT 'qa-v1',
  model text NOT NULL,
  status text NOT NULL CHECK (status IN ('published','rejected')),
  verification jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, content_version, anchor)
);
CREATE INDEX episode_answers_episode_idx ON public.episode_answers(episode_id, content_version, position);
-- Excerpts come from index-only transcripts: no direct public access to the table.
GRANT ALL ON public.episode_answers TO service_role;
ALTER TABLE public.episode_answers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read answers" ON public.episode_answers FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
GRANT SELECT ON public.episode_answers TO authenticated;

INSERT INTO public.app_settings(key, value) VALUES ('episode_answers_pilot', '{"enabled": true, "content_version": "qa-v1", "max_usd_per_run": 4, "max_total_usd": 20}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Public projection: published answers of treatment episodes only, without the excerpt.
-- Kill switch: app_settings.episode_answers_pilot.enabled=false hides everything instantly.
CREATE VIEW public.episode_answers_public AS
SELECT a.id, a.episode_id, a.anchor, a.position, a.question, a.answer, a.speaker,
       a.start_sec, a.end_sec, a.timestamp_status, a.youtube_video_id, a.sensitive_domain,
       a.content_version, p.pilot_group
FROM public.episode_answers a
JOIN public.episode_answer_pilot p ON p.episode_id = a.episode_id AND p.pilot_group = 'treatment'
JOIN public.app_settings s ON s.key = 'episode_answers_pilot'
WHERE a.status = 'published'
  AND a.content_version = coalesce(s.value->>'content_version', 'qa-v1')
  AND coalesce((s.value->>'enabled')::boolean, false);
GRANT SELECT ON public.episode_answers_public TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.topic_episode_answers(_topic_id uuid, _limit int DEFAULT 12)
RETURNS TABLE(answer_id uuid, anchor text, question text, answer text, episode_id uuid, episode_title text, episode_slug text, podcast_title text, podcast_slug text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH eps AS (
    SELECT episode_id FROM episode_topic_map WHERE topic_id = _topic_id
    UNION SELECT episode_id FROM episode_topic_relevance_reviews WHERE topic_id = _topic_id AND status = 'accepted'
    EXCEPT SELECT episode_id FROM episode_topic_relevance_reviews WHERE topic_id = _topic_id AND status = 'rejected'
  ), ranked AS (
    SELECT a.*, row_number() OVER (PARTITION BY a.episode_id ORDER BY a.position) rn
    FROM episode_answers_public a JOIN eps USING (episode_id)
  )
  SELECT r.id, r.anchor, r.question, r.answer, e.id, coalesce(e.display_title, e.title), e.slug,
         coalesce(p.display_title, p.title), p.slug
  FROM ranked r JOIN episodes e ON e.id = r.episode_id JOIN podcasts p ON p.id = e.podcast_id
  WHERE r.rn = 1 AND p.language_decision = 'accept_hungarian'
  ORDER BY e.published_at DESC NULLS LAST
  LIMIT greatest(1, least(_limit, 30));
$$;
GRANT EXECUTE ON FUNCTION public.topic_episode_answers(uuid, int) TO anon, authenticated;