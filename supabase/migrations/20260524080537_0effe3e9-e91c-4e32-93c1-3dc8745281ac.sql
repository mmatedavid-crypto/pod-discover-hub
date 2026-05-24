
CREATE TABLE public.editorial_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  week_start DATE NOT NULL,
  week_end DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'published', 'archived')),
  title TEXT,
  intro TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  ig_caption TEXT,
  fb_caption TEXT,
  cover_image_url TEXT,
  card_image_urls JSONB DEFAULT '[]'::jsonb,
  ai_model TEXT,
  generation_meta JSONB DEFAULT '{}'::jsonb,
  trigger TEXT DEFAULT 'cron',
  created_by UUID,
  approved_by UUID,
  approved_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_editorial_posts_status_created ON public.editorial_posts (status, created_at DESC);
CREATE INDEX idx_editorial_posts_week ON public.editorial_posts (week_start DESC);

ALTER TABLE public.editorial_posts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view editorial posts"
  ON public.editorial_posts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can insert editorial posts"
  ON public.editorial_posts FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can update editorial posts"
  ON public.editorial_posts FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins can delete editorial posts"
  ON public.editorial_posts FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.editorial_posts_touch_updated()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path=public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE TRIGGER trg_editorial_posts_updated
  BEFORE UPDATE ON public.editorial_posts
  FOR EACH ROW EXECUTE FUNCTION public.editorial_posts_touch_updated();
