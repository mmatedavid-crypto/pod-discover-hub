CREATE OR REPLACE FUNCTION public.similar_episodes(p_episode_id uuid, p_limit int DEFAULT 6)
RETURNS TABLE (
  episode_id uuid, podcast_id uuid, similarity float,
  title text, display_title text, slug text,
  ai_summary text, summary text, description text,
  published_at timestamptz, audio_url text, topics text[],
  podcast_slug text, podcast_title text, podcast_display_title text,
  podcast_image_url text, podcast_category text,
  podiverzum_rank numeric, rank_label text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  src_embedding vector(768);
  src_podcast_id uuid;
BEGIN
  SELECT embedding, ee.podcast_id INTO src_embedding, src_podcast_id
  FROM episode_embeddings ee WHERE ee.episode_id = p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT e.id, e.podcast_id, (1 - (ee.embedding <=> src_embedding))::float,
    e.title, e.display_title, e.slug,
    e.ai_summary, e.summary, e.description,
    e.published_at, e.audio_url, e.topics,
    p.slug, p.title, p.display_title,
    p.image_url, p.category, p.podiverzum_rank, p.rank_label
  FROM episode_embeddings ee
  JOIN episodes e ON e.id = ee.episode_id
  JOIN podcasts p ON p.id = ee.podcast_id
  WHERE ee.episode_id <> p_episode_id
    AND ee.podcast_id <> COALESCE(src_podcast_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND p.rss_status NOT IN ('failed','inactive')
    AND COALESCE(p.rank_label,'E') NOT IN ('D','E')
  ORDER BY ee.embedding <=> src_embedding
  LIMIT GREATEST(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.similar_episodes(uuid, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.similar_podcasts(p_podcast_id uuid, p_limit int DEFAULT 6)
RETURNS TABLE (
  id uuid, similarity float,
  title text, display_title text, slug text,
  summary text, description text, image_url text, category text,
  apple_url text, spotify_url text, youtube_url text, website_url text,
  featured boolean, rss_status text,
  podiverzum_rank numeric, rank_label text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE src_embedding vector(768);
BEGIN
  SELECT embedding INTO src_embedding
  FROM podcast_embeddings WHERE podcast_id = p_podcast_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;
  RETURN QUERY
  SELECT p.id, (1 - (pe.embedding <=> src_embedding))::float,
    p.title, p.display_title, p.slug,
    p.summary, p.description, p.image_url, p.category,
    p.apple_url, p.spotify_url, p.youtube_url, p.website_url,
    p.featured, p.rss_status, p.podiverzum_rank, p.rank_label
  FROM podcast_embeddings pe
  JOIN podcasts p ON p.id = pe.podcast_id
  WHERE pe.podcast_id <> p_podcast_id
    AND p.rss_status NOT IN ('failed','inactive')
    AND COALESCE(p.rank_label,'E') IN ('S','A','B')
  ORDER BY pe.embedding <=> src_embedding
  LIMIT GREATEST(p_limit, 1);
END;
$$;

GRANT EXECUTE ON FUNCTION public.similar_podcasts(uuid, int) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.mood_collections_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TABLE IF NOT EXISTS public.mood_collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  mood text NOT NULL,
  description text,
  accent_hsl text,
  podcast_ids uuid[] NOT NULL DEFAULT '{}',
  episode_ids uuid[] NOT NULL DEFAULT '{}',
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mood_collections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "mood_collections public read"
  ON public.mood_collections FOR SELECT USING (true);

CREATE POLICY "mood_collections admin write"
  ON public.mood_collections FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP TRIGGER IF EXISTS mood_collections_touch_updated_at ON public.mood_collections;
CREATE TRIGGER mood_collections_touch_updated_at
  BEFORE UPDATE ON public.mood_collections
  FOR EACH ROW EXECUTE FUNCTION public.mood_collections_touch_updated_at();

INSERT INTO public.mood_collections (slug, title, mood, description, accent_hsl, sort_order) VALUES
  ('morning-inspiration', 'Morning inspiration', 'Start your day sharp', 'Energising listens for your first coffee.', '38 92% 50%', 10),
  ('deep-focus',          'Deep focus',          'Work mode, on',         'Long-form ideas and conversations to think with.', '210 90% 56%', 20),
  ('wind-down',           'Wind-down listening', 'Evening calm',          'Slower-paced episodes for the end of the day.', '262 70% 60%', 30),
  ('learn-something-new', 'Learn something new', 'Curious mind',          'Bite-sized expertise across science, business and culture.', '142 70% 45%', 40),
  ('news-now',            'News now',            'What just happened',    'Today''s most relevant news episodes, freshness-ranked.', '0 70% 55%', 50)
ON CONFLICT (slug) DO NOTHING;