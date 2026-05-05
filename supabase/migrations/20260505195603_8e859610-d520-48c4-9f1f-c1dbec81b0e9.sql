
-- Add RSS status fields to podcasts
ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS rss_status text NOT NULL DEFAULT 'not_checked',
  ADD COLUMN IF NOT EXISTS last_fetched_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_fetch_error text,
  ADD COLUMN IF NOT EXISTS is_sample boolean NOT NULL DEFAULT false;

-- Reorder categories and add new ones
UPDATE public.categories SET sort_order = sort_order + 100;

INSERT INTO public.categories (name, slug, description, sort_order) VALUES
  ('Trending', 'trending', 'The most listened, freshest, and featured podcasts right now.', 1),
  ('News & Current Events', 'news', 'Daily news, analysis, and current affairs.', 2)
ON CONFLICT DO NOTHING;

UPDATE public.categories SET sort_order = 3  WHERE slug = 'business';
UPDATE public.categories SET sort_order = 4  WHERE slug = 'investing';
UPDATE public.categories SET sort_order = 5  WHERE slug = 'politics';
UPDATE public.categories SET sort_order = 6  WHERE slug = 'technology';
UPDATE public.categories SET sort_order = 7  WHERE slug = 'health';
UPDATE public.categories SET sort_order = 8  WHERE slug = 'science';
UPDATE public.categories SET sort_order = 9  WHERE slug = 'food';
UPDATE public.categories SET sort_order = 10 WHERE slug = 'culture';
UPDATE public.categories SET sort_order = 11 WHERE slug = 'sports';
UPDATE public.categories SET sort_order = 12 WHERE slug = 'true-crime';
UPDATE public.categories SET sort_order = 13 WHERE slug = 'travel';

-- Rename Self-Improvement -> Relationships & Self-Improvement
UPDATE public.categories
  SET name = 'Relationships & Self-Improvement', sort_order = 14
  WHERE slug = 'self-improvement';

UPDATE public.podcasts
  SET category = 'Relationships & Self-Improvement'
  WHERE category IN ('Self-Improvement');
