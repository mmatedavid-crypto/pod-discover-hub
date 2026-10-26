-- Science group from the episode/podcast title, or when science topics dominate the
-- episode's topic list (>=2, or at least half). A single "kvantumfizika" tag on a
-- grab-bag or coaching episode must not make it a science episode.
CREATE OR REPLACE FUNCTION public.recommendation_text_group(p_title text, p_podcast_title text, p_category text, p_topics text[])
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO 'public'
AS $function$
  WITH re AS (
    SELECT '\m(fizika|fiziká|fizikus|kvantum|csillagász|asztrofizik|asztronóm|kozmológ|részecskefizik|relativitáselmélet|ősrobbanás|nagy bumm|fekete lyuk|sötét anyag|sötétanyag|exobolygó|űrkutatás|űrtávcső|biológ|biokémi|kémia|kémiá|kémikus|genetik|evolúci|matematik|idegtudom|neurobiológ|agykutat|tudós|tudomány\M|tudományos|tudományról|tudományt)'::text AS sci
  ),
  b AS (
    SELECT
      lower(coalesce(p_title,'') || ' ' || coalesce(p_podcast_title,'') || ' ' ||
        coalesce(p_category,'') || ' ' || array_to_string(coalesce(p_topics, ARRAY[]::text[]), ' ')) AS t,
      lower(coalesce(p_title,'') || ' ' || coalesce(p_podcast_title,'')) AS head,
      coalesce(p_category,'') AS cat,
      coalesce(cardinality(p_topics), 0) AS n_topics,
      (SELECT count(*) FROM unnest(coalesce(p_topics, ARRAY[]::text[])) tp(v), re WHERE lower(tp.v) ~ re.sci)::int AS sci_topics,
      re.sci
    FROM re
  )
  SELECT CASE
    WHEN cat = 'Kids & Family'
      OR t ~ '\m(mese|mesék|meséi|meseradio|meserádió|esti mese|gyerek|gyerekek|gyerekeknek|gyermek|gyermekek|ovis|óvodás|óvodásoknak|altató|tündér|tündérmese|baba|babák|kids|children|family)\M' THEN 'children'
    WHEN cat = 'Religion & Spirituality' THEN 'religion'
    WHEN cat = 'Science & Ideas' THEN 'science'
    WHEN t ~ '\m(ezoteri|paranormál|asztrológ|horoszkóp|tarot|numerológ|reiki|csakr|manifesztál|vonzás törvény|energiagyógy|kvantumgyógy|reinkarnáci|előző élet|túlvilág|halál utáni|halálközeli|ufó|ufo\M|összeesküvés|spirituális|spiritualitás|angyal|akasha|karma|rezgésszint|médium|jóslás|boszorkány|mágia|mágikus)' THEN 'esoteric'
    WHEN cat = 'True Crime & Paranormal' THEN 'true_crime'
    WHEN cat = 'Self-Improvement' THEN 'self_help'
    WHEN head ~ sci OR sci_topics >= 2 OR (sci_topics >= 1 AND sci_topics * 2 >= n_topics) THEN 'science'
    WHEN t ~ '\m(közélet|kozelet|politik|politics|hírek|hirek|társadalom|tarsadalom|közbeszéd|kozbeszed|orbán|orban|mészáros|meszaros|fidesz|tisza\M|kormány|kormany|parlament|párt\M|pártok|pártja|választás|valasztas|puzsér|puzser|miniszter|ellenzék|ellenzek|önkormányzat|onkormanyzat|hatalom|ner\M|oligarch)' THEN 'public_affairs'
    WHEN t ~ '\m(vallás|vallas|hit\M|hitről|hitben|keresztény|kereszteny|isten|biblia|egyház|egyhaz|istentisztelet|igehirdetés|igehirdetes|prédikáció|predikacio|katolikus|református|reformatus|baptista|evangélium|evangelium|áhítat|ahitat|religion|spirituality)' THEN 'religion'
    WHEN t ~ '\m(üzlet|uzlet|business|gazdaság|gazdasag|pénz|penz|tőzsde|tozsde|befektet|milliárdos|milliardos|cég|ceg\M|vállalkoz|vallalkoz|ingatlan|karrier|menedzsment|részvény|reszveny|árfolyam|arfolyam|bank|startup|finance)' THEN 'business'
    WHEN t ~ '\m(sport|foci|futball|labdarúgás|labdarugas|nb1|nb i\M|válogatott|valogatott|meccs|forma-1|formula-1|kosárlabda|kosarlabda|kézilabda|kezilabda|tenisz|bringa|cycling)' THEN 'sports'
    WHEN t ~ '\m(egészség|egeszseg|orvos|pszicho|mentális|mentalis|életmód|eletmod|health)' THEN 'health'
    WHEN t ~ '\m(film|mozi|sorozat|zene|zenei|zenész|kultúra|kultura|színház|szinhaz|standup|stand-up|humor|gaming|játék|jatek|bulvár|bulvar|music|comedy)' THEN 'entertainment'
    ELSE 'general' END
  FROM b;
$function$;
