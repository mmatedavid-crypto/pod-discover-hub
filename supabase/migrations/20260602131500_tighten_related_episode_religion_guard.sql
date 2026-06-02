-- Recommendation safety: vector similarity must not bridge worship / sermon
-- content into non-religious public-affairs, business or general episodes.

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
    SELECT lower(coalesce(p_title,'') || ' ' || coalesce(p_podcast_title,'') || ' ' || coalesce(p_category,'') || ' ' || array_to_string(coalesce(p_topics, ARRAY[]::text[]), ' ')) AS t
  )
  SELECT CASE
    WHEN t ~ '(mese|meseradio|meserádió|gyerek|gyermek|ovis|óvodás|altató|tündér|baba|esti mese|kids|children)' THEN 'children'
    WHEN t ~ '(vallás|vallas|hit|keresztény|kereszteny|isten|biblia|egyház|egyhaz|istentisztelet|igehirdetés|igehirdetes|prédikáció|predikacio|katolikus|református|reformatus|baptista|evangélium|evangelium|áhítat|ahitat|religion|spirituality)' THEN 'religion'
    WHEN t ~ '(üzlet|uzlet|business|gazdaság|gazdasag|pénz|penz|tőzsde|tozsde|befektetés|befektetes|milliárdos|milliardos|cég|ceg|vállalkozás|vallalkozas|ingatlan|karrier|menedzsment)' THEN 'business'
    WHEN t ~ '(közélet|kozelet|politika|politics|hírek|hirek|társadalom|tarsadalom|interjú|interju|közbeszéd|kozbeszed)' THEN 'public_affairs'
    WHEN t ~ '(egészség|egeszseg|orvos|pszicho|mentális|mentalis|életmód|eletmod|sport)' THEN 'health'
    ELSE 'general'
  END
  FROM text_blob;
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
    WHEN p_candidate_group = 'children' AND p_source_group <> 'children' THEN false
    WHEN p_source_group = 'children' AND p_candidate_group <> 'children' AND NOT p_has_topic_bridge THEN false
    WHEN (p_source_group = 'religion') <> (p_candidate_group = 'religion') THEN false
    WHEN p_source_group <> 'general' AND p_candidate_group <> 'general' AND p_source_group <> p_candidate_group
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.72
    WHEN p_source_group <> 'general' AND p_candidate_group = 'general'
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.66
    WHEN p_candidate_group <> 'general' AND p_source_group = 'general'
      THEN p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.66
    ELSE p_has_topic_bridge OR coalesce(p_similarity, 0) >= 0.56 OR p_source_group = p_candidate_group
  END;
$function$;
