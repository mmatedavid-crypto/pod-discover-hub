-- Recommendation editorial-world guard v2.
-- * Word-bounded keyword matching (substring matching put every "Explainer" podcast
--   into politics via "ner", "hitel" into religion via "hit", etc.).
-- * New groups: science, esoteric, true_crime, self_help. Science never bridges to
--   esoteric / paranormal / true-crime / self-help content.
-- * One shared generic topic is not enough to cross from/to science; it needs two
--   shared topics, a verified person, a shared organisation, or a very close vector.
-- * smart_player_discover: entity/chunk rails pass the same guard; chunk (transcript) text is never returned.
-- Mirrored in src/lib/recommendationGuards.ts.

CREATE OR REPLACE FUNCTION public.recommendation_text_group(p_title text, p_podcast_title text, p_category text, p_topics text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  WITH b AS (
    SELECT
      lower(coalesce(p_title,'') || ' ' || coalesce(p_podcast_title,'') || ' ' ||
        coalesce(p_category,'') || ' ' || array_to_string(coalesce(p_topics, ARRAY[]::text[]), ' ')) AS t,
      coalesce(p_category,'') AS cat
  )
  SELECT CASE
    WHEN cat = 'Kids & Family'
      OR t ~ '\m(mese|mesék|meséi|meseradio|meserádió|esti mese|gyerek|gyerekek|gyerekeknek|gyermek|gyermekek|ovis|óvodás|óvodásoknak|altató|tündér|tündérmese|baba|babák|kids|children|family)\M' THEN 'children'
    WHEN cat = 'Religion & Spirituality' THEN 'religion'
    WHEN cat = 'Science & Ideas' THEN 'science'
    WHEN t ~ '\m(ezoteri|paranormál|asztrológ|horoszkóp|tarot|numerológ|reiki|csakr|manifesztál|vonzás törvény|energiagyógy|kvantumgyógy|reinkarnáci|előző élet|túlvilág|halál utáni|halálközeli|ufó|ufo\M|összeesküvés|spirituális|spiritualitás|angyal|akasha|karma|rezgésszint|médium|jóslás|boszorkány|mágia|mágikus)' THEN 'esoteric'
    WHEN cat = 'True Crime & Paranormal' THEN 'true_crime'
    WHEN cat = 'Self-Improvement' THEN 'self_help'
    WHEN t ~ '\m(fizika|fiziká|fizikus|kvantum|csillagász|asztrofizik|asztronóm|kozmológ|részecskefizik|relativitáselmélet|ősrobbanás|nagy bumm|fekete lyuk|sötét anyag|sötétanyag|exobolygó|űrkutatás|űrtávcső|biológ|biokémi|kémia|kémiá|kémikus|genetik|evolúci|matematik|idegtudom|neurobiológ|agykutat|tudós|tudomány\M|tudományos|tudományról|tudományt)' THEN 'science'
    WHEN t ~ '\m(közélet|kozelet|politik|politics|hírek|hirek|társadalom|tarsadalom|közbeszéd|kozbeszed|orbán|orban|mészáros|meszaros|fidesz|tisza\M|kormány|kormany|parlament|párt\M|pártok|pártja|választás|valasztas|puzsér|puzser|miniszter|ellenzék|ellenzek|önkormányzat|onkormanyzat|hatalom|ner\M|oligarch)' THEN 'public_affairs'
    WHEN t ~ '\m(vallás|vallas|hit\M|hitről|hitben|keresztény|kereszteny|isten|biblia|egyház|egyhaz|istentisztelet|igehirdetés|igehirdetes|prédikáció|predikacio|katolikus|református|reformatus|baptista|evangélium|evangelium|áhítat|ahitat|religion|spirituality)' THEN 'religion'
    WHEN t ~ '\m(üzlet|uzlet|business|gazdaság|gazdasag|pénz|penz|tőzsde|tozsde|befektet|milliárdos|milliardos|cég|ceg\M|vállalkoz|vallalkoz|ingatlan|karrier|menedzsment|részvény|reszveny|árfolyam|arfolyam|bank|startup|finance)' THEN 'business'
    WHEN t ~ '\m(sport|foci|futball|labdarúgás|labdarugas|nb1|nb i\M|válogatott|valogatott|meccs|forma-1|formula-1|kosárlabda|kosarlabda|kézilabda|kezilabda|tenisz|bringa|cycling)' THEN 'sports'
    WHEN t ~ '\m(egészség|egeszseg|orvos|pszicho|mentális|mentalis|életmód|eletmod|health)' THEN 'health'
    WHEN t ~ '\m(film|mozi|sorozat|zene|zenei|zenész|kultúra|kultura|színház|szinhaz|standup|stand-up|humor|gaming|játék|jatek|bulvár|bulvar|music|comedy)' THEN 'entertainment'
    ELSE 'general' END
  FROM b;
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_topic_overlap(p_a text[], p_b text[])
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  SELECT count(DISTINCT lower(btrim(a.v)))::int
  FROM unnest(coalesce(p_a, ARRAY[]::text[])) a(v)
  WHERE btrim(a.v) <> ''
    AND lower(btrim(a.v)) IN (SELECT lower(btrim(b.v)) FROM unnest(coalesce(p_b, ARRAY[]::text[])) b(v));
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_is_compatible_v2(
  p_source_group text, p_candidate_group text, p_similarity double precision,
  p_shared_topics integer, p_entity_bridge boolean)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  WITH x AS (
    SELECT coalesce(p_source_group,'general') AS s, coalesce(p_candidate_group,'general') AS c,
           coalesce(p_similarity,0) AS sim,
           (coalesce(p_entity_bridge,false) OR coalesce(p_shared_topics,0) > 0) AS bridge,
           (coalesce(p_entity_bridge,false) OR coalesce(p_shared_topics,0) >= 2) AS strong
  )
  SELECT CASE
    WHEN (s='religion') <> (c='religion') THEN false
    WHEN c='children' AND s<>'children' THEN false
    WHEN s='children' AND c<>'children' THEN bridge
    WHEN s='science' AND c IN ('esoteric','true_crime','self_help') THEN false
    WHEN c='science' AND s IN ('esoteric','true_crime') THEN false
    WHEN s<>c AND (s='science' OR c='science') AND (s='general' OR c='general') THEN strong OR sim >= 0.87
    WHEN s<>c AND (s='science' OR c='science') THEN strong
    WHEN s<>'general' AND c<>'general' AND s<>c THEN bridge
    WHEN s<>'general' AND c='general' THEN bridge
    WHEN c<>'general' AND s='general' THEN bridge
    WHEN s<>'general' AND s=c THEN bridge OR sim >= 0.70
    ELSE bridge OR sim >= 0.82
  END FROM x;
$function$;

CREATE OR REPLACE FUNCTION public.similar_episodes(p_episode_id uuid, p_limit integer DEFAULT 6)
 RETURNS TABLE(episode_id uuid, podcast_id uuid, similarity double precision, title text, display_title text, slug text, ai_summary text, summary text, description text, published_at timestamp with time zone, audio_url text, topics text[], podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text, podcast_category text, podiverzum_rank numeric, rank_label text, related_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE src_embedding vector(768); src_podcast_id uuid; src_topics text[]; src_companies text[]; src_group text; src_person_ids uuid[];
BEGIN
  SELECT ee.embedding, ee.podcast_id INTO src_embedding, src_podcast_id FROM episode_embeddings ee WHERE ee.episode_id=p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;
  SELECT COALESCE(e.topics,'{}'), COALESCE(e.companies,'{}'),
         public.recommendation_text_group(e.title, pod.title, pod.category, e.topics)
  INTO src_topics, src_companies, src_group
  FROM episodes e JOIN podcasts pod ON pod.id=e.podcast_id WHERE e.id=p_episode_id;
  src_person_ids := public.verified_episode_person_ids_v1(p_episode_id);

  RETURN QUERY
  WITH ep_cand AS (SELECT ee.episode_id AS eid, ee.podcast_id AS pid, (1-((ee.embedding::halfvec(768) <=> (src_embedding)::halfvec(768))))::float AS sim
    FROM episode_embeddings ee WHERE ee.episode_id<>p_episode_id
      AND ee.podcast_id<>COALESCE(src_podcast_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY (ee.embedding::halfvec(768) <=> (src_embedding)::halfvec(768)) LIMIT 260),
  chunk_cand AS (SELECT DISTINCT ON (x.eid) x.eid, x.pid, x.sim FROM (SELECT ec.episode_id AS eid, ec.podcast_id AS pid, (1-(ec.embedding::halfvec(768)<=>src_embedding::halfvec(768)))::float AS sim
    FROM episode_chunks ec WHERE ec.episode_id<>p_episode_id
      AND ec.podcast_id<>COALESCE(src_podcast_id,'00000000-0000-0000-0000-000000000000'::uuid)
    ORDER BY ec.embedding::halfvec(768)<=>src_embedding::halfvec(768) LIMIT 800) x ORDER BY x.eid, x.sim DESC),
  pool AS (SELECT eid, pid, max(sim) AS sim FROM (SELECT * FROM ep_cand UNION ALL SELECT * FROM chunk_cand) u GROUP BY eid, pid),
  base AS (
    SELECT e.id AS eid, e.podcast_id AS pid, p.sim,
      e.title, e.display_title, e.slug, e.ai_summary, e.summary, e.description,
      e.published_at, e.audio_url, COALESCE(e.topics, ARRAY[]::text[]) AS topics,
      pod.slug AS p_slug, pod.title AS p_title, pod.display_title AS p_display_title,
      pod.image_url AS p_image, pod.category AS p_category, pod.podiverzum_rank AS p_rank, pod.rank_label AS p_rank_label,
      public.recommendation_topic_overlap(src_topics, e.topics) AS topic_overlap,
      public.verified_person_overlap_v1(src_person_ids, e.id) AS people_overlap,
      public.recommendation_topic_overlap(src_companies, e.companies) AS company_overlap,
      public.recommendation_text_group(e.title, pod.title, pod.category, e.topics) AS candidate_group
    FROM pool p JOIN episodes e ON e.id=p.eid JOIN podcasts pod ON pod.id=e.podcast_id
    WHERE pod.is_hungarian=true AND pod.language_decision='accept_hungarian'
      AND COALESCE(pod.rss_status,'healthy') NOT IN ('failed','inactive') AND e.audio_url IS NOT NULL),
  scored AS (
    SELECT b.*,
      (b.sim
       + CASE b.p_rank_label WHEN 'S' THEN 0.05 WHEN 'A' THEN 0.03 WHEN 'B' THEN 0.015 ELSE 0 END
       + CASE WHEN src_group<>'general' AND b.candidate_group=src_group THEN 0.03 ELSE 0 END
       + LEAST(b.topic_overlap*0.05, 0.15)
       + LEAST(b.people_overlap*0.08, 0.20)
       + LEAST(b.company_overlap*0.07, 0.18)
      )::float AS fscore
    FROM base b
    WHERE public.recommendation_is_compatible_v2(src_group, b.candidate_group, b.sim, b.topic_overlap,
            b.people_overlap > 0 OR b.company_overlap > 0)),
  diversified AS (SELECT s.*, row_number() OVER (PARTITION BY s.pid ORDER BY s.fscore DESC) AS rn_per_pod FROM scored s)
  SELECT d.eid, d.pid, d.sim,
    d.title, d.display_title, d.slug, d.ai_summary, d.summary, d.description,
    d.published_at, d.audio_url, d.topics,
    d.p_slug, d.p_title, d.p_display_title, d.p_image, d.p_category,
    d.p_rank, d.p_rank_label,
    CASE WHEN d.people_overlap>0 THEN 'Kapcsolódó személyek alapján.'
         WHEN d.company_overlap>0 THEN 'Kapcsolódó szervezet vagy márka alapján.'
         WHEN d.topic_overlap>0 THEN 'Hasonló témák: ' || array_to_string((ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(d.topics)))[1:3], ', ')
         WHEN d.sim>=0.82 THEN 'Erős tartalmi közelség az epizód-index alapján.'
         ELSE 'Tartalmilag rokon epizód.' END AS related_reason
  FROM diversified d WHERE d.rn_per_pod=1 AND d.sim>=0.50
  ORDER BY d.fscore DESC LIMIT GREATEST(p_limit,1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_related_episodes_by_embedding(p_episode_id uuid, p_limit integer DEFAULT 8, p_downweight_same_podcast boolean DEFAULT true)
 RETURNS TABLE(episode_id uuid, podcast_id uuid, similarity double precision, final_score double precision, title text, display_title text, slug text, ai_summary text, summary text, description text, published_at timestamp with time zone, audio_url text, image_url text, topics text[], podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text, podcast_category text, podiverzum_rank numeric, rank_label text, related_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE src_embedding vector(768); src_podcast_id uuid; src_topics text[]; src_companies text[]; src_group text; src_person_ids uuid[];
BEGIN
  SELECT ee.embedding, ee.podcast_id INTO src_embedding, src_podcast_id FROM episode_embeddings ee WHERE ee.episode_id=p_episode_id LIMIT 1;
  IF src_embedding IS NULL THEN RETURN; END IF;
  SELECT COALESCE(e.topics,'{}'), COALESCE(e.companies,'{}'),
         public.recommendation_text_group(e.title, pod.title, pod.category, e.topics)
  INTO src_topics, src_companies, src_group
  FROM episodes e JOIN podcasts pod ON pod.id=e.podcast_id WHERE e.id=p_episode_id;
  src_person_ids := public.verified_episode_person_ids_v1(p_episode_id);

  RETURN QUERY
  WITH ep_cand AS (SELECT ee.episode_id AS eid, ee.podcast_id AS pid, (1-((ee.embedding::halfvec(768) <=> (src_embedding)::halfvec(768))))::float AS sim
    FROM episode_embeddings ee WHERE ee.episode_id<>p_episode_id ORDER BY (ee.embedding::halfvec(768) <=> (src_embedding)::halfvec(768)) LIMIT 260),
  chunk_cand AS (SELECT DISTINCT ON (x.eid) x.eid, x.pid, x.sim FROM (SELECT ec.episode_id AS eid, ec.podcast_id AS pid, (1-(ec.embedding::halfvec(768)<=>src_embedding::halfvec(768)))::float AS sim
    FROM episode_chunks ec WHERE ec.episode_id<>p_episode_id ORDER BY ec.embedding::halfvec(768)<=>src_embedding::halfvec(768) LIMIT 800) x ORDER BY x.eid, x.sim DESC),
  pool AS (SELECT eid, pid, max(sim) AS sim FROM (SELECT * FROM ep_cand UNION ALL SELECT * FROM chunk_cand) u GROUP BY eid, pid),
  base AS (
    SELECT e.id AS eid, e.podcast_id AS pid, p.sim,
      e.title, e.display_title, e.slug, e.ai_summary, e.summary, e.description,
      e.published_at, e.audio_url, e.image_url, COALESCE(e.topics, ARRAY[]::text[]) AS topics,
      pod.slug AS p_slug, pod.title AS p_title, pod.display_title AS p_display_title,
      pod.image_url AS p_image, pod.category AS p_category, pod.podiverzum_rank AS p_rank, pod.rank_label AS p_rank_label,
      (e.podcast_id=src_podcast_id) AS same_pod,
      public.recommendation_topic_overlap(src_topics, e.topics) AS topic_overlap,
      public.verified_person_overlap_v1(src_person_ids, e.id) AS people_overlap,
      public.recommendation_topic_overlap(src_companies, e.companies) AS company_overlap,
      public.recommendation_text_group(e.title, pod.title, pod.category, e.topics) AS candidate_group
    FROM pool p JOIN episodes e ON e.id=p.eid JOIN podcasts pod ON pod.id=e.podcast_id
    WHERE pod.is_hungarian=true AND pod.language_decision='accept_hungarian'
      AND COALESCE(pod.rss_status,'healthy') NOT IN ('failed','inactive') AND e.audio_url IS NOT NULL),
  scored AS (
    SELECT b.*,
      (b.sim*1.0
       + CASE b.p_rank_label WHEN 'S' THEN 0.05 WHEN 'A' THEN 0.03 WHEN 'B' THEN 0.015 ELSE 0 END
       + CASE WHEN b.published_at IS NOT NULL AND b.published_at > now() - interval '180 days' THEN 0.03 ELSE 0 END
       + CASE WHEN src_group<>'general' AND b.candidate_group=src_group THEN 0.03 ELSE 0 END
       + LEAST(b.topic_overlap*0.05, 0.15)
       + LEAST(b.people_overlap*0.08, 0.20)
       + LEAST(b.company_overlap*0.07, 0.18)
       - CASE WHEN COALESCE(length(coalesce(b.ai_summary,b.summary,b.description)),0)<80 THEN 0.05 ELSE 0 END
      )::float AS fscore
    FROM base b WHERE (p_downweight_same_podcast=false OR b.same_pod=false)
      AND public.recommendation_is_compatible_v2(src_group, b.candidate_group, b.sim, b.topic_overlap,
            b.people_overlap > 0 OR b.company_overlap > 0)),
  diversified AS (SELECT s.*, row_number() OVER (PARTITION BY s.pid ORDER BY s.fscore DESC) AS rn_per_pod FROM scored s)
  SELECT d.eid, d.pid, d.sim, d.fscore, d.title, d.display_title, d.slug, d.ai_summary, d.summary, d.description,
    d.published_at, d.audio_url, d.image_url, d.topics,
    d.p_slug, d.p_title, d.p_display_title, d.p_image, d.p_category, d.p_rank, d.p_rank_label,
    CASE WHEN d.people_overlap>0 THEN 'Kapcsolódó személyek alapján.'
         WHEN d.company_overlap>0 THEN 'Kapcsolódó szervezet vagy márka alapján.'
         WHEN d.topic_overlap>0 THEN 'Hasonló témák: ' || array_to_string((ARRAY(SELECT unnest(src_topics) INTERSECT SELECT unnest(d.topics)))[1:3], ', ')
         WHEN d.sim>=0.82 THEN 'Erős tartalmi közelség az epizód-index alapján.'
         ELSE 'Tartalmilag rokon epizód.' END AS related_reason
  FROM diversified d WHERE d.rn_per_pod=1 AND d.sim>=0.50
  ORDER BY d.fscore DESC LIMIT GREATEST(p_limit,1);
END;
$function$;

CREATE OR REPLACE FUNCTION public.smart_player_discover(p_episode_id uuid, p_limit integer DEFAULT 6)
 RETURNS TABLE(match_kind text, episode_id uuid, podcast_id uuid, title text, display_title text, slug text, image_url text, audio_url text, podcast_slug text, podcast_title text, podcast_display_title text, podcast_image_url text, published_at timestamp with time zone, similarity double precision, best_chunk_idx integer, best_char_start integer, snippet text, seek_seconds integer, shared_persons text[], shared_orgs text[], shared_topics text[], why_label text, sort_score double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  src_podcast_id uuid;
  src_topics     text[];
  src_person_ids uuid[];
  src_org_ids    uuid[];
  src_group      text;
BEGIN
  SELECT e.podcast_id,
         COALESCE(e.topics, ARRAY[]::text[])
    INTO src_podcast_id, src_topics
  FROM public.episodes e
  WHERE e.id = p_episode_id;

  IF src_podcast_id IS NULL THEN
    RETURN;
  END IF;

  SELECT public.recommendation_text_group(e.title, pod.title, pod.category, e.topics)
    INTO src_group
  FROM public.episodes e JOIN public.podcasts pod ON pod.id = e.podcast_id
  WHERE e.id = p_episode_id;

  SELECT COALESCE(array_agg(DISTINCT pem.person_id), ARRAY[]::uuid[])
    INTO src_person_ids
  FROM public.person_episode_mentions pem
  WHERE pem.episode_id = p_episode_id
    AND pem.relevance_status = 'accepted' AND public.person_link_trusted_v1(pem.person_id, pem.validation_source);

  SELECT COALESCE(array_agg(DISTINCT eom.organization_id), ARRAY[]::uuid[])
    INTO src_org_ids
  FROM public.episode_organization_map eom
  WHERE eom.episode_id = p_episode_id;

  RETURN QUERY
  WITH
  src_chunks AS (
    SELECT ec.chunk_idx, ec.char_start, ec.embedding, length(ec.content) AS clen
    FROM public.episode_chunks ec
    WHERE ec.episode_id = p_episode_id
    ORDER BY clen DESC
    LIMIT 6
  ),
  chunk_candidates AS (
    SELECT
      ec.episode_id AS cand_ep,
      ec.podcast_id AS cand_pod,
      ec.chunk_idx,
      ec.char_start,
      1 - ((ec.embedding::halfvec(768) <=> (sc.embedding)::halfvec(768))) AS sim
    FROM src_chunks sc
    CROSS JOIN LATERAL (
      SELECT ec2.episode_id, ec2.podcast_id, ec2.chunk_idx, ec2.char_start, ec2.embedding
      FROM public.episode_chunks ec2
      WHERE ec2.podcast_id <> src_podcast_id
      ORDER BY (ec2.embedding::halfvec(768) <=> (sc.embedding)::halfvec(768))
      LIMIT 25
    ) ec
  ),
  chunk_best AS (
    SELECT DISTINCT ON (cand_ep)
      cand_ep AS episode_id,
      cand_pod AS podcast_id,
      chunk_idx, char_start, sim
    FROM chunk_candidates
    ORDER BY cand_ep, sim DESC
  ),
  vec_neighbors AS (
    SELECT se.episode_id, se.podcast_id, se.similarity
    FROM public.similar_episodes(p_episode_id, 25) se
    WHERE se.podcast_id <> src_podcast_id
  ),
  person_hits AS (
    SELECT pem.episode_id, pem.podcast_id, pem.person_id
    FROM public.person_episode_mentions pem
    WHERE pem.relevance_status = 'accepted' AND public.person_link_trusted_v1(pem.person_id, pem.validation_source)
      AND pem.person_id = ANY(src_person_ids)
      AND pem.podcast_id <> src_podcast_id
      AND pem.episode_id <> p_episode_id
  ),
  org_hits AS (
    SELECT eom.episode_id, eom.podcast_id, eom.organization_id
    FROM public.episode_organization_map eom
    WHERE eom.organization_id = ANY(src_org_ids)
      AND eom.podcast_id <> src_podcast_id
      AND eom.episode_id <> p_episode_id
  ),
  topic_hits AS (
    SELECT
      e.id AS episode_id,
      e.podcast_id,
      ARRAY(SELECT unnest(COALESCE(e.topics, ARRAY[]::text[])) INTERSECT SELECT unnest(src_topics)) AS s_topics
    FROM public.episodes e
    WHERE src_topics <> ARRAY[]::text[]
      AND e.podcast_id <> src_podcast_id
      AND e.id <> p_episode_id
      AND e.topics && src_topics
    LIMIT 400
  ),
  ent_candidates AS (
    SELECT episode_id, podcast_id FROM person_hits
    UNION
    SELECT episode_id, podcast_id FROM org_hits
    UNION
    SELECT episode_id, podcast_id FROM topic_hits WHERE cardinality(s_topics) > 0
  ),
  ent_aggregated AS (
    SELECT
      ec.episode_id,
      ec.podcast_id,
      COALESCE(
        (SELECT array_agg(DISTINCT p.name) FROM public.people p
          WHERE p.id IN (SELECT person_id FROM person_hits ph WHERE ph.episode_id = ec.episode_id)),
        ARRAY[]::text[]
      ) AS s_people,
      COALESCE(
        (SELECT array_agg(DISTINCT o.name) FROM public.organizations o
          WHERE o.id IN (SELECT organization_id FROM org_hits oh WHERE oh.episode_id = ec.episode_id)),
        ARRAY[]::text[]
      ) AS s_orgs,
      COALESCE(
        (SELECT th.s_topics FROM topic_hits th WHERE th.episode_id = ec.episode_id LIMIT 1),
        ARRAY[]::text[]
      ) AS s_topics
    FROM ent_candidates ec
  ),
  ent_scored AS (
    SELECT
      ea.episode_id, ea.podcast_id, ea.s_people, ea.s_orgs, ea.s_topics,
      (cardinality(ea.s_people) * 3 + cardinality(ea.s_orgs) * 2 + cardinality(ea.s_topics))::double precision AS sc
    FROM ent_aggregated ea
    WHERE cardinality(ea.s_people) + cardinality(ea.s_orgs) + cardinality(ea.s_topics) > 0
  ),
  chunk_rail AS (
    SELECT
      'chunk_moment'::text AS match_kind,
      cb.episode_id, cb.podcast_id,
      cb.chunk_idx AS best_chunk_idx,
      cb.char_start AS best_char_start,
      -- Chunks are built from private transcripts: never return their text.
      NULL::text AS snippet,
      GREATEST(0, FLOOR(cb.char_start::numeric / 15))::int AS seek_seconds,
      cb.sim AS similarity,
      ARRAY[]::text[] AS s_people, ARRAY[]::text[] AS s_orgs, ARRAY[]::text[] AS s_topics,
      cb.sim AS sort_score
    FROM chunk_best cb
    WHERE cb.sim >= 0.55
  ),
  ent_rail AS (
    SELECT
      'entity_overlap'::text AS match_kind,
      es.episode_id, es.podcast_id,
      NULL::int, NULL::int, NULL::text, NULL::int, NULL::double precision,
      es.s_people, es.s_orgs, es.s_topics,
      es.sc AS sort_score
    FROM ent_scored es
  ),
  vec_rail AS (
    SELECT
      'vector_neighbor'::text AS match_kind,
      vn.episode_id, vn.podcast_id,
      NULL::int, NULL::int, NULL::text, NULL::int,
      vn.similarity,
      ARRAY[]::text[], ARRAY[]::text[], ARRAY[]::text[],
      vn.similarity AS sort_score
    FROM vec_neighbors vn
  ),
  unioned AS (
    SELECT * FROM chunk_rail
    UNION ALL SELECT * FROM ent_rail
    UNION ALL SELECT * FROM vec_rail
  ),
  -- Entity/chunk rails pass the same editorial-world guard as the vector rail
  -- (vector rows are already guarded inside similar_episodes).
  guarded AS (
    SELECT u.*
    FROM unioned u
    JOIN public.episodes ge ON ge.id = u.episode_id
    JOIN public.podcasts gp ON gp.id = u.podcast_id
    WHERE ge.audio_url IS NOT NULL
      AND COALESCE(gp.rss_status, 'active') NOT IN ('failed', 'inactive')
      AND gp.language ILIKE 'hu%'
      AND (u.match_kind = 'vector_neighbor'
       OR public.recommendation_is_compatible_v2(
            src_group,
            public.recommendation_text_group(ge.title, gp.title, gp.category, ge.topics),
            COALESCE(u.similarity, 0),
            COALESCE(cardinality(u.s_topics), 0),
            COALESCE(cardinality(u.s_people), 0) + COALESCE(cardinality(u.s_orgs), 0) > 0))
  ),
  ranked AS (
    SELECT u.*,
      ROW_NUMBER() OVER (PARTITION BY u.match_kind, u.podcast_id ORDER BY u.sort_score DESC) AS pod_rn,
      ROW_NUMBER() OVER (PARTITION BY u.match_kind ORDER BY u.sort_score DESC) AS kind_rn
    FROM guarded u
  )
  SELECT
    r.match_kind, r.episode_id, r.podcast_id,
    e.title, e.display_title, e.slug, e.image_url, e.audio_url,
    p.slug AS podcast_slug, p.title AS podcast_title, p.display_title AS podcast_display_title, p.image_url AS podcast_image_url,
    e.published_at,
    r.similarity, r.best_chunk_idx, r.best_char_start, r.snippet, r.seek_seconds,
    r.s_people AS shared_persons, r.s_orgs AS shared_orgs, r.s_topics AS shared_topics,
    CASE r.match_kind
      WHEN 'chunk_moment'    THEN 'Hasonló pillanat ' || COALESCE(to_char(r.seek_seconds / 60, 'FM00') || ':' || to_char(r.seek_seconds % 60, 'FM00'), '') || ' körül'
      WHEN 'entity_overlap'  THEN 'Közös: ' || array_to_string(
                                    (SELECT array_agg(x) FROM (
                                       SELECT unnest(r.s_people) AS x
                                       UNION ALL SELECT unnest(r.s_orgs)
                                       UNION ALL SELECT unnest(r.s_topics)
                                       LIMIT 3
                                     ) t),
                                    ', ')
      WHEN 'vector_neighbor' THEN ROUND((r.similarity * 100)::numeric)::text || '% témaegyezés'
      ELSE NULL
    END AS why_label,
    r.sort_score
  FROM ranked r
  JOIN public.episodes e ON e.id = r.episode_id
  JOIN public.podcasts p ON p.id = r.podcast_id
  WHERE r.pod_rn = 1
    AND r.kind_rn <= p_limit
  ORDER BY r.match_kind, r.sort_score DESC;
END;
$function$;

REVOKE ALL ON FUNCTION public.recommendation_topic_overlap(text[], text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recommendation_is_compatible_v2(text, text, double precision, integer, boolean) FROM PUBLIC, anon, authenticated;
