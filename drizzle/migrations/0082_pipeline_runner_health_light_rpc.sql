-- Light admin health read (runner completions vs cron dispatch, derivation freshness,
-- intentional pauses) that stays well inside the browser request timeout; the full
-- get_pipeline_health_snapshot_v1 keeps the catalog-wide counts for the verifier.
CREATE OR REPLACE FUNCTION public.get_pipeline_runner_health_v1()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'cron' AS $$
DECLARE
  v_items jsonb; v_src_queue bigint; v_seo_pending bigint;
  v_pr_paused boolean := NOT public.person_review_tick_active();
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  SELECT count(*) INTO v_src_queue FROM public.episode_source_change_queue;
  SELECT count(*) INTO v_seo_pending FROM (SELECT 1 FROM public.ai_enrichment_jobs WHERE status = 'pending' AND kind = 'seo_episode' LIMIT 20001) x;
  v_items := jsonb_build_array(
    public.pipeline_runner_health_item_v1('best_text_source', 'episode-best-text-source-runner', '%best-text-source%', v_src_queue, 'episodes in the source-change queue', interval '15 minutes'),
    public.pipeline_runner_health_item_v1('seo_enrich_runner', 'seo-enrich-runner', '%seo-enrich-runner%', v_seo_pending, 'pending episode SEO jobs', interval '30 minutes'),
    public.pipeline_runner_health_item_v1('topic_extractor', 'episode-topic-extractor', '%topic-extractor%', NULL, 'see derivation freshness', interval '20 minutes'),
    public.pipeline_runner_health_item_v1('entity_backfill', 'entity-backfill-runner', '%entity-backfill%', NULL, 'see derivation freshness', interval '30 minutes'),
    public.pipeline_runner_health_item_v1('person_entity_extractor', 'person-entity-extractor', '%person-entity-extractor%', NULL, 'catalog cursor; unchanged episodes skipped', interval '5 minutes'),
    public.derivation_health_item_v1(),
    CASE WHEN v_pr_paused THEN jsonb_build_object('name', 'person_relevance_review', 'health', 'paused',
      'recommendation', 'Paid person relevance review (OpenAI batch tick) is paused by the owner; mentions stay pending/needs_review, never auto-accepted.')
    ELSE jsonb_build_object('name', 'person_relevance_review', 'health', 'green', 'recommendation', 'OpenAI batch tick active.') END
  );
  RETURN jsonb_build_object('generated_at', now(), 'version', 'pipeline_runner_health_v1',
    'summary', jsonb_build_object(
      'green', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'green'),
      'yellow', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'yellow'),
      'red', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'red'),
      'paused', (SELECT count(*) FROM jsonb_array_elements(v_items) x WHERE x->>'health' = 'paused')),
    'items', v_items);
END $$;
REVOKE ALL ON FUNCTION public.get_pipeline_runner_health_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_pipeline_runner_health_v1() TO authenticated, service_role;