-- Consolidated related/smart recommendation quality guard.
-- Vector similarity is useful only after coarse editorial compatibility. In
-- Hungarian public-affairs titles words like "Isten" can be metaphorical or
-- quoted; political context must win over a single religion token.

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
    WHEN t ~ '(mese|meseradio|meserádió|gyerek|gyermek|ovis|óvodás|altató|tündér|baba|esti mese|kids|children)' THEN 'children'
    WHEN t ~ '(közélet|kozelet|politika|politics|hírek|hirek|társadalom|tarsadalom|interjú|interju|közbeszéd|kozbeszed|orbán|orban|mészáros|meszaros|fidesz|tisza|kormány|kormany|parlament|párt|part|választás|valasztas|puzsér|puzser)' THEN 'public_affairs'
    WHEN t ~ '(üzlet|uzlet|business|gazdaság|gazdasag|pénz|penz|tőzsde|tozsde|befektetés|befektetes|milliárdos|milliardos|cég|ceg|vállalkozás|vallalkozas|ingatlan|karrier|menedzsment|részvény|reszveny)' THEN 'business'
    WHEN t ~ '(vallás|vallas|hit|keresztény|kereszteny|isten|biblia|egyház|egyhaz|istentisztelet|igehirdetés|igehirdetes|prédikáció|predikacio|katolikus|református|reformatus|baptista|evangélium|evangelium|áhítat|ahitat|religion|spirituality)' THEN 'religion'
    WHEN t ~ '(egészség|egeszseg|orvos|pszicho|mentális|mentalis|életmód|eletmod|sport)' THEN 'health'
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
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.72
    WHEN p_source_group <> 'general' AND p_candidate_group = 'general'
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.66
    WHEN p_candidate_group <> 'general' AND p_source_group = 'general'
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.66
    ELSE p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.56 OR p_source_group = p_candidate_group
  END;
$function$;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'related_episode_quality_policy',
  jsonb_build_object(
    'version', 3,
    'religion_cross_group', 'hard_block',
    'children_cross_group', 'hard_block_except_children_source_with_explicit_bridge',
    'public_affairs_override_terms', jsonb_build_array('orbán', 'mészáros', 'fidesz', 'tisza', 'kormány', 'parlament', 'párt', 'választás', 'puzsér'),
    'known_false_positive_fixed', 'puzser_public_affairs_title_with_isten_must_not_match_sermon',
    'note', 'Smart player and related episode recommendations block religion/non-religion vector false positives; public-affairs political context wins over a single religion word in titles.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
