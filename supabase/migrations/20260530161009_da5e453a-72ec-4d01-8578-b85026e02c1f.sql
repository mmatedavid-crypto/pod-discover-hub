-- ===== 20260530161000_readonly_codex_audit_access =====
DO $$
DECLARE
  table_name text;
  audit_tables text[] := ARRAY[
    'ai_call_audit','ai_enrichment_jobs','ai_runs','ai_spend_daily','app_settings',
    'discovery_queue','episode_clean_text','episode_clean_text_candidates','episode_transcripts',
    'growth_runs','org_ai_review_jobs','person_ai_review_jobs','person_enrichment_jobs',
    'pi_dump_imports','pi_feed_staging','podcast_language_cleanup_log','queue_health_events',
    'search_benchmark_results','search_benchmark_runs','search_events','social_posts'
  ];
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'readonly_codex') THEN
    GRANT USAGE ON SCHEMA public TO readonly_codex;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly_codex;
  END IF;
  FOREACH table_name IN ARRAY audit_tables LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "codex readonly audit select" ON public.%I', table_name);
      EXECUTE format('CREATE POLICY "codex readonly audit select" ON public.%I FOR SELECT USING (current_user = %L)', table_name, 'readonly_codex');
    END IF;
  END LOOP;
END $$;

-- ===== 20260530163000_entity_quality_repair_queue =====
CREATE OR REPLACE VIEW public.v_entity_quality_issues AS
WITH org_issues AS (
  SELECT
    'organization'::text AS entity_kind, o.id AS entity_id, o.name, o.slug, o.org_type AS entity_type,
    o.episode_count, o.mention_count, o.distinct_podcast_count, o.is_public, o.is_indexable, o.is_browsable_in_hub,
    o.ai_review_status, o.ai_review_score,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN o.ai_review_status='reviewed' AND COALESCE(o.ai_review_score,1)<=0.2 AND (o.is_indexable OR o.is_browsable_in_hub) THEN 'reviewed_low_confidence_still_indexable' END,
      CASE WHEN o.ai_review_status='reviewed' AND COALESCE(o.ai_review_summary,'') ~* '(nem (egy )?(valódi|konkrét) szervezet|túl (rövid|általános)|elrejtésre javasolt|nem szervezet|téves kinyerés|nem azonosítható)' AND (o.is_indexable OR o.is_browsable_in_hub) THEN 'review_summary_rejects_but_indexable' END,
      CASE WHEN length(regexp_replace(o.name,'\s+','','g'))<=2 AND (o.is_indexable OR o.is_browsable_in_hub) AND o.distinct_podcast_count<5 THEN 'short_ambiguous_org_indexable' END,
      CASE WHEN o.org_type='party' AND o.is_indexable AND o.ai_review_status='pending' THEN 'high_value_party_pending_review' END,
      CASE WHEN o.is_public AND NOT o.is_indexable AND o.episode_count>=10 THEN 'high_signal_public_org_not_indexable' END
    ], NULL)::text[] AS issue_codes,
    GREATEST(
      CASE WHEN o.ai_review_status='reviewed' AND COALESCE(o.ai_review_score,1)<=0.2 AND (o.is_indexable OR o.is_browsable_in_hub) THEN 95 ELSE 0 END,
      CASE WHEN o.ai_review_status='reviewed' AND COALESCE(o.ai_review_summary,'') ~* '(nem (egy )?(valódi|konkrét) szervezet|túl (rövid|általános)|elrejtésre javasolt|nem szervezet|téves kinyerés|nem azonosítható)' AND (o.is_indexable OR o.is_browsable_in_hub) THEN 90 ELSE 0 END,
      CASE WHEN length(regexp_replace(o.name,'\s+','','g'))<=2 AND (o.is_indexable OR o.is_browsable_in_hub) AND o.distinct_podcast_count<5 THEN 80 ELSE 0 END,
      CASE WHEN o.org_type='party' AND o.is_indexable AND o.ai_review_status='pending' THEN 70 ELSE 0 END,
      CASE WHEN o.is_public AND NOT o.is_indexable AND o.episode_count>=10 THEN 50 ELSE 0 END
    ) + LEAST(COALESCE(o.episode_count,0),100)::numeric/100 AS priority_score,
    CASE
      WHEN o.ai_review_status='reviewed' AND (COALESCE(o.ai_review_score,1)<=0.2 OR COALESCE(o.ai_review_summary,'') ~* '(nem (egy )?(valódi|konkrét) szervezet|túl (rövid|általános)|elrejtésre javasolt|nem szervezet|téves kinyerés|nem azonosítható)') AND (o.is_indexable OR o.is_browsable_in_hub) THEN 'hide_low_confidence_organization'
      WHEN o.org_type='party' AND o.is_indexable AND o.ai_review_status='pending' THEN 'review_high_value_organization'
      WHEN o.is_public AND NOT o.is_indexable AND o.episode_count>=10 THEN 'review_hidden_high_signal_organization'
      ELSE 'entity_metadata_review'
    END AS repair_action,
    false AS may_require_ai,
    CASE
      WHEN o.ai_review_status='reviewed' AND (COALESCE(o.ai_review_score,1)<=0.2 OR COALESCE(o.ai_review_summary,'') ~* '(nem (egy )?(valódi|konkrét) szervezet|túl (rövid|általános)|elrejtésre javasolt|nem szervezet|téves kinyerés|nem azonosítható)') AND (o.is_indexable OR o.is_browsable_in_hub) THEN 'no_ai_hide_only_keep_mentions_and_profile_row'
      ELSE 'no_ai_review_queue_only'
    END AS safety_policy
  FROM public.organizations o
),
person_issues AS (
  SELECT
    'person'::text AS entity_kind, p.id AS entity_id, p.name, p.slug, p.entity_type,
    p.episode_count, NULL::integer AS mention_count, p.distinct_podcast_count,
    p.is_public, p.is_indexable, p.is_browsable_in_people_hub AS is_browsable_in_hub,
    p.ai_review_status, p.ai_review_score,
    ARRAY_REMOVE(ARRAY[
      CASE WHEN p.is_indexable AND p.ai_review_status='pending' AND COALESCE(p.episode_count,0)>=10 THEN 'high_signal_person_pending_review' END,
      CASE WHEN p.is_indexable AND COALESCE(p.identity_ambiguous,false) THEN 'ambiguous_person_indexable' END,
      CASE WHEN p.is_indexable AND COALESCE(p.duplicate_candidate,false) THEN 'duplicate_person_candidate_indexable' END,
      CASE WHEN p.is_indexable AND length(regexp_replace(p.name,'\s+','','g'))<=3 THEN 'short_ambiguous_person_indexable' END
    ], NULL)::text[] AS issue_codes,
    GREATEST(
      CASE WHEN p.is_indexable AND p.ai_review_status='pending' AND COALESCE(p.episode_count,0)>=10 THEN 75 ELSE 0 END,
      CASE WHEN p.is_indexable AND COALESCE(p.identity_ambiguous,false) THEN 90 ELSE 0 END,
      CASE WHEN p.is_indexable AND COALESCE(p.duplicate_candidate,false) THEN 90 ELSE 0 END,
      CASE WHEN p.is_indexable AND length(regexp_replace(p.name,'\s+','','g'))<=3 THEN 80 ELSE 0 END
    ) + LEAST(COALESCE(p.episode_count,0),100)::numeric/100 AS priority_score,
    CASE
      WHEN p.is_indexable AND (COALESCE(p.identity_ambiguous,false) OR COALESCE(p.duplicate_candidate,false)) THEN 'review_ambiguous_person'
      WHEN p.is_indexable AND p.ai_review_status='pending' AND COALESCE(p.episode_count,0)>=10 THEN 'review_high_signal_person'
      ELSE 'entity_metadata_review'
    END AS repair_action,
    false AS may_require_ai,
    'no_ai_review_queue_only'::text AS safety_policy
  FROM public.people p
),
unioned AS (SELECT * FROM org_issues UNION ALL SELECT * FROM person_issues)
SELECT * FROM unioned WHERE array_length(issue_codes,1)>0;

GRANT SELECT ON public.v_entity_quality_issues TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_entity_quality_snapshot_v1(_limit integer DEFAULT 100)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
WITH issues AS (SELECT * FROM public.v_entity_quality_issues),
issue_counts AS (SELECT issue_code, count(*) AS total FROM issues, unnest(issue_codes) AS issue_code GROUP BY issue_code),
action_counts AS (SELECT repair_action, count(*) AS total FROM issues GROUP BY repair_action),
top_queue AS (SELECT * FROM issues ORDER BY priority_score DESC, episode_count DESC NULLS LAST, name LIMIT greatest(_limit,1))
SELECT jsonb_build_object(
  'generated_at', now(),
  'limit', greatest(_limit,1),
  'total_issue_rows', (SELECT count(*) FROM issues),
  'issue_counts', COALESCE((SELECT jsonb_object_agg(issue_code,total) FROM issue_counts),'{}'::jsonb),
  'action_counts', COALESCE((SELECT jsonb_object_agg(repair_action,total) FROM action_counts),'{}'::jsonb),
  'top_queue', COALESCE((SELECT jsonb_agg(jsonb_build_object('entity_kind',entity_kind,'entity_id',entity_id,'name',name,'slug',slug,'entity_type',entity_type,'episode_count',episode_count,'mention_count',mention_count,'distinct_podcast_count',distinct_podcast_count,'is_public',is_public,'is_indexable',is_indexable,'is_browsable_in_hub',is_browsable_in_hub,'ai_review_status',ai_review_status,'ai_review_score',ai_review_score,'issue_codes',issue_codes,'repair_action',repair_action,'may_require_ai',may_require_ai,'safety_policy',safety_policy,'priority_score',priority_score) ORDER BY priority_score DESC, episode_count DESC NULLS LAST, name) FROM top_queue),'[]'::jsonb)
);
$$;

GRANT EXECUTE ON FUNCTION public.get_entity_quality_snapshot_v1(integer) TO authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'entity_quality_controls',
  jsonb_build_object('enabled',true,'dry_run',true,'batch_limit',100,'allowed_apply_actions',jsonb_build_array('hide_low_confidence_organization'),'note','No-AI entity quality repair.'),
  now()
) ON CONFLICT (key) DO UPDATE SET value=public.app_settings.value||EXCLUDED.value, updated_at=now();

UPDATE public.app_settings SET value=jsonb_set(value,'{runners}',(SELECT COALESCE(jsonb_agg(r),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(value->'runners','[]'::jsonb)) r WHERE r->>'name' NOT IN ('entity_quality_apply_runner','entity_quality_autopilot'))||jsonb_build_array(jsonb_build_object('name','entity_quality_apply_runner','controls_key','entity_quality_controls','progress_key','entity_quality_controls','spend_key',null,'cadence_minutes',0,'min_processed_for_error_rate',1),jsonb_build_object('name','entity_quality_autopilot','controls_key','entity_quality_controls','progress_key','entity_quality_controls','spend_key',null,'cadence_minutes',30,'min_processed_for_error_rate',1)),true), updated_at=now() WHERE key='watchdog_state';

-- ===== 20260530164000_entity_quality_autopilot =====
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='podiverzum-entity-quality-autopilot-30min') THEN
    PERFORM cron.schedule('podiverzum-entity-quality-autopilot-30min','*/30 * * * *', $cmd$
      SELECT net.http_post(
        url:='https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/entity-quality-autopilot',
        headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
        body:=concat('{"trigger":"cron","ts":"',now(),'"}')::jsonb
      );
    $cmd$);
  END IF;
END $$;

-- ===== 20260530170000_database_quality_fast_lane =====
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'database_quality_fast_lane',
  jsonb_build_object('enabled',true,'no_ai_dry_run',false,'run_data_repair',true,'data_repair_limit',500,'run_entity_quality',true,'entity_quality_limit',500,'run_clean_text',true,'run_entity_backfill',true,'entity_backfill_batch',400,'entity_backfill_concurrency',24,'run_person_entity_extractor',true,'person_entity_limit',10000,'run_organizations_backfill',true,'organizations_backfill_batch',1000,'run_topic_extractor',true,'topic_batch',40,'max_runtime_ms',145000,'auto_stop_at_errors',5,'consecutive_errors',0,'note','Same-day database quality fast lane.'),
  now()
) ON CONFLICT (key) DO UPDATE SET value=public.app_settings.value||EXCLUDED.value, updated_at=now();

INSERT INTO public.app_settings (key, value, updated_at) VALUES ('data_repair_controls', jsonb_build_object('enabled',true,'dry_run',false,'batch_limit',500,'note','Fast-lane enabled.'), now()) ON CONFLICT (key) DO UPDATE SET value=public.app_settings.value||EXCLUDED.value, updated_at=now();

UPDATE public.app_settings SET value=jsonb_set(value,'{runners}',(SELECT COALESCE(jsonb_agg(r),'[]'::jsonb) FROM jsonb_array_elements(COALESCE(value->'runners','[]'::jsonb)) r WHERE r->>'name' NOT IN ('database_quality_fast_lane'))||jsonb_build_array(jsonb_build_object('name','database_quality_fast_lane','controls_key','database_quality_fast_lane','progress_key','database_quality_fast_lane','spend_key',null,'cadence_minutes',5,'min_processed_for_error_rate',1)),true), updated_at=now() WHERE key='watchdog_state';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname='podiverzum-database-quality-fast-lane-5min') THEN
    PERFORM cron.schedule('podiverzum-database-quality-fast-lane-5min','*/5 * * * *', $cmd$
      SELECT net.http_post(
        url:='https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/database-quality-fast-lane',
        headers:='{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
        body:=concat('{"trigger":"cron","ts":"',now(),'"}')::jsonb
      );
    $cmd$);
  END IF;
END $$;

-- ===== 20260530172000_entity_extraction_evidence_v5 =====
ALTER TABLE public.episodes ADD COLUMN IF NOT EXISTS entity_extraction_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.episode_organization_map ADD COLUMN IF NOT EXISTS source_evidence jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_episodes_entity_evidence_gin ON public.episodes USING gin (entity_extraction_evidence);
UPDATE public.app_settings SET value=value||jsonb_build_object('entity_schema_version',5,'strict_evidence_required',true,'note','Entity extraction v5 requires literal evidence.'), updated_at=now() WHERE key='entity_backfill_controls';

-- ===== 20260530174000_person_relevance_cost_guard (will be overridden by 180500 fast mode in part 2) =====
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'person_relevance_judge_controls',
  jsonb_build_object('enabled',true,'daily_budget_usd',3.0,'batch_limit',40,'concurrency',3,'max_ai_calls_per_run',120,'min_confidence_for_ai',0.55,'prefer_paid',false,'auto_disable_when_empty',true,'note','Cost guard 2026-05-30.'),
  now()
) ON CONFLICT (key) DO UPDATE SET value=public.app_settings.value||EXCLUDED.value, updated_at=now();
UPDATE public.app_settings SET value=jsonb_set(value,'{per_job_caps_usd}',COALESCE(value->'per_job_caps_usd','{}'::jsonb)||jsonb_build_object('person_relevance',3,'person_relevance_judge',3),true)||jsonb_build_object('updated_at',now()::text,'updated_note','2026-05-30: cost guard'), updated_at=now() WHERE key='ai_budget';

-- ===== 20260530175000_fast_quality_snapshot_rpc =====
CREATE OR REPLACE FUNCTION public.get_data_quality_snapshot_v1(_recent_days integer DEFAULT 30, _sample_limit integer DEFAULT 25)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
WITH eligible AS MATERIALIZED (
  SELECT e.id, e.podcast_id, e.title, e.display_title, e.published_at, e.audio_url, e.clean_text_status, e.ai_summary, e.ai_entities_version,
         e.people, e.mentioned, e.companies, e.organizations, e.topics, e.tickers,
         e.episode_rank, e.episode_rank_label, e.episode_rank_reason,
         p.title AS podcast_title, p.display_title AS podcast_display_title, p.rank_label, p.podiverzum_rank
  FROM public.episodes e JOIN public.podcasts p ON p.id=e.podcast_id
  WHERE p.is_hungarian=true AND p.language_decision='accept_hungarian' AND p.rss_status<>ALL(ARRAY['failed','inactive'])
),
scored AS (
  SELECT e.*,
    array_remove(ARRAY[
      CASE WHEN e.audio_url IS NULL OR length(trim(e.audio_url))=0 THEN 'missing_audio' END,
      CASE WHEN e.published_at IS NULL THEN 'missing_published_at' END,
      CASE WHEN e.clean_text_status IS DISTINCT FROM 'done' THEN 'missing_clean_text' END,
      CASE WHEN e.ai_summary IS NULL OR length(trim(e.ai_summary))<80 THEN 'missing_summary' END,
      CASE WHEN coalesce(e.ai_entities_version,0)<4 THEN 'old_entity_version' END,
      CASE WHEN (coalesce(cardinality(e.people),0)+coalesce(cardinality(e.mentioned),0)+coalesce(cardinality(e.companies),0)+coalesce(cardinality(e.topics),0)+coalesce(cardinality(e.tickers),0)+CASE WHEN e.organizations IS NULL OR e.organizations::text IN ('null','{}','[]') THEN 0 ELSE 1 END)=0 THEN 'missing_entities' END,
      CASE WHEN e.episode_rank IS DISTINCT FROM 1 OR e.episode_rank_label IS NOT NULL OR coalesce(e.episode_rank_reason,'{}'::jsonb)<>'{}'::jsonb THEN 'legacy_episode_rank_active' END
    ], NULL) AS issue_codes,
    (CASE e.rank_label WHEN 'S' THEN 50 WHEN 'A' THEN 35 WHEN 'B' THEN 20 WHEN 'C' THEN 10 ELSE 3 END
     + least(greatest(coalesce(e.podiverzum_rank,0),0),10)::integer
     + CASE WHEN e.published_at>=now()-interval '30 days' THEN 20 ELSE 0 END
     + CASE WHEN e.published_at>=now()-interval '7 days' THEN 15 ELSE 0 END
     + CASE WHEN e.clean_text_status IS DISTINCT FROM 'done' THEN 20 ELSE 0 END
     + CASE WHEN coalesce(e.ai_entities_version,0)<4 THEN 15 ELSE 0 END
     + CASE WHEN e.ai_summary IS NULL OR length(trim(e.ai_summary))<80 THEN 10 ELSE 0 END) AS priority_score
  FROM eligible e
),
issue_rows AS (SELECT * FROM scored WHERE cardinality(issue_codes)>0),
issue_counts AS (SELECT code, count(*) AS total FROM issue_rows CROSS JOIN LATERAL unnest(issue_codes) AS code GROUP BY code),
recent_issue_counts AS (SELECT code, count(*) AS total FROM issue_rows CROSS JOIN LATERAL unnest(issue_codes) AS code WHERE published_at>=now()-make_interval(days=>greatest(_recent_days,1)) GROUP BY code),
top_episodes AS (SELECT coalesce(jsonb_agg(item ORDER BY priority_score DESC),'[]'::jsonb) AS items FROM (SELECT jsonb_build_object('episode_id',id,'podcast_id',podcast_id,'podcast',coalesce(podcast_display_title,podcast_title),'title',coalesce(display_title,title),'rank_label',rank_label,'published_at',published_at,'priority_score',priority_score,'issue_codes',issue_codes) AS item, priority_score FROM issue_rows ORDER BY priority_score DESC, published_at DESC NULLS LAST LIMIT greatest(_sample_limit,1)) ranked)
SELECT jsonb_build_object(
  'generated_at',now(),'mode','fast_snapshot','recent_days',greatest(_recent_days,1),
  'eligible_hu_episodes',(SELECT count(*) FROM eligible),
  'recent_eligible_hu_episodes',(SELECT count(*) FROM eligible WHERE published_at>=now()-make_interval(days=>greatest(_recent_days,1))),
  'episodes_with_issues',(SELECT count(*) FROM issue_rows),
  'recent_episodes_with_issues',(SELECT count(*) FROM issue_rows WHERE published_at>=now()-make_interval(days=>greatest(_recent_days,1))),
  'issue_counts',coalesce((SELECT jsonb_object_agg(code,total) FROM issue_counts),'{}'::jsonb),
  'recent_issue_counts',coalesce((SELECT jsonb_object_agg(code,total) FROM recent_issue_counts),'{}'::jsonb),
  'top_episodes',(SELECT items FROM top_episodes));
$$;
GRANT EXECUTE ON FUNCTION public.get_data_quality_snapshot_v1(integer,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_data_repair_plan_v1(_limit integer DEFAULT 100, _recent_days integer DEFAULT 90, _include_ai boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
WITH candidates AS MATERIALIZED (
  SELECT e.id AS episode_id, e.podcast_id, p.title AS podcast_title, p.display_title AS podcast_display_title, p.rank_label, p.podiverzum_rank,
    e.title, e.display_title, e.published_at,
    CASE
      WHEN e.episode_rank IS DISTINCT FROM 1 OR e.episode_rank_label IS NOT NULL OR coalesce(e.episode_rank_reason,'{}'::jsonb)<>'{}'::jsonb THEN 'neutralize_legacy_episode_rank'
      WHEN e.clean_text_status IS DISTINCT FROM 'done' THEN 'clean_text_candidate'
      WHEN e.ai_summary IS NULL OR length(trim(e.ai_summary))<80 OR coalesce(e.ai_entities_version,0)<4 THEN 'ai_enrich_from_clean_text'
      WHEN e.audio_url IS NULL OR length(trim(e.audio_url))=0 THEN 'source_health_review'
      ELSE null END AS repair_action,
    array_remove(ARRAY[
      CASE WHEN e.episode_rank IS DISTINCT FROM 1 OR e.episode_rank_label IS NOT NULL OR coalesce(e.episode_rank_reason,'{}'::jsonb)<>'{}'::jsonb THEN 'legacy_episode_rank_active' END,
      CASE WHEN e.clean_text_status IS DISTINCT FROM 'done' THEN 'missing_clean_text' END,
      CASE WHEN e.ai_summary IS NULL OR length(trim(e.ai_summary))<80 THEN 'missing_summary' END,
      CASE WHEN coalesce(e.ai_entities_version,0)<4 THEN 'old_entity_version' END,
      CASE WHEN e.audio_url IS NULL OR length(trim(e.audio_url))=0 THEN 'missing_audio' END
    ], NULL) AS issue_codes,
    (CASE p.rank_label WHEN 'S' THEN 50 WHEN 'A' THEN 35 WHEN 'B' THEN 20 WHEN 'C' THEN 10 ELSE 3 END
     + least(greatest(coalesce(p.podiverzum_rank,0),0),10)::integer
     + CASE WHEN e.published_at>=now()-interval '30 days' THEN 20 ELSE 0 END
     + CASE WHEN e.published_at>=now()-interval '7 days' THEN 15 ELSE 0 END) AS priority_score
  FROM public.episodes e JOIN public.podcasts p ON p.id=e.podcast_id
  WHERE p.is_hungarian=true AND p.language_decision='accept_hungarian' AND p.rss_status<>ALL(ARRAY['failed','inactive'])
    AND (e.published_at IS NULL OR e.published_at>=now()-make_interval(days=>greatest(_recent_days,1)) OR p.rank_label IN ('S','A','B'))
),
eligible AS (
  SELECT *, repair_action IN ('clean_text_candidate','ai_enrich_from_clean_text') AS may_require_ai,
    CASE repair_action WHEN 'neutralize_legacy_episode_rank' THEN 1 WHEN 'clean_text_candidate' THEN 2 WHEN 'ai_enrich_from_clean_text' THEN 3 WHEN 'source_health_review' THEN 4 ELSE 9 END AS action_order
  FROM candidates WHERE repair_action IS NOT NULL AND (_include_ai OR repair_action NOT IN ('clean_text_candidate','ai_enrich_from_clean_text'))
),
ranked AS (SELECT *, row_number() OVER (ORDER BY action_order ASC, priority_score DESC, published_at DESC NULLS LAST) AS repair_rank FROM eligible),
limited AS (SELECT * FROM ranked WHERE repair_rank<=greatest(_limit,1)),
action_counts AS (SELECT repair_action, count(*) AS total FROM eligible GROUP BY repair_action),
items AS (SELECT coalesce(jsonb_agg(jsonb_build_object('rank',repair_rank,'episode_id',episode_id,'podcast_id',podcast_id,'podcast',coalesce(podcast_display_title,podcast_title),'title',coalesce(display_title,title),'rank_label',rank_label,'podiverzum_rank',podiverzum_rank,'published_at',published_at,'repair_action',repair_action,'issue_codes',issue_codes,'may_require_ai',may_require_ai,'priority_score',priority_score) ORDER BY repair_rank),'[]'::jsonb) AS rows FROM limited)
SELECT jsonb_build_object('generated_at',now(),'mode','fast_plan','dry_run',true,'limit',greatest(_limit,1),'recent_days',greatest(_recent_days,1),'include_ai',_include_ai,'eligible_repair_actions',(SELECT count(*) FROM eligible),'planned_repair_actions',(SELECT count(*) FROM limited),'action_counts',coalesce((SELECT jsonb_object_agg(repair_action,total) FROM action_counts),'{}'::jsonb),'items',(SELECT rows FROM items));
$$;
GRANT EXECUTE ON FUNCTION public.get_data_repair_plan_v1(integer,integer,boolean) TO authenticated, service_role;