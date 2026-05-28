
-- 1) Playback progress (synced across devices for logged-in users)
CREATE TABLE IF NOT EXISTS public.playback_progress (
  user_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  position_seconds integer NOT NULL DEFAULT 0,
  duration_seconds integer,
  completed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, episode_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.playback_progress TO authenticated;
GRANT ALL ON public.playback_progress TO service_role;

ALTER TABLE public.playback_progress ENABLE ROW LEVEL SECURITY;

CREATE POLICY "progress select own" ON public.playback_progress
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "progress insert own" ON public.playback_progress
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "progress update own" ON public.playback_progress
  FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "progress delete own" ON public.playback_progress
  FOR DELETE TO authenticated USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS playback_progress_user_updated_idx
  ON public.playback_progress (user_id, updated_at DESC);

-- 2) Episode chapters (AI-generated from episode_chunks)
CREATE TABLE IF NOT EXISTS public.episode_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL,
  idx integer NOT NULL,
  start_sec integer NOT NULL,
  title text NOT NULL,
  summary text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (episode_id, idx)
);

GRANT SELECT ON public.episode_chapters TO anon, authenticated;
GRANT ALL ON public.episode_chapters TO service_role;

ALTER TABLE public.episode_chapters ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chapters public read" ON public.episode_chapters
  FOR SELECT USING (true);
CREATE POLICY "chapters admin write" ON public.episode_chapters
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS episode_chapters_episode_idx
  ON public.episode_chapters (episode_id, idx);

-- 3) RPC: recommendations from recent listen history (Netflix-style "because you listened")
CREATE OR REPLACE FUNCTION public.match_episodes_by_user_history(
  p_user_id uuid,
  p_limit integer DEFAULT 12
)
RETURNS TABLE(
  episode_id uuid,
  podcast_id uuid,
  title text,
  display_title text,
  slug text,
  image_url text,
  ai_summary text,
  podcast_title text,
  podcast_slug text,
  podcast_image_url text,
  similarity double precision
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
declare
  v_liked uuid[];
begin
  if p_user_id is null then return; end if;

  -- Last 20 distinct episodes from listen history
  select array_agg(episode_id)
    into v_liked
  from (
    select episode_id
    from public.user_listen_history
    where user_id = p_user_id
    order by played_at desc
    limit 20
  ) s;

  if v_liked is null or array_length(v_liked, 1) is null then
    return;
  end if;

  return query
  select * from public.match_episodes_by_centroid(v_liked, '{}'::uuid[], p_limit);
end;
$$;

GRANT EXECUTE ON FUNCTION public.match_episodes_by_user_history(uuid, integer) TO authenticated, service_role;
