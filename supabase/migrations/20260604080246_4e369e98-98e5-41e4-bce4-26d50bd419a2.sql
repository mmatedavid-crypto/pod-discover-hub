-- Reassert v4 recommendation compatibility
CREATE OR REPLACE FUNCTION public.recommendation_text_group(
  p_title text,
  p_podcast_title text,
  p_category text,
  p_topics text[]
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  WITH text_blob AS (
    SELECT lower(
      coalesce(p_title,'') || ' ' ||
      coalesce(p_podcast_title,'') || ' ' ||
      coalesce(p_category,'') || ' ' ||
      array_to_string(coalesce(p_topics, ARRAY[]::text[]), ' ')
    ) AS t
  )
  SELECT CASE
    WHEN t ~ '(mese|meseradio|meserádió|gyerek|gyermek|ovis|óvodás|altató|tündér|baba|esti mese|kids|children|family)' THEN 'children'
    WHEN t ~ '(közélet|kozelet|politika|politics|hírek|hirek|társadalom|tarsadalom|interjú|interju|közbeszéd|kozbeszed|orbán|orban|mészáros|meszaros|fidesz|tisza|kormány|kormany|parlament|párt|part|választás|valasztas|puzsér|puzser|miniszter|ellenzék|ellenzek|önkormányzat|onkormanyzat|hatalom|ner|oligarcha)' THEN 'public_affairs'
    WHEN t ~ '(vallás|vallas|hit|keresztény|kereszteny|isten|biblia|egyház|egyhaz|istentisztelet|igehirdetés|igehirdetes|prédikáció|predikacio|katolikus|református|reformatus|baptista|evangélium|evangelium|áhítat|ahitat|religion|spirituality)' THEN 'religion'
    WHEN t ~ '(üzlet|uzlet|business|gazdaság|gazdasag|pénz|penz|tőzsde|tozsde|befektetés|befektetes|milliárdos|milliardos|cég|ceg|vállalkozás|vallalkozas|ingatlan|karrier|menedzsment|részvény|reszveny|árfolyam|arfolyam|bank|startup)' THEN 'business'
    WHEN t ~ '(sport|foci|futball|labdarúgás|labdarugas|nb1|válogatott|valogatott|meccs|forma-1|formula|kosár|kosar|kézilabda|kezilabda|tenisz|bringa|cycling)' THEN 'sports'
    WHEN t ~ '(egészség|egeszseg|orvos|pszicho|mentális|mentalis|életmód|eletmod)' THEN 'health'
    WHEN t ~ '(film|mozi|sorozat|zene|kultúra|kultura|színház|szinhaz|standup|stand-up|humor|gaming|játék|jatek|bulvár|bulvar)' THEN 'entertainment'
    ELSE 'general'
  END
  FROM text_blob;
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_has_topic_bridge(
  p_source_topics text[],
  p_candidate_topics text[]
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM unnest(coalesce(p_source_topics, ARRAY[]::text[])) s(topic)
    JOIN unnest(coalesce(p_candidate_topics, ARRAY[]::text[])) c(topic)
      ON lower(s.topic) = lower(c.topic)
  );
$function$;

CREATE OR REPLACE FUNCTION public.recommendation_is_compatible(
  p_source_group text,
  p_candidate_group text,
  p_similarity double precision,
  p_has_topic_bridge boolean
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN (p_source_group = 'religion') <> (p_candidate_group = 'religion') THEN false
    WHEN p_candidate_group = 'children' AND p_source_group <> 'children' THEN false
    WHEN p_source_group = 'children' AND p_candidate_group <> 'children' AND NOT p_has_topic_bridge THEN false
    WHEN p_source_group <> 'general' AND p_candidate_group <> 'general' AND p_source_group <> p_candidate_group
      THEN p_has_topic_bridge
    WHEN p_source_group <> 'general' AND p_candidate_group = 'general'
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.74
    WHEN p_candidate_group <> 'general' AND p_source_group = 'general'
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.74
    WHEN p_source_group <> 'general' AND p_source_group = p_candidate_group
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.58
    ELSE p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.62
  END;
$function$;

GRANT EXECUTE ON FUNCTION public.recommendation_text_group(text, text, text, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recommendation_has_topic_bridge(text[], text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.recommendation_is_compatible(text, text, double precision, boolean) TO anon, authenticated, service_role;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'related_episode_quality_policy',
  jsonb_build_object(
    'version', 4,
    'religion_cross_group', 'hard_block',
    'children_cross_group', 'hard_block_except_children_source_with_explicit_bridge',
    'different_specific_groups', 'explicit_bridge_required',
    'specific_to_general_min_similarity_without_bridge', 0.74,
    'same_specific_group_min_similarity_without_bridge', 0.58,
    'general_min_similarity_without_bridge', 0.62,
    'public_affairs_override_terms', jsonb_build_array('orbán', 'mészáros', 'fidesz', 'tisza', 'kormány', 'parlament', 'párt', 'választás', 'puzsér', 'ner'),
    'known_false_positive_fixed', 'puzser_public_affairs_title_with_isten_must_not_match_sermon',
    'note', 'Cross-world recommendations require explicit shared topic/person/company evidence; vector score alone is not trusted for politics/religion/kids/business/sport/health/entertainment jumps.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

-- Reassert news sitemap GSC connector gateway
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'news_sitemap_refresh_controls',
  jsonb_build_object(
    'enabled', true,
    'cadence_minutes', 15,
    'mode', 'refresh_sitemap_lite',
    'google_submit_policy', 'submit_only_when_news_sitemap_has_new_urls',
    'submit_transport', 'lovable_google_search_console_connector_gateway',
    'site_url', 'https://podiverzum.hu/',
    'requires_connector_secrets', jsonb_build_array(
      'LOVABLE_API_KEY',
      'GOOGLE_SEARCH_CONSOLE_API_KEY'
    ),
    'note', 'Refreshes sitemap lite every 15 minutes; refresh-sitemap submits news-sitemap.xml through the Lovable Google Search Console connector only when newly published news URLs appear.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  - 'requires_google_secrets'
  || EXCLUDED.value,
    updated_at = now();