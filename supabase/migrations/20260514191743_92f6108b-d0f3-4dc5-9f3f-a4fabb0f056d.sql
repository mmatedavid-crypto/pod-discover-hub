ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS taxonomy_keys text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS categories_taxonomy_keys_gin ON public.categories USING gin (taxonomy_keys);