
ALTER TABLE public.podcasts_backup_pre_c_v3 ENABLE ROW LEVEL SECURITY;
CREATE POLICY "backup admin read" ON public.podcasts_backup_pre_c_v3
  FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "backup admin write" ON public.podcasts_backup_pre_c_v3
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (has_role(auth.uid(), 'admin'::app_role));
