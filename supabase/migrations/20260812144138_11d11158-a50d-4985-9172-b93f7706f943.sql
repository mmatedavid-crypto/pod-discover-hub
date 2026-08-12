UPDATE public.ai_enrichment_jobs
SET status='pending', locked_until=NULL, last_error=NULL, attempts=0
WHERE status='failed'
  AND kind IN ('seo_episode','seo_podcast')
  AND last_error IN ('rate_limited','budget_exhausted_provider','ai_err','ai_503','no_tool_call');