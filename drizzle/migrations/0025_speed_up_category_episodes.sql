CREATE INDEX IF NOT EXISTS idx_episode_cards_published_at_desc
  ON public.episode_cards (published_at DESC NULLS LAST);

CREATE OR REPLACE FUNCTION public.category_episodes(_slug text, _limit integer DEFAULT 120)
 RETURNS TABLE(id uuid, title text, display_title text, slug text, image_url text, published_at timestamp with time zone, ai_summary text, audio_url text, people text[], mentioned text[], topics text[], companies text[], tickers text[], podcast_id uuid, podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text, podcast_category text, podcast_rank numeric, podcast_rank_label text, podcast_rss_status text, podcast_featured boolean, source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '12s'
AS $function$
  -- Walk newest cards first and stop as soon as the limit is filled. The old
  -- version materialised every classified episode of the category before
  -- sorting, which hit the statement timeout on large categories.
  SELECT e.episode_id, e.title, e.display_title, e.slug, e.image_url, e.published_at,
         e.card_summary, e.audio_url, e.people, e.mentioned, e.topics, e.companies, e.tickers,
         e.podcast_id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured, 'classification'
  FROM episode_cards e
  JOIN podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
  WHERE EXISTS (
    SELECT 1 FROM episode_ai_classifications c
    WHERE c.episode_id = e.episode_id
      AND c.classification_status = 'classified'
      AND (c.primary_category = _slug OR c.secondary_categories @> to_jsonb(array[_slug]))
  )
  ORDER BY e.published_at DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(_limit, 120), 300));
$function$;