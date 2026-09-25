CREATE TABLE IF NOT EXISTS public.entity_cleanup_backup_20260925 (
  id bigserial PRIMARY KEY,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  row_data jsonb NOT NULL,
  links jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.entity_cleanup_backup_20260925 TO service_role;
GRANT SELECT ON public.entity_cleanup_backup_20260925 TO authenticated;
ALTER TABLE public.entity_cleanup_backup_20260925 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read cleanup backup" ON public.entity_cleanup_backup_20260925 FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));