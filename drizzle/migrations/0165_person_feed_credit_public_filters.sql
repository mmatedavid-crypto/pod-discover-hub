CREATE OR REPLACE VIEW public.person_public_episode_links_v1 AS
WITH base AS (
  SELECT m.person_id, m.episode_id, c.podcast_id, c.published_at,
    m.mention_type, m.role_type, m.relevance_status, m.validation_source, m.final_relevance_score, m.confidence,
    (m.relevance_status = 'accepted' AND btrim(COALESCE(m.validation_source, '')) <> '') AS verified,
    (m.relevance_status = 'accepted'
      OR COALESCE(m.final_relevance_score, 0) >= 0.75
      OR m.validation_source = 'manual'
      OR (COALESCE(m.relevance_status, 'pending') = 'pending'
          AND m.mention_type IN ('host','guest','subject','archival_source','interviewee','speaker')
          AND COALESCE(m.confidence, 0) >= 0.80)) AS strong
  FROM public.person_episode_mentions m
  JOIN public.episode_cards c ON c.episode_id = m.episode_id
  JOIN public.podcasts p ON p.id = c.podcast_id
  WHERE p.language_decision = 'accept_hungarian'
    AND COALESCE(m.relevance_status, 'pending') NOT IN ('rejected', 'needs_review', 'resolved_show_host', 'resolved_feed_credit_not_episode')
), anchored AS (
  SELECT b.*, bool_or(b.verified) OVER (PARTITION BY b.person_id) AS person_anchored
  FROM base b
)
SELECT DISTINCT ON (a.person_id, a.episode_id)
  a.person_id, a.episode_id, a.podcast_id, a.published_at, a.verified,
  CASE
    WHEN NOT a.verified THEN 'mention'
    WHEN a.role_type IN ('participant','subject','mention') THEN a.role_type
    WHEN a.mention_type IN ('host','guest','interviewee','speaker','archival_source') THEN 'participant'
    WHEN a.mention_type = 'subject' THEN 'subject'
    ELSE 'mention'
  END AS page_role,
  a.mention_type, a.relevance_status, a.validation_source, a.final_relevance_score, a.confidence
FROM anchored a
WHERE a.strong AND (a.verified OR NOT a.person_anchored)
ORDER BY a.person_id, a.episode_id, a.verified DESC, a.final_relevance_score DESC NULLS LAST, a.confidence DESC;
COMMENT ON VIEW public.person_public_episode_links_v1 IS 'Single eligibility rule for a person page: episodes listed, counted, prerendered and linked. Inherited show-host roles and corrected feed credits excluded. Server-only.';
REVOKE ALL ON public.person_public_episode_links_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.person_public_episode_links_v1 TO service_role;

CREATE OR REPLACE FUNCTION public.person_episodes(_person_id uuid, _limit integer DEFAULT 250)
 RETURNS TABLE(id uuid, title text, display_title text, slug text, image_url text, published_at timestamp with time zone, ai_summary text, audio_url text, people text[], mentioned text[], topics text[], companies text[], tickers text[], podcast_id uuid, podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text, podcast_category text, podcast_rank numeric, podcast_rank_label text, podcast_rss_status text, podcast_featured boolean, mention_type text, role_type text, confidence numeric, relevance_status text, validation_source text, final_relevance_score numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '12s'
AS $function$
  SELECT e.episode_id, e.title, e.display_title, e.slug, e.image_url, e.published_at,
         e.card_summary, e.audio_url, e.people, e.mentioned, e.topics, e.companies, e.tickers,
         e.podcast_id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured,
         m.mention_type, m.role_type, m.confidence, m.relevance_status,
         m.validation_source, m.final_relevance_score
  FROM person_episode_mentions m
  JOIN episode_cards e ON e.episode_id = m.episode_id
  JOIN podcasts p ON p.id = e.podcast_id
  WHERE m.person_id = _person_id
    AND coalesce(m.relevance_status, 'pending') NOT IN ('rejected', 'needs_review', 'resolved_feed_credit_not_episode')
    AND p.language_decision = 'accept_hungarian'
  ORDER BY m.final_relevance_score DESC NULLS LAST, e.published_at DESC NULLS LAST
  LIMIT greatest(1, least(coalesce(_limit, 250), 400));
$function$;

CREATE OR REPLACE FUNCTION public.get_episode_person_links_v1(p_episode_id uuid)
 RETURNS TABLE(person_id uuid, verified boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '5s'
AS $function$
  SELECT x.person_id, x.verified FROM (
    SELECT m.person_id,
           bool_or(m.relevance_status = 'accepted' AND public.person_link_trusted_v1(m.person_id, m.validation_source)) AS verified
      FROM public.person_episode_mentions m
     WHERE m.episode_id = p_episode_id
       AND coalesce(m.relevance_status, 'pending') NOT IN ('rejected', 'needs_review', 'resolved_feed_credit_not_episode')
     GROUP BY m.person_id) x
   WHERE x.verified OR NOT public.person_has_verified_link_v1(x.person_id, p_episode_id)
   LIMIT 40;
$function$;

CREATE OR REPLACE FUNCTION public.get_linkable_episode_people_v1(p_episode_ids uuid[])
 RETURNS TABLE(episode_id uuid, slug text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '5s'
AS $function$
  WITH m AS (
    SELECT m.episode_id, m.person_id,
           bool_or(m.relevance_status = 'accepted' AND public.person_link_trusted_v1(m.person_id, m.validation_source)) AS verified
      FROM public.person_episode_mentions m
     WHERE m.episode_id = ANY((coalesce(p_episode_ids, '{}'::uuid[]))[1:200])
       AND coalesce(m.relevance_status, 'pending') NOT IN ('rejected', 'needs_review', 'resolved_feed_credit_not_episode')
     GROUP BY m.episode_id, m.person_id)
  SELECT m.episode_id, p.slug
    FROM m JOIN public.people p ON p.id = m.person_id
   WHERE (m.verified OR NOT public.person_has_verified_link_v1(m.person_id, m.episode_id))
     AND p.slug IS NOT NULL
     AND p.is_public IS TRUE
     AND p.gated_episode_count >= 1
     AND coalesce(p.activation_status, '') <> 'inactive'
     AND coalesce(p.ai_recommended_action, '') NOT IN ('hide', 'reject')
     AND coalesce(p.ai_review_status, '') NOT IN ('needs_human_review', 'duplicate_candidate')
     AND coalesce(p.identity_status, '') <> 'split_resolved';
$function$;

CREATE OR REPLACE FUNCTION public.recompute_person_role_counts()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE updated_count integer;
BEGIN
  WITH gated AS (
    SELECT pem.person_id, pem.role_type, pem.episode_id
    FROM public.person_episode_mentions pem
    JOIN public.episodes e   ON e.id = pem.episode_id
    JOIN public.podcasts p   ON p.id = e.podcast_id
    WHERE p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND (
        pem.relevance_status = 'accepted'
        OR COALESCE(pem.final_relevance_score, 0) >= 0.75
        OR pem.validation_source = 'manual'
        OR (
          (pem.relevance_status IS NULL OR pem.relevance_status = 'pending')
          AND pem.role_type IN ('participant','subject')
          AND COALESCE(pem.confidence, 0) >= 0.80
        )
      )
      AND COALESCE(pem.relevance_status, '') NOT IN ('rejected','needs_review','resolved_feed_credit_not_episode')
  ),
  agg AS (
    SELECT
      person_id,
      COUNT(DISTINCT episode_id) FILTER (WHERE role_type = 'participant') AS participant_count,
      COUNT(DISTINCT episode_id) FILTER (WHERE role_type = 'subject')     AS subject_count,
      COUNT(DISTINCT episode_id) FILTER (WHERE role_type = 'mention')     AS mention_count
    FROM gated
    GROUP BY person_id
  )
  UPDATE public.people p
  SET participant_count = COALESCE(a.participant_count, 0),
      subject_count     = COALESCE(a.subject_count, 0),
      mention_count     = COALESCE(a.mention_count, 0)
  FROM agg a
  WHERE p.id = a.person_id;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$function$;