CREATE OR REPLACE FUNCTION public.get_person_rule_lanes_status_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '30s' AS $$
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR public.has_role(auth.uid(), 'admin')) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN jsonb_build_object(
    'generated_at', now(),
    'closed_states', jsonb_build_array('decided_accepted','decided_rejected','resolved_show_host','resolved_feed_credit_not_episode'),
    'totals', (SELECT jsonb_build_object(
        'closed', count(*) FILTER (WHERE disposition IN ('decided_accepted','decided_rejected','resolved_show_host','resolved_feed_credit_not_episode')),
        'open', count(*) FILTER (WHERE disposition NOT IN ('decided_accepted','decided_rejected','resolved_show_host','resolved_feed_credit_not_episode')),
        'resolved_show_host', count(*) FILTER (WHERE disposition = 'resolved_show_host'),
        'resolved_feed_credit_not_episode', count(*) FILTER (WHERE disposition = 'resolved_feed_credit_not_episode'))
      FROM person_pair_dispositions),
    'show_rules', (SELECT COALESCE(jsonb_agg(x ORDER BY x.pairs DESC), '[]'::jsonb) FROM (
        SELECT p.slug, p.title, count(DISTINCT h.id) rules, bool_or(h.owner_confirmed) owner_confirmed,
          (array_agg(h.source_url ORDER BY h.rule_key))[1] source_url, min(h.valid_from) valid_from, bool_or(h.title_pattern IS NOT NULL) sub_show,
          (SELECT count(*) FROM person_host_rule_resolutions r WHERE r.rule_id = ANY (array_agg(h.id))) pairs,
          (SELECT count(DISTINCT r.episode_id) FROM person_host_rule_resolutions r WHERE r.rule_id = ANY (array_agg(h.id))) episodes
        FROM person_host_rules h JOIN podcasts p ON p.id = h.podcast_id WHERE h.active GROUP BY p.slug, p.title) x),
    'credit_rules', (SELECT COALESCE(jsonb_agg(x ORDER BY x.rule_key), '[]'::jsonb) FROM (
        SELECT r.rule_key, r.credit_role, r.owner_confirmed, r.correct_feed_credits, r.source_quote,
          count(x.id) FILTER (WHERE x.outcome = 'credited_role' AND x.undone_at IS NULL) credited,
          count(x.id) FILTER (WHERE x.outcome = 'feed_credit_not_episode' AND x.undone_at IS NULL) corrected,
          count(x.id) FILTER (WHERE x.undone_at IS NOT NULL) undone
        FROM person_episode_credit_rules r LEFT JOIN person_episode_credit_resolutions x ON x.rule_id = r.id
        WHERE r.active GROUP BY r.id) x)
  );
END $$;
REVOKE ALL ON FUNCTION public.get_person_rule_lanes_status_v1() FROM PUBLIC, anon;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
  REVOKE ALL ON FUNCTION public.get_person_rule_lanes_status_v1() FROM readonly_codex; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.get_person_rule_lanes_status_v1() TO authenticated, service_role;