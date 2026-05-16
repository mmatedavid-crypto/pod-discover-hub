
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
