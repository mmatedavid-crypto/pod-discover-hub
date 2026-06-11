ALTER TABLE public.daily_trends
  ADD COLUMN IF NOT EXISTS resolved_person_id uuid REFERENCES public.people(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS resolved_kind text;

CREATE INDEX IF NOT EXISTS daily_trends_resolved_person_id_idx ON public.daily_trends(resolved_person_id);
CREATE INDEX IF NOT EXISTS daily_trends_resolved_org_id_idx ON public.daily_trends(resolved_organization_id);