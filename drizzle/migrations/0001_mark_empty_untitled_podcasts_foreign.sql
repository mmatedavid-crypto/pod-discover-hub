UPDATE public.podcasts p
SET language_decision = 'reject_foreign',
    is_hungarian = false,
    language_rejection_reason = 'empty_untitled_no_episodes',
    language_checked_at = now()
WHERE p.language_decision = 'review_uncertain'
  AND coalesce(p.title, 'Untitled') = 'Untitled'
  AND NOT EXISTS (SELECT 1 FROM public.episodes e WHERE e.podcast_id = p.id);