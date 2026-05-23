
-- =========================================================
-- profiles
-- =========================================================
CREATE TABLE public.profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  username TEXT UNIQUE,
  archetype_slug TEXT,
  archetype_result JSONB,
  mood_preferences TEXT[] NOT NULL DEFAULT '{}',
  is_public_profile BOOLEAN NOT NULL DEFAULT false,
  email_notifications_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Profiles viewable by owner or if public"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id OR is_public_profile = true);

CREATE POLICY "Users insert own profile"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users delete own profile"
  ON public.profiles FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX idx_profiles_username ON public.profiles(username) WHERE username IS NOT NULL;
CREATE INDEX idx_profiles_public ON public.profiles(is_public_profile) WHERE is_public_profile = true;

-- =========================================================
-- updated_at trigger (reusable)
-- =========================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- handle_new_user trigger
-- =========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  base_username TEXT;
  candidate TEXT;
  i INT := 0;
BEGIN
  -- derive base from email or full_name
  base_username := lower(regexp_replace(
    COALESCE(
      NEW.raw_user_meta_data->>'preferred_username',
      split_part(NEW.email, '@', 1),
      'user'
    ),
    '[^a-z0-9]+', '-', 'g'
  ));
  base_username := trim(both '-' from base_username);
  IF base_username = '' OR base_username IS NULL THEN
    base_username := 'user';
  END IF;

  candidate := base_username;
  WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = candidate) LOOP
    i := i + 1;
    candidate := base_username || '-' || i::text;
  END LOOP;

  INSERT INTO public.profiles (user_id, display_name, avatar_url, username)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', candidate),
    NEW.raw_user_meta_data->>'avatar_url',
    candidate
  );

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================================
-- user_episode_marks
-- =========================================================
CREATE TABLE public.user_episode_marks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  episode_id UUID NOT NULL,
  mark_type TEXT NOT NULL CHECK (mark_type IN ('favorite','listen_later')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, episode_id, mark_type)
);

ALTER TABLE public.user_episode_marks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "marks select own"
  ON public.user_episode_marks FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "marks insert own"
  ON public.user_episode_marks FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "marks delete own"
  ON public.user_episode_marks FOR DELETE USING (auth.uid() = user_id);

-- Public can see favorites on public profiles (for /p/<username>)
CREATE POLICY "marks select favorites if profile public"
  ON public.user_episode_marks FOR SELECT
  USING (
    mark_type = 'favorite'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = user_episode_marks.user_id AND p.is_public_profile = true
    )
  );

CREATE INDEX idx_marks_user_type ON public.user_episode_marks(user_id, mark_type);
CREATE INDEX idx_marks_episode ON public.user_episode_marks(episode_id);

-- =========================================================
-- user_podcast_follows
-- =========================================================
CREATE TABLE public.user_podcast_follows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  podcast_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_notified_at TIMESTAMPTZ,
  UNIQUE(user_id, podcast_id)
);

ALTER TABLE public.user_podcast_follows ENABLE ROW LEVEL SECURITY;

CREATE POLICY "follows select own"
  ON public.user_podcast_follows FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "follows insert own"
  ON public.user_podcast_follows FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "follows delete own"
  ON public.user_podcast_follows FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_follows_user ON public.user_podcast_follows(user_id);
CREATE INDEX idx_follows_podcast ON public.user_podcast_follows(podcast_id);

-- =========================================================
-- user_listen_history
-- =========================================================
CREATE TABLE public.user_listen_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  episode_id UUID NOT NULL,
  played_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  progress_seconds INT NOT NULL DEFAULT 0
);

ALTER TABLE public.user_listen_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "history select own"
  ON public.user_listen_history FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "history insert own"
  ON public.user_listen_history FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "history update own"
  ON public.user_listen_history FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "history delete own"
  ON public.user_listen_history FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_history_user_played ON public.user_listen_history(user_id, played_at DESC);

-- =========================================================
-- GDPR account deletion
-- =========================================================
CREATE OR REPLACE FUNCTION public.delete_my_account()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid UUID := auth.uid();
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  DELETE FROM public.user_episode_marks WHERE user_id = uid;
  DELETE FROM public.user_podcast_follows WHERE user_id = uid;
  DELETE FROM public.user_listen_history WHERE user_id = uid;
  DELETE FROM public.profiles WHERE user_id = uid;
  DELETE FROM auth.users WHERE id = uid;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_my_account() FROM public;
GRANT EXECUTE ON FUNCTION public.delete_my_account() TO authenticated;
