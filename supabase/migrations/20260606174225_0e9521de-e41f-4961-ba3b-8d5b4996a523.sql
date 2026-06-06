-- Recommendation v4 functions
CREATE OR REPLACE FUNCTION public.recommendation_text_group(
  p_title text, p_podcast_title text, p_category text, p_topics text[]
) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $function$
  WITH text_blob AS (
    SELECT lower(coalesce(p_title,'') || ' ' || coalesce(p_podcast_title,'') || ' ' ||
      coalesce(p_category,'') || ' ' || array_to_string(coalesce(p_topics, ARRAY[]::text[]), ' ')) AS t
  )
  SELECT CASE
    WHEN t ~ '(mese|meseradio|meserádió|gyerek|gyermek|ovis|óvodás|altató|tündér|baba|esti mese|kids|children|family)' THEN 'children'
    WHEN t ~ '(közélet|kozelet|politika|politics|hírek|hirek|társadalom|tarsadalom|interjú|interju|közbeszéd|kozbeszed|orbán|orban|mészáros|meszaros|fidesz|tisza|kormány|kormany|parlament|párt|part|választás|valasztas|puzsér|puzser|miniszter|ellenzék|ellenzek|önkormányzat|onkormanyzat|hatalom|ner|oligarcha)' THEN 'public_affairs'
    WHEN t ~ '(vallás|vallas|hit|keresztény|kereszteny|isten|biblia|egyház|egyhaz|istentisztelet|igehirdetés|igehirdetes|prédikáció|predikacio|katolikus|református|reformatus|baptista|evangélium|evangelium|áhítat|ahitat|religion|spirituality)' THEN 'religion'
    WHEN t ~ '(üzlet|uzlet|business|gazdaság|gazdasag|pénz|penz|tőzsde|tozsde|befektetés|befektetes|milliárdos|milliardos|cég|ceg|vállalkozás|vallalkozas|ingatlan|karrier|menedzsment|részvény|reszveny|árfolyam|arfolyam|bank|startup)' THEN 'business'
    WHEN t ~ '(sport|foci|futball|labdarúgás|labdarugas|nb1|válogatott|valogatott|meccs|forma-1|formula|kosár|kosar|kézilabda|kezilabda|tenisz|bringa|cycling)' THEN 'sports'
    WHEN t ~ '(egészség|egeszseg|orvos|pszicho|mentális|mentalis|életmód|eletmod)' THEN 'health'
    WHEN t ~ '(film|mozi|sorozat|zene|kultúra|kultura|színház|szinhaz|standup|stand-up|humor|gaming|játék|jatek|bulvár|bulvar)' THEN 'entertainment'
    ELSE 'general' END FROM text_blob;
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_has_topic_bridge(p_source_topics text[], p_candidate_topics text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $function$
  SELECT EXISTS (SELECT 1 FROM unnest(coalesce(p_source_topics, ARRAY[]::text[])) s(topic)
    JOIN unnest(coalesce(p_candidate_topics, ARRAY[]::text[])) c(topic) ON lower(s.topic) = lower(c.topic));
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_is_compatible(
  p_source_group text, p_candidate_group text, p_similarity double precision, p_has_topic_bridge boolean
) RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path TO 'public' AS $function$
  SELECT CASE
    WHEN (p_source_group='religion') <> (p_candidate_group='religion') THEN false
    WHEN p_candidate_group='children' AND p_source_group <> 'children' THEN false
    WHEN p_source_group='children' AND p_candidate_group <> 'children' AND NOT p_has_topic_bridge THEN false
    WHEN p_source_group <> 'general' AND p_candidate_group <> 'general' AND p_source_group <> p_candidate_group THEN p_has_topic_bridge
    WHEN p_source_group <> 'general' AND p_candidate_group='general' THEN p_has_topic_bridge OR coalesce(p_similarity,0)>=0.74
    WHEN p_candidate_group <> 'general' AND p_source_group='general' THEN p_has_topic_bridge OR coalesce(p_similarity,0)>=0.74
    WHEN p_source_group <> 'general' AND p_source_group=p_candidate_group THEN p_has_topic_bridge OR coalesce(p_similarity,0)>=0.58
    ELSE p_has_topic_bridge OR coalesce(p_similarity,0)>=0.62 END;
$function$;

GRANT EXECUTE ON FUNCTION public.recommendation_text_group(text,text,text,text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recommendation_has_topic_bridge(text[],text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recommendation_is_compatible(text,text,double precision,boolean) TO anon, authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'related_episode_quality_policy',
  jsonb_build_object('version',4,'religion_cross_group','hard_block','children_cross_group','hard_block_except_children_source_with_explicit_bridge',
    'different_specific_groups','explicit_bridge_required','specific_to_general_min_similarity_without_bridge',0.74,
    'same_specific_group_min_similarity_without_bridge',0.58,'general_min_similarity_without_bridge',0.62,
    'public_affairs_override_terms', jsonb_build_array('orbán','mészáros','fidesz','tisza','kormány','parlament','párt','választás','puzsér','ner')),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- News sitemap policy
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'news_sitemap_refresh_controls',
  jsonb_build_object('enabled',true,'cadence_minutes',15,'mode','refresh_sitemap_lite',
    'google_submit_policy','submit_only_when_news_sitemap_has_new_urls',
    'submit_transport','lovable_google_search_console_connector_gateway',
    'site_url','https://podiverzum.hu/',
    'requires_connector_secrets', jsonb_build_array('LOVABLE_API_KEY','GOOGLE_SEARCH_CONSOLE_API_KEY')),
  now()) ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value - 'requires_google_secrets' || EXCLUDED.value, updated_at=now();

-- High-value orgs
WITH canonical(slug, name, normalized_name, org_type, priority) AS (
  VALUES
    ('magyar-telekom','Magyar Telekom', public.normalize_entity_alias('Magyar Telekom'),'company',95),
    ('ferencvarosi-torna-club','Ferencvárosi Torna Club', public.normalize_entity_alias('Ferencvárosi Torna Club'),'sport_team',95),
    ('otp-bank','OTP Bank', public.normalize_entity_alias('OTP Bank'),'company',90),
    ('mol','MOL', public.normalize_entity_alias('MOL'),'company',90),
    ('richter-gedeon-nyrt','Richter Gedeon Nyrt.', public.normalize_entity_alias('Richter Gedeon Nyrt.'),'company',88),
    ('4ig','4iG', public.normalize_entity_alias('4iG'),'company',86),
    ('mav','MÁV', public.normalize_entity_alias('MÁV'),'institution',84),
    ('bkk','BKK', public.normalize_entity_alias('BKK'),'institution',84),
    ('mvm','MVM', public.normalize_entity_alias('MVM'),'company',84)
)
INSERT INTO public.organizations (slug, name, normalized_name, org_type, manually_seeded, editorial_priority, editorial_priority_level, is_public, is_indexable, is_browsable_in_hub, browsable_reason, editorial_notes, updated_at)
SELECT slug, name, normalized_name, org_type, true, true, priority, true, true, true, 'high_value_alias_seed','high_value_hu_alias_canonical', now() FROM canonical
ON CONFLICT (slug) DO UPDATE SET
  name=EXCLUDED.name, normalized_name=EXCLUDED.normalized_name, org_type=EXCLUDED.org_type,
  manually_seeded=true, editorial_priority=true,
  editorial_priority_level=GREATEST(public.organizations.editorial_priority_level, EXCLUDED.editorial_priority_level),
  is_public=true, is_indexable=true, is_browsable_in_hub=true,
  browsable_reason=COALESCE(public.organizations.browsable_reason,'high_value_alias_seed'),
  editorial_notes=trim(both E'\n' from concat_ws(E'\n', public.organizations.editorial_notes, 'high_value_hu_alias_canonical')),
  updated_at=now();

-- Aliases (DISTINCT ON to avoid duplicate normalized values)
WITH seed_raw(canonical_slug, canonical_name, alias, confidence, notes) AS (
  VALUES
    ('magyar-telekom','Magyar Telekom','Telekom',0.99,'common_brand_alias'),
    ('magyar-telekom','Magyar Telekom','Magyar Telekom',1.00,'canonical_name'),
    ('magyar-telekom','Magyar Telekom','MTELEKOM',0.99,'ticker_alias'),
    ('magyar-telekom','Magyar Telekom','MTEL',0.99,'ticker_alias'),
    ('magyar-telekom','Magyar Telekom','Magyar Telekom Nyrt',0.98,'legal_name'),
    ('magyar-telekom','Magyar Telekom','Magyar Telekom Nyrt.',0.98,'legal_name'),
    ('magyar-telekom','Magyar Telekom','Telekom HU',0.95,'brand_alias'),
    ('magyar-telekom','Magyar Telekom','Telekom Hungary',0.95,'brand_alias'),
    ('magyar-telekom','Magyar Telekom','T-Mobile Hungary',0.85,'legacy_brand_alias'),
    ('ferencvarosi-torna-club','Ferencvárosi Torna Club','Fradi',0.99,'common_sport_alias'),
    ('ferencvarosi-torna-club','Ferencvárosi Torna Club','FTC',0.99,'common_sport_alias'),
    ('ferencvarosi-torna-club','Ferencvárosi Torna Club','Ferencváros',0.98,'common_short_name'),
    ('ferencvarosi-torna-club','Ferencvárosi Torna Club','Ferencvárosi Torna Club',1.00,'canonical_name'),
    ('ferencvarosi-torna-club','Ferencvárosi Torna Club','Ferencvárosi Torna Klub',0.98,'orthographic_variant'),
    ('ferencvarosi-torna-club','Ferencvárosi Torna Club','Ferencvárosi TC',0.95,'common_abbreviation'),
    ('ferencvarosi-torna-club','Ferencvárosi Torna Club','FTC-Telekom',0.85,'sponsor_name_variant'),
    ('ferencvarosi-torna-club','Ferencvárosi Torna Club','fradi.hu',0.80,'site_variant'),
    ('otp-bank','OTP Bank','OTP',0.98,'ticker_alias'),
    ('otp-bank','OTP Bank','OTP Bank',1.00,'canonical_name'),
    ('otp-bank','OTP Bank','OTP Bank Nyrt',0.98,'legal_name'),
    ('otp-bank','OTP Bank','OTP Bank Nyrt.',0.98,'legal_name'),
    ('mol','MOL','MOL',1.00,'ticker_alias'),
    ('mol','MOL','MOL Nyrt',0.98,'legal_name'),
    ('mol','MOL','MOL Nyrt.',0.98,'legal_name'),
    ('richter-gedeon-nyrt','Richter Gedeon Nyrt.','Richter',0.98,'brand_alias'),
    ('richter-gedeon-nyrt','Richter Gedeon Nyrt.','Richter Gedeon',1.00,'canonical_name'),
    ('richter-gedeon-nyrt','Richter Gedeon Nyrt.','Gedeon Richter',0.98,'name_order_variant'),
    ('richter-gedeon-nyrt','Richter Gedeon Nyrt.','Richter Gedeon Nyrt',0.98,'legal_name'),
    ('richter-gedeon-nyrt','Richter Gedeon Nyrt.','Richter Gedeon Nyrt.',0.98,'legal_name'),
    ('4ig','4iG','4iG',1.00,'ticker_alias'),
    ('4ig','4iG','4IG',0.98,'case_variant'),
    ('4ig','4iG','4iG Nyrt',0.98,'legal_name'),
    ('4ig','4iG','4iG Nyrt.',0.98,'legal_name'),
    ('mav','MÁV','MÁV',1.00,'institution_alias'),
    ('mav','MÁV','MAV',0.98,'accentless_alias'),
    ('mav','MÁV','MÁV Csoport',0.98,'group_alias'),
    ('mav','MÁV','MAV Csoport',0.96,'accentless_group_alias'),
    ('mav','MÁV','MÁV-START',0.92,'subsidiary_alias'),
    ('mav','MÁV','MAV-START',0.90,'accentless_subsidiary_alias'),
    ('bkk','BKK','BKK',1.00,'institution_alias'),
    ('bkk','BKK','Budapesti Közlekedési Központ',1.00,'legal_name'),
    ('bkk','BKK','Budapesti Kozlekedesi Kozpont',0.98,'accentless_legal_name'),
    ('mvm','MVM','MVM',1.00,'company_alias'),
    ('mvm','MVM','MVM Csoport',0.98,'group_alias'),
    ('mvm','MVM','Magyar Villamos Művek',1.00,'legal_name'),
    ('mvm','MVM','Magyar Villamos Muvek',0.98,'accentless_legal_name')
),
seed AS (
  SELECT DISTINCT ON (canonical_slug, public.normalize_entity_alias(alias))
    canonical_slug, canonical_name, alias, confidence, notes,
    public.normalize_entity_alias(alias) AS normalized_alias
  FROM seed_raw
  ORDER BY canonical_slug, public.normalize_entity_alias(alias), confidence DESC
)
INSERT INTO public.canonical_entity_aliases (entity_kind, canonical_slug, canonical_name, alias, normalized_alias, weight, status, source, notes, updated_at)
SELECT 'organization', canonical_slug, canonical_name, alias, normalized_alias,
  round(confidence*100)::int, 'active','high_value_hu_alias_extension', notes, now()
FROM seed
ON CONFLICT (entity_kind, normalized_alias, canonical_slug) DO UPDATE SET
  canonical_name=EXCLUDED.canonical_name, alias=EXCLUDED.alias,
  weight=GREATEST(public.canonical_entity_aliases.weight, EXCLUDED.weight),
  status='active', source=EXCLUDED.source, notes=EXCLUDED.notes, updated_at=now();

WITH src AS (
  SELECT DISTINCT ON (a.normalized_alias)
    o.id AS organization_id, a.alias, a.normalized_alias,
    LEAST(1.0, GREATEST(0.45, a.weight::numeric/100.0)) AS confidence
  FROM public.canonical_entity_aliases a
  JOIN public.organizations o ON o.slug = a.canonical_slug
  WHERE a.entity_kind='organization' AND a.status='active' AND a.source='high_value_hu_alias_extension'
  ORDER BY a.normalized_alias, a.weight DESC
)
INSERT INTO public.organization_aliases (organization_id, alias, normalized_alias, source, confidence, status)
SELECT organization_id, alias, normalized_alias, 'high_value_hu_alias_extension', confidence, 'accepted' FROM src
ON CONFLICT (normalized_alias) DO UPDATE SET
  organization_id=EXCLUDED.organization_id, alias=EXCLUDED.alias,
  confidence=GREATEST(public.organization_aliases.confidence, EXCLUDED.confidence),
  status='accepted', source=EXCLUDED.source;

-- Richter Gedeon as person: hide
UPDATE public.people SET
  is_public=false, is_indexable=false, activation_status='inactive',
  ai_recommended_action='reject', ai_review_status='reviewed',
  editorial_notes=trim(both E'\n' from concat_ws(E'\n', editorial_notes,'hidden_as_company_eponym_without_podcast_person_evidence')),
  updated_at=now()
WHERE slug IN ('richter-gedeon','gedeon-richter')
  AND COALESCE(has_archival_evidence,false)=false AND COALESCE(manual_approved,false)=false;

UPDATE public.person_aliases pa SET status='rejected', source='hidden_as_company_eponym_without_podcast_person_evidence'
FROM public.people p WHERE pa.person_id=p.id AND p.slug IN ('richter-gedeon','gedeon-richter')
  AND COALESCE(p.has_archival_evidence,false)=false AND COALESCE(p.manual_approved,false)=false;

-- Eponym mark
WITH marked AS (
  SELECT public.normalize_entity_alias(alias) AS normalized_alias FROM (VALUES ('Richter Gedeon'),('Gedeon Richter')) v(alias)
)
UPDATE public.canonical_entity_aliases cea
SET notes=trim(both E'\n' from concat_ws(E'\n', cea.notes,'eponym_person_name')), updated_at=now()
FROM marked m
WHERE cea.entity_kind='organization' AND cea.canonical_slug='richter-gedeon-nyrt'
  AND cea.normalized_alias=m.normalized_alias AND COALESCE(cea.notes,'') NOT ILIKE '%eponym_person_name%';

WITH eponym_aliases AS (
  SELECT DISTINCT normalized_alias FROM public.canonical_entity_aliases
  WHERE entity_kind='organization' AND status='active' AND COALESCE(notes,'') ILIKE '%eponym_person_name%'
)
UPDATE public.people p
SET is_public=false, is_indexable=false, activation_status='inactive',
    ai_recommended_action='reject', ai_review_status='reviewed', is_historical=true, is_deceased=true,
    editorial_notes=trim(both E'\n' from concat_ws(E'\n', p.editorial_notes,'hidden_as_company_eponym_without_podcast_person_evidence')),
    updated_at=now()
WHERE COALESCE(p.has_archival_evidence,false)=false AND COALESCE(p.manual_approved,false)=false
  AND EXISTS (SELECT 1 FROM eponym_aliases ea WHERE ea.normalized_alias=p.normalized_name OR ea.normalized_alias=public.normalize_entity_alias(p.name));

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'company_eponym_person_policy',
  jsonb_build_object('version',1,'rule','organization_alias_with_eponym_person_name_note_is_not_public_person_without_manual_or_archival_evidence','example','Richter Gedeon -> Richter Gedeon Nyrt.','updated_at', now()),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- people_alpha_letter_counts
CREATE OR REPLACE FUNCTION public.people_alpha_letter_counts()
RETURNS TABLE(letter text, count bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  WITH base AS (
    SELECT CASE WHEN upper(unaccent(left(name,1))) ~ '^[A-Z]$' THEN upper(unaccent(left(name,1))) ELSE '#' END AS l
    FROM public.people p
    WHERE p.is_public=true AND p.is_indexable=true AND p.is_browsable_in_people_hub=true
      AND COALESCE(p.gated_episode_count,0)>=1
      AND COALESCE(p.activation_status,'indexable') IN ('indexable','manual_approved')
      AND COALESCE(p.ai_recommended_action,'') NOT IN ('hide','reject')
      AND COALESCE(p.ai_review_status,'') NOT IN ('needs_human_review','duplicate_candidate')
      AND COALESCE(p.identity_status,'') <> 'split_resolved'
      AND NOT (COALESCE(p.identity_ambiguous,false)=true AND COALESCE(p.manual_approved,false)=false
        AND NOT (p.wikipedia_match_status='verified' AND COALESCE(p.wikipedia_match_confidence,0)>=0.8))
  ) SELECT l, count(*)::bigint FROM base GROUP BY l ORDER BY l;
$$;
GRANT EXECUTE ON FUNCTION public.people_alpha_letter_counts() TO anon, authenticated;

-- Religion category guard v2
WITH candidates AS (
  SELECT p.id, p.category AS old_category,
    lower(unaccent(concat_ws(' ', p.title, p.display_title, p.slug, p.website_url, p.rss_url))) AS titleish,
    lower(unaccent(coalesce(p.description,''))) AS description_text
  FROM public.podcasts p
  WHERE (p.is_hungarian=true OR p.language_decision='accept_hungarian')
    AND COALESCE(p.rss_status,'') NOT IN ('failed','inactive','deleted','blocked','dead')
    AND COALESCE(p.category,'') <> 'Religion & Spirituality'
),
religious_candidates AS (
  SELECT id, old_category,
    CASE
      WHEN titleish ~ '\m(zarandok|maria ut|golgota|gyulekezet|baptista|adventista|katolikus|reformatus|evangelikus|istentisztelet|predikacio|igehirdetes|biblia|ahitat|evangelium|teologia|plebania|templom|lelki gyakorlat|lelkigyakorlat|hit gyulekezete|kereszteny)\M' THEN 'strong_religion_title_or_url_signal'
      WHEN description_text ~ '\m(zarandok|maria ut|golgota|gyulekezet|baptista|adventista|katolikus|reformatus|evangelikus|istentisztelet|predikacio|igehirdetes|biblia|ahitat|evangelium|teologia|plebania|templom|lelki gyakorlat|lelkigyakorlat|hit gyulekezete|kereszteny)\M'
        AND description_text ~ '\m(vallas|hit|isten|ima|imadsag|lelki|szentiras|pap|puspok|atya|jezus|krisztus|egyhazi|egyhaz)\M'
        AND titleish !~ '\m(isten[, ]+orban|orban|politika|valasztas|reszveny|tozsde|befektetes|milliardos|film|zene|etterem|bor|kave|gasztro)\M' THEN 'multiple_religion_description_signals'
      ELSE NULL END AS reason
  FROM candidates
),
updated AS (
  UPDATE public.podcasts p
  SET category='Religion & Spirituality',
      ai_category_alt=COALESCE(p.ai_category_alt, rc.old_category),
      ai_category_confidence=GREATEST(COALESCE(p.ai_category_confidence,0),0.88),
      ai_category_needs_review=false, ai_category_model='deterministic-category-guard-v2', ai_category_at=now(),
      shadow_rank_components=COALESCE(p.shadow_rank_components,'{}'::jsonb) || jsonb_build_object('category_repair', jsonb_build_object('version','deterministic_category_guard_v2','old_category',rc.old_category,'reason',rc.reason))
  FROM religious_candidates rc WHERE p.id=rc.id AND rc.reason IS NOT NULL RETURNING p.id
)
INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'podcast_category_guard_policy',
  jsonb_build_object('version',2,'religion_rule','Strong channel/publisher identity signals force Religion & Spirituality.','updated_rows',(SELECT count(*) FROM updated),'updated_at', now()),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- Deceased person guard
UPDATE public.people p
SET is_public=false, is_indexable=false, is_browsable_in_people_hub=false,
    activation_status='inactive', ai_recommended_action='hide', browsable_reason='strict_deceased_person_guard_v2',
    editorial_notes=concat_ws(E'\n', nullif(p.editorial_notes,''), 'strict_deceased_person_guard_v2'),
    updated_at=now()
WHERE COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
  AND (p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona='historical'
       OR ((p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
           AND ((p.wikipedia_match_status='verified' AND COALESCE(p.wikipedia_match_confidence,0)>=0.8)
                OR COALESCE(p.participant_count,0)+COALESCE(p.host_count,0)+COALESCE(p.guest_count,0)=0)))
  AND (p.is_public IS TRUE OR p.is_indexable IS TRUE OR p.is_browsable_in_people_hub IS TRUE);

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'temporal_person_public_guard_policy',
  jsonb_build_object('version',2,'rule','Deceased/historical not public/indexable without manual_approved or has_archival_evidence.'),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

INSERT INTO public.app_settings (key, value, updated_at) VALUES (
  'person_wikidata_temporal_metadata_policy',
  jsonb_build_object('version',1,'source','Wikidata claims','date_of_birth_claim','P569','date_of_death_claim','P570','human_claim','P31=Q5','runner','person-wikimedia-enricher'),
  now()) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now();

-- list_people_hub v2
DROP FUNCTION IF EXISTS public.list_people_hub(integer, integer, text);
CREATE OR REPLACE FUNCTION public.list_people_hub(p_limit integer DEFAULT 60, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, slug text, name text, disambiguation_label text, short_bio text, ai_bio text, image_url text,
  identity_ambiguous boolean, manual_approved boolean, ai_bio_status text, ai_bio_confidence numeric,
  wikipedia_match_status text, wikipedia_match_confidence numeric,
  episode_count integer, podcast_count integer, distinct_podcast_count integer,
  gated_episode_count integer, gated_podcast_count integer, host_count integer, guest_count integer,
  strong_mention_count integer, recent_relevant_episode_count_30d integer,
  latest_accepted_relevant_episode_at timestamp with time zone, people_hub_score numeric, total_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH base AS (
    SELECT * FROM public.people p
    WHERE p.is_browsable_in_people_hub=true
      AND NOT (COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
        AND (p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona='historical'
             OR ((p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
                 AND ((p.wikipedia_match_status='verified' AND COALESCE(p.wikipedia_match_confidence,0)>=0.8)
                      OR COALESCE(p.participant_count,0)+COALESCE(p.host_count,0)+COALESCE(p.guest_count,0)=0))))
      AND (p_search IS NULL OR length(trim(p_search))<2
           OR p.normalized_name ILIKE '%' || lower(trim(p_search)) || '%'
           OR p.name ILIKE '%' || trim(p_search) || '%')
  ), counted AS (SELECT COUNT(*)::bigint AS tc FROM base)
  SELECT b.id,b.slug,b.name,b.disambiguation_label,b.short_bio,b.ai_bio,b.image_url,
    b.identity_ambiguous,b.manual_approved,b.ai_bio_status,b.ai_bio_confidence,
    b.wikipedia_match_status,b.wikipedia_match_confidence,
    b.episode_count,b.podcast_count,b.distinct_podcast_count,
    b.gated_episode_count,b.gated_podcast_count,b.host_count,b.guest_count,
    b.strong_mention_count,b.recent_relevant_episode_count_30d,
    b.latest_accepted_relevant_episode_at,b.people_hub_score,c.tc
  FROM base b CROSS JOIN counted c
  ORDER BY b.people_hub_score DESC NULLS LAST, b.gated_episode_count DESC, b.name ASC
  LIMIT GREATEST(LEAST(p_limit,200),1) OFFSET GREATEST(p_offset,0);
$function$;

DROP FUNCTION IF EXISTS public.list_people_alpha(text, integer, integer);
CREATE OR REPLACE FUNCTION public.list_people_alpha(p_letter text DEFAULT NULL::text, p_limit integer DEFAULT 60, p_offset integer DEFAULT 0)
 RETURNS TABLE(id uuid, slug text, name text, disambiguation_label text, short_bio text, ai_bio text, image_url text,
  identity_ambiguous boolean, manual_approved boolean, ai_bio_status text, ai_bio_confidence numeric,
  wikipedia_match_status text, wikipedia_match_confidence numeric,
  gated_episode_count integer, gated_podcast_count integer, episode_count integer, podcast_count integer,
  latest_accepted_relevant_episode_at timestamp with time zone, host_count integer, guest_count integer,
  strong_mention_count integer, total_count bigint)
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
  WITH filtered AS (
    SELECT * FROM people p
    WHERE p.is_public=true AND p.is_browsable_in_people_hub=true AND COALESCE(p.gated_episode_count,0)>=1
      AND NOT (COALESCE(p.manual_approved,false)=false AND COALESCE(p.has_archival_evidence,false)=false
        AND (p.is_deceased IS TRUE OR p.is_historical IS TRUE OR p.persona='historical'
             OR ((p.date_of_death IS NOT NULL OR p.is_living IS FALSE)
                 AND ((p.wikipedia_match_status='verified' AND COALESCE(p.wikipedia_match_confidence,0)>=0.8)
                      OR COALESCE(p.participant_count,0)+COALESCE(p.host_count,0)+COALESCE(p.guest_count,0)=0))))
      AND (p_letter IS NULL OR (p_letter='#' AND NOT (upper(unaccent(left(p.name,1))) ~ '^[A-Z]$'))
           OR upper(unaccent(left(p.name,1)))=upper(p_letter))
  ), counted AS (SELECT count(*)::bigint AS total FROM filtered)
  SELECT f.id,f.slug,f.name,f.disambiguation_label,f.short_bio,f.ai_bio,f.image_url,
    f.identity_ambiguous,f.manual_approved,f.ai_bio_status,f.ai_bio_confidence,
    f.wikipedia_match_status,f.wikipedia_match_confidence,
    f.gated_episode_count,f.gated_podcast_count,f.episode_count,f.podcast_count,
    f.latest_accepted_relevant_episode_at,f.host_count,f.guest_count,f.strong_mention_count,c.total
  FROM filtered f, counted c
  ORDER BY unaccent(f.name) ASC, f.name ASC
  LIMIT p_limit OFFSET p_offset;
$function$;

GRANT EXECUTE ON FUNCTION public.list_people_hub(integer, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_people_alpha(text, integer, integer) TO anon, authenticated;
