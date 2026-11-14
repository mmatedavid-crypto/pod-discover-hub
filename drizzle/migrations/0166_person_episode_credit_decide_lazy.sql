CREATE OR REPLACE FUNCTION public.person_episode_credit_decide_v1(_person uuid, _episode uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r record; names text[]; fq text; hit boolean; oc text; full_text text;
BEGIN
  FOR r IN SELECT ru.*, e.title, e.description, e.podcast_id AS ep_podcast,
             public.person_episode_credit_capture_v1(ru.credit_pattern, ru.title_pattern, e.title, e.description) q
           FROM person_episode_credit_rules ru JOIN episodes e ON e.id = _episode AND e.podcast_id = ru.podcast_id
           WHERE ru.active ORDER BY ru.rule_key LOOP
    CONTINUE WHEN r.q IS NULL OR length(r.q) < 3;
    IF names IS NULL THEN
      names := ARRAY(SELECT pe.name FROM people pe WHERE pe.id = _person
        UNION SELECT a.alias FROM person_aliases a WHERE a.person_id = _person AND a.status = 'accepted'
          AND (a.scope = 'global' OR (a.scope = 'podcast' AND a.scope_podcast_id = r.ep_podcast)));
    END IF;
    fq := public.person_text_fold_v1(r.q);
    hit := EXISTS (SELECT 1 FROM unnest(names) n WHERE public.person_credit_name_in_text_v1(n, fq));
    oc := NULL;
    IF hit THEN
      IF r.match_action <> 'accept_participant' THEN CONTINUE; END IF;
      IF _person = ANY (r.anchor_person_ids) OR EXISTS (
           SELECT 1 FROM people p WHERE p.id = _person AND NOT COALESCE(p.identity_ambiguous, false)
             AND COALESCE(p.identity_status, 'normal') IN ('normal', 'confirmed', 'context_resolved')
             AND NOT EXISTS (SELECT 1 FROM people o WHERE o.normalized_name = p.normalized_name AND o.id <> p.id AND o.is_public)
             AND NOT EXISTS (SELECT 1 FROM person_episode_mentions x WHERE x.person_id = _person AND x.relevance_status = 'accepted'
                               AND x.podcast_id IS DISTINCT FROM r.ep_podcast)) THEN
        oc := 'credited_role';
      ELSE
        oc := 'credit_identity_unanchored';
      END IF;
    ELSIF r.correct_feed_credits AND _person = ANY (r.feed_credit_person_ids) THEN
      full_text := COALESCE(full_text, public.person_text_fold_v1(concat_ws(' ', r.title, r.description)));
      IF NOT EXISTS (SELECT 1 FROM unnest(names) n WHERE public.person_credit_name_in_text_v1(n, full_text)) THEN
        oc := 'feed_credit_not_episode';
      END IF;
    END IF;
    IF oc IS NOT NULL THEN
      RETURN jsonb_build_object('rule_id', r.id, 'outcome', oc, 'quote', r.q, 'role', r.credit_role, 'version', r.version,
        'source_url', r.source_url, 'source_hash', r.source_hash, 'provenance', r.provenance);
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.person_episode_credit_decide_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
  REVOKE ALL ON FUNCTION public.person_episode_credit_decide_v1(uuid, uuid) FROM readonly_codex; END IF; END $$;
GRANT EXECUTE ON FUNCTION public.person_episode_credit_decide_v1(uuid, uuid) TO service_role;