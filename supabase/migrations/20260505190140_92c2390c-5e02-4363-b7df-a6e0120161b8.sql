
-- Roles
CREATE TYPE public.app_role AS ENUM ('admin', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "users see own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "admins manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Categories
CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "categories public read" ON public.categories FOR SELECT USING (true);
CREATE POLICY "categories admin write" ON public.categories FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Podcasts
CREATE TABLE public.podcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  summary TEXT,
  rss_url TEXT,
  apple_url TEXT,
  spotify_url TEXT,
  youtube_url TEXT,
  website_url TEXT,
  image_url TEXT,
  category TEXT,
  language TEXT DEFAULT 'en',
  country TEXT,
  source TEXT,
  featured BOOLEAN NOT NULL DEFAULT false,
  featured_rank INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.podcasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "podcasts public read" ON public.podcasts FOR SELECT USING (true);
CREATE POLICY "podcasts admin write" ON public.podcasts FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX podcasts_category_idx ON public.podcasts(category);
CREATE INDEX podcasts_featured_idx ON public.podcasts(category, featured, featured_rank);

-- Episodes
CREATE TABLE public.episodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  podcast_id UUID NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  summary TEXT,
  published_at TIMESTAMPTZ,
  audio_url TEXT,
  episode_url TEXT,
  apple_url TEXT,
  spotify_url TEXT,
  youtube_url TEXT,
  image_url TEXT,
  topics TEXT[] DEFAULT '{}',
  people TEXT[] DEFAULT '{}',
  companies TEXT[] DEFAULT '{}',
  tickers TEXT[] DEFAULT '{}',
  ingredients TEXT[] DEFAULT '{}',
  guid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(podcast_id, slug)
);
ALTER TABLE public.episodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "episodes public read" ON public.episodes FOR SELECT USING (true);
CREATE POLICY "episodes admin write" ON public.episodes FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE INDEX episodes_podcast_idx ON public.episodes(podcast_id, published_at DESC);
CREATE INDEX episodes_published_idx ON public.episodes(published_at DESC);

-- Search synonyms
CREATE TABLE public.search_synonyms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  term TEXT NOT NULL UNIQUE,
  synonyms TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.search_synonyms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "synonyms public read" ON public.search_synonyms FOR SELECT USING (true);
CREATE POLICY "synonyms admin write" ON public.search_synonyms FOR ALL USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER podcasts_touch BEFORE UPDATE ON public.podcasts FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER episodes_touch BEFORE UPDATE ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed categories
INSERT INTO public.categories (name, slug, description, sort_order) VALUES
('Business & Entrepreneurship','business','Founders, operators, and the business of building.',1),
('Investing & Markets','investing','Stocks, macro, and markets.',2),
('Politics & World Affairs','politics','Geopolitics and current affairs.',3),
('Technology & AI','technology','Software, hardware, and AI.',4),
('Health, Fitness & Longevity','health','Training, nutrition, and longevity.',5),
('Science & Ideas','science','Big ideas across the sciences.',6),
('Food & Cooking','food','Recipes, chefs, and food culture.',7),
('Culture, Film & Entertainment','culture','Film, TV, music, and culture.',8),
('Sports','sports','News, analysis, and athlete interviews.',9),
('True Crime & Mystery','true-crime','Investigations and unsolved mysteries.',10),
('Travel & Lifestyle','travel','Travel, cities, and the good life.',11),
('Relationships & Self-Improvement','self-improvement','Habits, psychology, and growth.',12);
