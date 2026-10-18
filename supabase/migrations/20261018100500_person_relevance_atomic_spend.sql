-- Cache and spend are one transaction; the receipt makes RPC retries idempotent.
CREATE TABLE IF NOT EXISTS public.person_relevance_spend_receipts (
 id uuid PRIMARY KEY, gateway_source_hash text NOT NULL, cost_usd numeric NOT NULL CHECK(cost_usd>=0),
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON public.person_relevance_spend_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.person_relevance_spend_receipts TO service_role;
ALTER TABLE public.person_relevance_spend_receipts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.cache_person_judge_batch(
 _batch_id uuid, _token uuid, _source_hash text, _model text, _decisions jsonb, _cost numeric)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE item jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(_batch_id::text,0));
 IF EXISTS(SELECT 1 FROM person_relevance_spend_receipts WHERE id=_batch_id) THEN RETURN; END IF;
 IF jsonb_typeof(_decisions) IS DISTINCT FROM 'array' OR jsonb_array_length(_decisions) NOT BETWEEN 1 AND 6
  OR _cost IS NULL OR _cost NOT BETWEEN 0 AND 0.05 THEN RAISE EXCEPTION 'invalid_batch'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(_decisions) LOOP
  UPDATE person_relevance_work SET cached_hash=source_hash,cached_decision=item->'decision',
    model_used=_model,updated_at=now()
  WHERE person_id=(item->>'person_id')::uuid AND episode_id=(item->>'episode_id')::uuid
    AND claim_token=_token AND source_hash=item->>'source_hash' AND lease_until>now();
  IF NOT FOUND THEN RAISE EXCEPTION 'stale_batch_claim'; END IF;
 END LOOP;
 PERFORM public.add_ai_spend((now() AT TIME ZONE 'UTC')::date,'person_relevance',_cost,1);
 INSERT INTO person_relevance_spend_receipts(id,gateway_source_hash,cost_usd) VALUES(_batch_id,_source_hash,_cost);
END;
$$;
REVOKE ALL ON FUNCTION public.cache_person_judge_batch(uuid,uuid,text,text,jsonb,numeric) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cache_person_judge_batch(uuid,uuid,text,text,jsonb,numeric) TO service_role;

-- Reconcile audited successful v1 calls made before atomic spend receipts existed.
-- Read only gateway audits; internal apply audits have zero cost and are excluded.
DO $$
DECLARE audit_row record; inserted boolean;
BEGIN
 FOR audit_row IN SELECT id,created_at,source_hash,COALESCE(estimated_cost_usd,0) cost
   FROM ai_call_audit a WHERE job_type='person_relevance_judge' AND prompt_version='person-pairs-v1' AND status='ok'
    AND source_hash IS NOT NULL AND NOT EXISTS(
      SELECT 1 FROM person_relevance_spend_receipts r WHERE r.gateway_source_hash=a.source_hash)
 LOOP
  inserted:=false;
  INSERT INTO person_relevance_spend_receipts(id,gateway_source_hash,cost_usd,created_at)
    VALUES(audit_row.id,audit_row.source_hash,audit_row.cost,audit_row.created_at) ON CONFLICT(id) DO NOTHING RETURNING true INTO inserted;
  IF inserted THEN PERFORM public.add_ai_spend((audit_row.created_at AT TIME ZONE 'UTC')::date,'person_relevance',audit_row.cost,1); END IF;
 END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_people_hub_score_for(_person_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_browsable_before int;
  v_browsable_after int;
  v_indexable_after int;
BEGIN
  IF COALESCE(cardinality(_person_ids),0)=0 THEN RETURN '{}'::jsonb; END IF;
  IF cardinality(_person_ids)>200 THEN RAISE EXCEPTION 'too_many_people'; END IF;
  SELECT count(*) INTO v_browsable_before FROM public.people WHERE id=ANY(_person_ids) AND is_browsable_in_people_hub = true;

  WITH agg AS (
    SELECT
      p.id AS person_id,
      COUNT(*) FILTER (
        WHERE m.relevance_status = 'accepted'
          AND e.published_at >= now() - interval '30 days'
      ) AS recent_30d,
      MAX(e.published_at) FILTER (WHERE m.relevance_status = 'accepted') AS latest_at,
      AVG(pc.podiverzum_rank) FILTER (
        WHERE pc.is_hungarian = true
          AND pc.language_decision = 'accept_hungarian'
          AND pc.podiverzum_rank IS NOT NULL
      ) AS avg_rank
    FROM public.people p
    LEFT JOIN public.person_episode_mentions m ON m.person_id = p.id
    LEFT JOIN public.episodes e ON e.id = m.episode_id
    LEFT JOIN public.podcasts pc ON pc.id = e.podcast_id
    WHERE p.id=ANY(_person_ids)
    GROUP BY p.id
  )
  UPDATE public.people p
  SET
    recent_relevant_episode_count_30d = COALESCE(a.recent_30d, 0),
    latest_accepted_relevant_episode_at = a.latest_at,
    avg_source_podcast_rank = COALESCE(a.avg_rank, 0),
    one_show_host = (COALESCE(p.distinct_podcast_count,0) <= 1)
  FROM agg a
  WHERE a.person_id = p.id;

  UPDATE public.people p
  SET people_hub_score =
    GREATEST(0,
        0.8  * LEAST(COALESCE(p.gated_episode_count,0), 40)
      + 4.0  * LEAST(COALESCE(p.gated_podcast_count,0), 30)
      + 2.0  * LEAST(COALESCE(p.host_count,0), 20)
      + 1.5  * LEAST(COALESCE(p.guest_count,0), 30)
      + 1.0  * LEAST(COALESCE(p.strong_mention_count,0), 20)
      + 3.0  * LEAST(COALESCE(p.recent_relevant_episode_count_30d,0), 10)
      + CASE
          WHEN p.latest_accepted_relevant_episode_at IS NULL THEN 0
          ELSE GREATEST(
            0,
            10.0 * (1.0 - LEAST(
              EXTRACT(EPOCH FROM (now() - p.latest_accepted_relevant_episode_at)) / (365.0 * 86400.0),
              1.0
            ))
          )
        END
      + LEAST(16.0, (COALESCE(p.avg_source_podcast_rank,0) / 5.0) * 8.0)
      + CASE WHEN p.wikipedia_match_status = 'verified' THEN 5.0 ELSE 0 END
      + CASE WHEN p.editorial_priority THEN (COALESCE(p.editorial_priority_level,0)::numeric / 100.0) * 20.0 ELSE 0 END
      - CASE WHEN p.ai_review_status IN ('needs_human_review','duplicate_candidate') THEN 50.0 ELSE 0 END
      - CASE WHEN p.identity_status IN ('ambiguous','split_needed','needs_review') THEN 10.0 ELSE 0 END
    )
  WHERE p.id=ANY(_person_ids);

  UPDATE public.people p
  SET is_browsable_in_people_hub = (
    COALESCE(p.gated_episode_count,0) >= 1
    AND p.is_public = true
    AND p.activation_status IN ('indexable','public_noindex','manual_approved')
    AND p.ai_review_status NOT IN ('needs_human_review','duplicate_candidate')
    AND p.identity_status NOT IN ('ambiguous','split_needed','needs_review')
    AND COALESCE(p.ai_duplicate_of_person_id, '00000000-0000-0000-0000-000000000000'::uuid)
        = '00000000-0000-0000-0000-000000000000'::uuid
  )
  WHERE p.id=ANY(_person_ids);

  SELECT count(*) INTO v_browsable_after FROM public.people WHERE id=ANY(_person_ids) AND is_browsable_in_people_hub = true;
  SELECT count(*) INTO v_indexable_after FROM public.people WHERE id=ANY(_person_ids) AND is_indexable = true;

  RETURN jsonb_build_object(
    'browsable_before', v_browsable_before,
    'browsable_after', v_browsable_after,
    'indexable_after', v_indexable_after
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_people_hub_score_for(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_people_hub_score_for(uuid[]) TO service_role;
