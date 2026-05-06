ALTER TABLE public.page_events
  ADD COLUMN utm_source text,
  ADD COLUMN utm_medium text,
  ADD COLUMN utm_campaign text,
  ADD COLUMN utm_term text,
  ADD COLUMN utm_content text;

CREATE INDEX idx_page_events_utm_source ON public.page_events(utm_source) WHERE utm_source IS NOT NULL;
CREATE INDEX idx_page_events_utm_campaign ON public.page_events(utm_campaign) WHERE utm_campaign IS NOT NULL;