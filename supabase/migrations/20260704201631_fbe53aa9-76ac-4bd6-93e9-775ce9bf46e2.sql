
UPDATE public.podcasts
SET language_decision = 'review_uncertain',
    is_hungarian = false,
    language_rejection_reason = COALESCE(language_rejection_reason, 'rss_language_foreign_post_ingest'),
    language_checked_at = now()
WHERE language_decision = 'accept_hungarian'
  AND language IS NOT NULL
  AND lower(language) NOT LIKE 'hu%'
  AND lower(language) NOT LIKE 'mag%'
  AND lower(language) <> 'zz_merged';

INSERT INTO public.podcast_language_review_queue (podcast_id, title, rss_url, website_url, detected_language, hungarian_score, foreign_score, reason, evidence, status)
SELECT id, title, rss_url, website_url, COALESCE(language, detected_language), 0, 0.9, 'rss_language_foreign_post_ingest',
       jsonb_build_object('rss_language', language, 'previous_decision', 'accept_hungarian'), 'pending'
FROM public.podcasts
WHERE language_decision = 'review_uncertain'
  AND language_rejection_reason = 'rss_language_foreign_post_ingest'
ON CONFLICT (podcast_id) DO NOTHING;
