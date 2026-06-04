
CREATE POLICY "Admins can read email_send_log"
ON public.email_send_log FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can read email_send_state"
ON public.email_send_state FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can read entity_extraction_runs"
ON public.entity_extraction_runs FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can read podcast_language_review_queue"
ON public.podcast_language_review_queue FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));
