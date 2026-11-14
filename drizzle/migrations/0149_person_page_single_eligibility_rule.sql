-- B) One eligibility rule for person pages: list, counts, prerender, sitemap and chips all read
-- person_public_episode_links_v1. Counts refresh without changing who is public.

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
    AND COALESCE(m.relevance_status, 'pending') NOT IN ('rejected', 'needs_review')
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
-- Unreviewed rows count only while the person has no reviewed (verified) link at all:
-- once anchored, a same-name unreviewed episode is not attached to this identity.
WHERE a.strong AND (a.verified OR NOT a.person_anchored)
ORDER BY a.person_id, a.episode_id, a.verified DESC, a.final_relevance_score DESC NULLS LAST, a.confidence DESC;

COMMENT ON VIEW public.person_public_episode_links_v1 IS 'Single eligibility rule for a person page: episodes listed, counted, prerendered and linked. Server-only.';
REVOKE ALL ON public.person_public_episode_links_v1 FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.person_public_episode_links_v1 TO service_role;

-- Page payload: list + true totals from the same rows (no N+1, no second rule).
CREATE OR REPLACE FUNCTION public.get_person_page_episodes_v1(p_person_id uuid, p_limit integer DEFAULT 250)
RETURNS TABLE(id uuid, title text, display_title text, slug text, image_url text, published_at timestamptz,
  ai_summary text, audio_url text, people text[], mentioned text[], topics text[], companies text[], tickers text[],
  podcast_id uuid, podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text,
  podcast_category text, podcast_rank numeric, podcast_rank_label text, podcast_rss_status text, podcast_featured boolean,
  mention_type text, role_type text, verified boolean, confidence numeric, relevance_status text, final_relevance_score numeric,
  total_episodes integer, total_podcasts integer, latest_episode_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '8s'
AS $$
  WITH l AS (
    SELECT * FROM public.person_public_episode_links_v1 v WHERE v.person_id = p_person_id
  ), t AS (
    SELECT count(*)::int AS n_ep, count(DISTINCT podcast_id)::int AS n_pod, max(published_at) AS latest FROM l
  ), top AS (
    SELECT * FROM l
    ORDER BY verified DESC, final_relevance_score DESC NULLS LAST, published_at DESC NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 250), 400))
  )
  SELECT e.episode_id, e.title, e.display_title, e.slug, e.image_url, e.published_at,
         e.card_summary, e.audio_url, e.people, e.mentioned, e.topics, e.companies, e.tickers,
         e.podcast_id, p.slug, p.title, p.display_title, p.image_url, p.category,
         p.podiverzum_rank, p.rank_label, p.rss_status, p.featured,
         top.mention_type, top.page_role, top.verified, top.confidence, top.relevance_status, top.final_relevance_score,
         t.n_ep, t.n_pod, t.latest
  FROM top
  JOIN public.episode_cards e ON e.episode_id = top.episode_id
  JOIN public.podcasts p ON p.id = e.podcast_id
  CROSS JOIN t
  ORDER BY top.verified DESC, top.final_relevance_score DESC NULLS LAST, e.published_at DESC NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.get_person_page_episodes_v1(uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_person_page_episodes_v1(uuid, integer) TO anon, authenticated, service_role;

-- Whether an empty person page still brings Google visitors (keep it indexable then).
CREATE OR REPLACE FUNCTION public.person_page_has_search_traffic_v1(p_slug text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.gsc_query_daily g
    WHERE g.date >= current_date - 90
      AND g.clicks > 0
      AND g.page IN ('https://podiverzum.hu/szemelyek/' || p_slug, 'https://www.podiverzum.hu/szemelyek/' || p_slug)
  );
$$;
REVOKE ALL ON FUNCTION public.person_page_has_search_traffic_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.person_page_has_search_traffic_v1(text) TO anon, authenticated, service_role;
CREATE INDEX IF NOT EXISTS gsc_query_daily_page_date_idx ON public.gsc_query_daily (page, date DESC);

-- Counts only (episode/podcast totals, latest date) from the same view; never changes visibility.
CREATE OR REPLACE FUNCTION public.refresh_person_episode_counts_v1()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '120s'
AS $$
DECLARE v_n integer;
BEGIN
  WITH g AS (
    SELECT person_id, count(*)::int AS ep, count(DISTINCT podcast_id)::int AS pod, max(published_at) AS latest
    FROM public.person_public_episode_links_v1 GROUP BY person_id
  ), j AS (
    SELECT pp.id, COALESCE(g.ep, 0) AS ep, COALESCE(g.pod, 0) AS pod, g.latest
    FROM public.people pp LEFT JOIN g ON g.person_id = pp.id
  ), upd AS (
    UPDATE public.people pp
    SET gated_episode_count = j.ep, gated_podcast_count = j.pod, latest_episode_at = j.latest,
        -- an empty page stays reachable but leaves the people hub list
        is_browsable_in_people_hub = CASE WHEN j.ep = 0 THEN false ELSE pp.is_browsable_in_people_hub END,
        updated_at = now()
    FROM j
    WHERE pp.id = j.id
      AND (pp.gated_episode_count IS DISTINCT FROM j.ep
        OR pp.gated_podcast_count IS DISTINCT FROM j.pod
        OR pp.latest_episode_at IS DISTINCT FROM j.latest
        OR (j.ep = 0 AND pp.is_browsable_in_people_hub))
    RETURNING 1
  )
  SELECT count(*)::int INTO v_n FROM upd;
  RETURN v_n;
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_person_episode_counts_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_person_episode_counts_v1() TO service_role;

-- The extractor's full recount uses the same rows. Change vs before: a count of 0 no longer
-- unpublishes the page (owner 2026-11-14: no mass hiding); it only leaves the hub list.
CREATE OR REPLACE FUNCTION public.recompute_person_gated_counts()
RETURNS TABLE(updated_count integer, single_ep_count integer, zero_ep_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated integer := 0; v_single integer := 0; v_zero integer := 0;
BEGIN
  WITH gated AS (
    SELECT person_id, count(*)::int AS ep_count, count(DISTINCT podcast_id)::int AS pod_count, max(published_at) AS latest_ep
    FROM public.person_public_episode_links_v1 GROUP BY person_id
  ),
  joined AS (
    SELECT pp2.id,
           COALESCE(g2.ep_count, 0) AS ep_count,
           COALESCE(g2.pod_count, 0) AS pod_count,
           g2.latest_ep,
           (COALESCE(pp2.ai_recommended_action,'') NOT IN ('hide','reject')
            AND COALESCE(pp2.ai_review_status,'') NOT IN ('needs_human_review','duplicate_candidate')
            AND COALESCE(pp2.identity_status,'') NOT IN ('split_resolved')) AS not_hard_blocked
    FROM public.people pp2
    LEFT JOIN gated g2 ON g2.person_id = pp2.id
  ),
  upd AS (
    UPDATE public.people pp
    SET
      gated_episode_count = j.ep_count,
      gated_podcast_count = j.pod_count,
      latest_episode_at = j.latest_ep,
      is_public = CASE WHEN j.ep_count >= 1 AND j.not_hard_blocked THEN true ELSE pp.is_public END,
      is_indexable = CASE WHEN j.ep_count >= 1 AND j.not_hard_blocked THEN true ELSE pp.is_indexable END,
      is_browsable_in_people_hub = CASE WHEN j.ep_count = 0 THEN false WHEN j.not_hard_blocked THEN true ELSE pp.is_browsable_in_people_hub END,
      activation_status = CASE WHEN j.ep_count >= 1 AND j.not_hard_blocked THEN 'active' ELSE pp.activation_status END,
      updated_at = now()
    FROM joined j
    WHERE pp.id = j.id
      AND (
        pp.gated_episode_count IS DISTINCT FROM j.ep_count
        OR pp.gated_podcast_count IS DISTINCT FROM j.pod_count
        OR pp.latest_episode_at IS DISTINCT FROM j.latest_ep
        OR (j.ep_count = 0 AND pp.is_browsable_in_people_hub)
        OR (j.ep_count >= 1 AND j.not_hard_blocked AND (
              NOT pp.is_public OR NOT pp.is_indexable OR NOT pp.is_browsable_in_people_hub
              OR COALESCE(pp.activation_status,'') <> 'active'))
      )
    RETURNING pp.id, j.ep_count AS ec
  )
  SELECT COUNT(*)::int, COUNT(*) FILTER (WHERE ec = 1)::int, COUNT(*) FILTER (WHERE ec = 0)::int
  INTO v_updated, v_single, v_zero FROM upd;
  RETURN QUERY SELECT v_updated, v_single, v_zero;
END;
$function$;