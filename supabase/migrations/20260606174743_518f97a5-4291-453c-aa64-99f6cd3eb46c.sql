-- ===== canonical_entity_aliases registry reassert =====
CREATE OR REPLACE FUNCTION public.normalize_entity_alias(input text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT trim(regexp_replace(lower(translate(coalesce(input,''),
    'áàäâãåéèëêíìïîóòöőôõúùüűûñçÁÀÄÂÃÅÉÈËÊÍÌÏÎÓÒÖŐÔÕÚÙÜŰÛÑÇ',
    'aaaaaaeeeeiiiioooooouuuuuncAAAAAAEEEEIIIIOOOOOOUUUUUNC')),'[^a-z0-9]+',' ','g'));
$$;

CREATE TABLE IF NOT EXISTS public.canonical_entity_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_kind text NOT NULL CHECK (entity_kind IN ('topic','person','organization','podcast','category')),
  canonical_slug text NOT NULL, canonical_name text NOT NULL,
  alias text NOT NULL, normalized_alias text NOT NULL,
  language text NOT NULL DEFAULT 'hu',
  weight integer NOT NULL DEFAULT 10,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','candidate','rejected','deprecated')),
  source text NOT NULL DEFAULT 'manual', notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_kind, normalized_alias, canonical_slug)
);
CREATE INDEX IF NOT EXISTS canonical_entity_aliases_lookup_idx ON public.canonical_entity_aliases(entity_kind, normalized_alias) WHERE status='active';
CREATE INDEX IF NOT EXISTS canonical_entity_aliases_canonical_idx ON public.canonical_entity_aliases(entity_kind, canonical_slug) WHERE status='active';
ALTER TABLE public.canonical_entity_aliases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "canonical_entity_aliases public read" ON public.canonical_entity_aliases;
CREATE POLICY "canonical_entity_aliases public read" ON public.canonical_entity_aliases FOR SELECT USING (status='active');
DROP POLICY IF EXISTS "canonical_entity_aliases admin write" ON public.canonical_entity_aliases;
CREATE POLICY "canonical_entity_aliases admin write" ON public.canonical_entity_aliases FOR ALL
  USING (public.has_role(auth.uid(),'admin'::public.app_role)) WITH CHECK (public.has_role(auth.uid(),'admin'::public.app_role));

INSERT INTO public.canonical_entity_aliases (entity_kind,canonical_slug,canonical_name,alias,normalized_alias,language,weight,status,source,notes,updated_at)
SELECT 'topic',t.slug,t.name,ta.alias,
  COALESCE(NULLIF(ta.normalized_alias,''), public.normalize_entity_alias(ta.alias)),
  'hu', COALESCE(ta.weight,10),'active','topic_aliases_projection','reasserted_20260605', now()
FROM public.topic_aliases ta JOIN public.topics t ON t.id=ta.topic_id
WHERE ta.alias IS NOT NULL AND COALESCE(NULLIF(ta.normalized_alias,''), public.normalize_entity_alias(ta.alias))<>''
ON CONFLICT (entity_kind, normalized_alias, canonical_slug) DO UPDATE
SET canonical_name=EXCLUDED.canonical_name, alias=EXCLUDED.alias,
    weight=GREATEST(public.canonical_entity_aliases.weight, EXCLUDED.weight),
    status='active', source=EXCLUDED.source, notes=EXCLUDED.notes, updated_at=now();

INSERT INTO public.canonical_entity_aliases (entity_kind,canonical_slug,canonical_name,alias,normalized_alias,language,weight,status,source,notes,updated_at)
SELECT 'organization',o.slug,o.name,oa.alias,
  COALESCE(NULLIF(oa.normalized_alias,''), public.normalize_entity_alias(oa.alias)),
  'hu', GREATEST(10, ROUND(COALESCE(oa.confidence,0.5)*100)::int),'active','organization_aliases_projection','reasserted_20260605', now()
FROM public.organization_aliases oa JOIN public.organizations o ON o.id=oa.organization_id
WHERE oa.status='accepted' AND oa.alias IS NOT NULL AND COALESCE(o.slug,'')<>''
  AND COALESCE(NULLIF(oa.normalized_alias,''), public.normalize_entity_alias(oa.alias))<>''
ON CONFLICT (entity_kind, normalized_alias, canonical_slug) DO UPDATE
SET canonical_name=EXCLUDED.canonical_name, alias=EXCLUDED.alias,
    weight=GREATEST(public.canonical_entity_aliases.weight, EXCLUDED.weight),
    status='active', source=EXCLUDED.source, notes=EXCLUDED.notes, updated_at=now();

CREATE OR REPLACE VIEW public.v_canonical_topic_aliases AS
SELECT a.alias, a.normalized_alias, a.canonical_slug, a.canonical_name,
  t.id AS topic_id, t.domain, a.weight, a.source, a.updated_at
FROM public.canonical_entity_aliases a JOIN public.topics t ON t.slug=a.canonical_slug
WHERE a.entity_kind='topic' AND a.status='active' AND t.is_public=true;
GRANT SELECT ON public.v_canonical_topic_aliases TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_canonical_entity_alias(p_entity_kind text, p_alias text)
RETURNS TABLE(entity_kind text, canonical_slug text, canonical_name text, normalized_alias text, weight integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT a.entity_kind, a.canonical_slug, a.canonical_name, a.normalized_alias, a.weight
  FROM public.canonical_entity_aliases a
  WHERE a.entity_kind=p_entity_kind AND a.status='active'
    AND a.normalized_alias=public.normalize_entity_alias(p_alias)
  ORDER BY a.weight DESC, a.updated_at DESC LIMIT 1;
$$;

GRANT SELECT ON public.canonical_entity_aliases TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_canonical_entity_alias(text,text) TO anon, authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'canonical_alias_policy',
  jsonb_build_object('version','canonical_aliases_reassert_20260605','source_table','canonical_entity_aliases',
    'topic_projection','topic_aliases','organization_projection','organization_aliases',
    'active_seed_count',(SELECT count(*) FROM public.canonical_entity_aliases WHERE status='active')),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- ===== temporal_person_public_guard v5: suspicious participant cleanup =====
UPDATE public.people p SET
  date_of_death=NULL, is_living=NULL, wikidata_id=NULL, wikipedia_title=NULL, wikipedia_url=NULL,
  wikipedia_extract=NULL, wikipedia_description=NULL,
  wikipedia_match_status='needs_review', wikipedia_match_confidence=0,
  image_status=CASE WHEN p.image_url IS NOT NULL THEN 'needs_review' ELSE COALESCE(p.image_status,'none') END,
  image_original_url=NULL, image_attribution=NULL, image_license=NULL,
  identity_ambiguous=true, ai_review_status='needs_human_review',
  editorial_notes=trim(both E'\n' from concat_ws(E'\n', nullif(p.editorial_notes,''), 'temporal_person_public_guard_v5')),
  updated_at=now()
WHERE COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
  AND COALESCE(p.is_deceased,false)=false AND COALESCE(p.is_historical,false)=false
  AND COALESCE(p.persona,'')<>'historical'
  AND (p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
  AND (COALESCE(p.participant_count,0)+COALESCE(p.host_count,0)+COALESCE(p.guest_count,0))>0;

-- ===== strict_temporal_person_guard v6 =====
WITH demoted AS (
  UPDATE public.people p SET
    is_public=false, is_indexable=false, is_browsable_in_people_hub=false, activation_status='inactive',
    ai_recommended_action=CASE WHEN (COALESCE(p.participant_count,0)+COALESCE(p.host_count,0)+COALESCE(p.guest_count,0))>0 THEN 'review' ELSE 'hide' END,
    ai_review_status=CASE WHEN (COALESCE(p.participant_count,0)+COALESCE(p.host_count,0)+COALESCE(p.guest_count,0))>0 THEN 'needs_human_review' ELSE COALESCE(p.ai_review_status,'reviewed') END,
    identity_ambiguous=CASE WHEN (COALESCE(p.participant_count,0)+COALESCE(p.host_count,0)+COALESCE(p.guest_count,0))>0 THEN true ELSE COALESCE(p.identity_ambiguous,false) END,
    browsable_reason='strict_temporal_person_guard_v6',
    editorial_notes=trim(both E'\n' from concat_ws(E'\n', nullif(p.editorial_notes,''), 'strict_temporal_person_guard_v6')),
    updated_at=now()
  WHERE COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
    AND (p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona='historical'
         OR p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
    AND (p.is_public IS TRUE OR p.is_indexable IS TRUE OR p.is_browsable_in_people_hub IS TRUE
         OR p.activation_status<>'inactive' OR COALESCE(p.ai_recommended_action,'') NOT IN ('hide','review')
         OR ((COALESCE(p.participant_count,0)+COALESCE(p.host_count,0)+COALESCE(p.guest_count,0))>0
             AND COALESCE(p.ai_review_status,'')<>'needs_human_review'))
  RETURNING p.id
),
rejaliases AS (
  UPDATE public.person_aliases pa SET status='rejected', source='strict_temporal_person_guard_v6'
  FROM public.people p
  WHERE pa.person_id=p.id
    AND COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
    AND (p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona='historical'
         OR p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
  RETURNING pa.id
)
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'temporal_person_public_guard_policy',
  jsonb_build_object('version',6,
    'demoted_temporal_people_count',(SELECT count(*) FROM demoted),
    'rejected_temporal_alias_count',(SELECT count(*) FROM rejaliases),
    'rule','Dead/historical not public/indexable without manual_approved or has_archival_evidence.',
    'participant_collision_rule','Fail closed.'),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- ===== article pairer v4 sources =====
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'episode_article_pairer_controls',
  jsonb_build_object(
    'enabled', true, 'policy','publisher_article_match_v1', 'source_version','publisher_sources_v4',
    'batch_limit',220,'sources_per_run',3,'article_feed_item_limit',120,'max_article_fetches_per_run',40,
    'fetch_article_html',true,'recent_episode_days',90,'recent_article_days',90,
    'auto_confirm_threshold',0.82,'needs_review_threshold',0.68,
    'sources', jsonb_build_array(
      jsonb_build_object('outlet','444','feed_urls',jsonb_build_array('https://444.hu/feed'),
        'listing_urls',jsonb_build_array('https://444.hu/category/podcast','https://444.hu/cimke/podcast'),
        'podcast_title_patterns',jsonb_build_array('444','borízű','tyúkól','saját tőke','háromharmad')),
      jsonb_build_object('outlet','telex','feed_urls',jsonb_build_array('https://telex.hu/rss?tag=podcast','https://telex.hu/rss'),
        'listing_urls',jsonb_build_array('https://telex.hu/rovat/podcast','https://telex.hu/cimke/podcast'),
        'podcast_title_patterns',jsonb_build_array('telex','after','nyomozó','ízfokozó','téma','filmklub')),
      jsonb_build_object('outlet','hvg','feed_urls',jsonb_build_array('https://hvg.hu/rss','https://hvg.hu/rss/podcast'),
        'listing_urls',jsonb_build_array('https://hvg.hu/podcastok','https://hvg.hu/itthon/podcast','https://hvg.hu/gazdasag/podcast','https://hvg.hu/tudomany/podcast'),
        'podcast_title_patterns',jsonb_build_array('hvg','fülke','közélet','gazdaság','tech','tudomány')),
      jsonb_build_object('outlet','portfolio','feed_urls',jsonb_build_array('https://www.portfolio.hu/rss/all.xml'),
        'listing_urls',jsonb_build_array('https://www.portfolio.hu/podcast','https://www.portfolio.hu/uzlet/podcast'),
        'podcast_title_patterns',jsonb_build_array('portfolio','checklist','portfolio checklist','biznisz','forint','tőzsde')),
      jsonb_build_object('outlet','hold','feed_urls',jsonb_build_array('https://hold.hu/holdblog/feed/'),
        'listing_urls',jsonb_build_array('https://hold.hu/holdblog/','https://hold.hu/holdblog/tag/podcast/','https://hold.hu/holdblog/tag/hold-after-hours/'),
        'podcast_title_patterns',jsonb_build_array('hold','hold after hours','holdblog','after hours','befektetés')),
      jsonb_build_object('outlet','partizan','feed_urls',jsonb_build_array('https://www.partizan.hu/rss.xml'),
        'listing_urls',jsonb_build_array('https://www.partizan.hu/podcastok','https://www.partizan.hu/blog'),
        'podcast_title_patterns',jsonb_build_array('partizán','partizan','vétó','partizán podcast','háromharmad')),
      jsonb_build_object('outlet','qubit','feed_urls',jsonb_build_array('https://qubit.hu/feed'),
        'listing_urls',jsonb_build_array('https://qubit.hu/tag/podcast'),
        'podcast_title_patterns',jsonb_build_array('qubit','qubit podcast'))
    )), now()
) ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at=now();

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'database_quality_fast_lane',
  jsonb_build_object('run_article_pairer',true,'article_pairer_limit',220,'article_pairer_sources_per_run',3,'run_best_text_source',true),
  now()) ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || EXCLUDED.value, updated_at=now();

-- ===== episode_article_candidates readonly verifier =====
DO $$
BEGIN
  IF to_regclass('public.episode_article_candidates') IS NOT NULL THEN
    DROP POLICY IF EXISTS "episode article candidates readonly verifier read" ON public.episode_article_candidates;
    CREATE POLICY "episode article candidates readonly verifier read"
      ON public.episode_article_candidates FOR SELECT USING (current_user='readonly_codex');
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='readonly_codex') THEN
      GRANT SELECT ON public.episode_article_candidates TO readonly_codex;
    END IF;
  END IF;
END $$;

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'episode_article_candidate_readonly_policy',
  jsonb_build_object('version',1,'policy','episode article candidates readonly verifier read','role','readonly_codex'),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- ===== news sitemap GSC PUT submit + 404 cleanup =====
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'news_sitemap_refresh_controls',
  jsonb_build_object('enabled',true,'cadence_minutes',15,'mode','refresh_sitemap_lite',
    'google_submit_policy','submit_only_when_news_sitemap_has_new_urls',
    'submit_transport','lovable_google_search_console_connector_gateway',
    'submit_method','PUT','site_url','https://podiverzum.hu/',
    'requires_connector_secrets',jsonb_build_array('LOVABLE_API_KEY','GOOGLE_SEARCH_CONSOLE_API_KEY'),
    'connector_404_policy','record_route_missing_without_google_submit_status_404'),
  now()) ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value - 'requires_google_secrets' || EXCLUDED.value, updated_at=now();

UPDATE public.app_settings
SET value = value || jsonb_build_object(
    'google_submit_status', NULL,
    'google_submit_reason','lovable_gsc_connector_route_missing_404',
    'google_submit_method','PUT', 'submit_needed', true,
    'connector_route_missing_status', 404),
  updated_at=now()
WHERE key='news_sitemap_state' AND value->>'google_submit_status'='404';

-- ===== related_quality_policy_v5_settings + public_affairs_override_terms =====
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'related_episode_quality_policy',
  jsonb_build_object('version',5,'religion_cross_group','hard_block',
    'children_cross_group','hard_block_except_children_source_with_explicit_bridge',
    'different_specific_groups','explicit_bridge_required',
    'specific_to_general','explicit_bridge_required','general_to_specific','explicit_bridge_required',
    'same_specific_group_min_similarity_without_bridge',0.70,
    'general_min_similarity_without_bridge',0.82,
    'public_affairs_override_terms',jsonb_build_array('orbán','mészáros','fidesz','tisza','kormány','parlament','párt','választás','puzsér','ner'),
    'bridge_sources',jsonb_build_array('topics','people','mentioned','companies'),
    'reasserted_by','20260605215000_reassert_related_public_affairs_override_terms'),
  now()) ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'version', GREATEST(COALESCE((public.app_settings.value->>'version')::int,0),5),
    'public_affairs_override_terms',jsonb_build_array('orbán','mészáros','fidesz','tisza','kormány','parlament','párt','választás','puzsér','ner'),
    'bridge_sources',jsonb_build_array('topics','people','mentioned','companies')),
  updated_at=now();
