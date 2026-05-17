-- 1. Schema additions
ALTER TABLE public.mood_collections
  ADD COLUMN IF NOT EXISTS short_description text,
  ADD COLUMN IF NOT EXISTS positive_topic_hints text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS negative_topic_hints text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS preferred_duration_min integer,
  ADD COLUMN IF NOT EXISTS preferred_duration_max integer,
  ADD COLUMN IF NOT EXISTS energy_level text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS freshness_weight numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS evergreen_weight numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS source_quality_weight numeric NOT NULL DEFAULT 0.5,
  ADD COLUMN IF NOT EXISTS is_indexable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seed_embedding vector(768),
  ADD COLUMN IF NOT EXISTS time_affinity jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS default_reason_label text,
  ADD COLUMN IF NOT EXISTS recommended_episode_count integer NOT NULL DEFAULT 0;

-- 2. Insert 6 new moods
INSERT INTO public.mood_collections (slug, title, mood, description, short_description, seed_query, energy_level, sort_order, active, freshness_weight, evergreen_weight, source_quality_weight)
VALUES
  ('uzleti-inspiracio', 'Üzleti inspirációhoz', 'uzleti-inspiracio',
   'Vállalkozók, cégépítők és vezetők őszinte beszélgetései: hogyan építenek céget, csapatot, márkát.',
   'Cégépítés, vezetés, marketing és növekedés magyar podcastokban.',
   'Magyar podcastok vállalkozásról, cégépítésről, startupokról, vezetésről, marketingről, growth-ról, sales-ről, csapatépítésről. Vállalkozói interjúk, alapítói történetek, gyakorlati üzleti tanulságok.',
   'energetic', 100, true, 0.5, 0.6, 0.7),
  ('penzugyi-gondolkodas', 'Pénzügyi gondolkodáshoz', 'penzugyi-gondolkodas',
   'Tőzsde, makro, befektetés, állampapír, megtakarítás — magyar pénzügyi beszélgetések.',
   'Befektetés, makrogazdaság, magyar tőzsde és személyes pénzügyek.',
   'Magyar podcastok pénzügyekről, befektetésekről, tőzsdéről, részvényekről, makrogazdaságról, inflációról, kamatokról, állampapírról, magánnyugdíjról, vagyonkezelésről, megtakarításról. Komoly pénzügyi elemzések.',
   'medium', 110, true, 0.7, 0.4, 0.7),
  ('kulturahoz', 'Kultúrához', 'kulturahoz',
   'Könyvek, színház, képzőművészet, irodalom és magyar kulturális élet.',
   'Könyv, színház, művészet, magyar kultúra.',
   'Magyar podcastok kultúráról: könyvek, irodalom, színház, képzőművészet, zene, klasszikus művek, kortárs alkotók, kritika, esszé, kulturális események. Igényes, reflektív beszélgetések.',
   'calm', 120, true, 0.4, 0.7, 0.6),
  ('filmekhez', 'Filmekhez', 'filmekhez',
   'Filmek, sorozatok, rendezők, kritika és filmkultúra magyarul.',
   'Filmek, sorozatok, kritika, mozis beszélgetések.',
   'Magyar podcastok filmekről, sorozatokról, rendezőkről, színészekről, filmes újdonságokról, kritikákról, mozis ajánlókról, streaming sorozatokról, filmtörténetről. Filmes szakmai és rajongói tartalom.',
   'medium', 130, true, 0.6, 0.5, 0.6),
  ('nyugodt-beszelgetesek', 'Nyugodt beszélgetésekhez', 'nyugodt-beszelgetesek',
   'Lassabb tempójú, emberi, reflektív beszélgetések — feszültség nélkül.',
   'Csendesebb, emberi beszélgetések, kapkodás nélkül.',
   'Csendes, lassú tempójú, emberi magyar podcast beszélgetések. Mély interjúk, személyes történetek, reflexió, pszichológia, mindfulness, életvezetés. Nem hírműsor, nem kiabálás, nem politika.',
   'calm', 140, true, 0.3, 0.7, 0.5),
  ('gyors-frissites', 'Gyors frissítéshez', 'gyors-frissites',
   'Pár perces friss hírek és gyors összefoglalók, ha kevés időd van.',
   'Rövid, friss hírek és napi összefoglalók.',
   'Rövid, gyors magyar podcast epizódok: napi hírösszefoglalók, percpodcastok, rövid hírelemzések, friss aktualitások tömören. 5-15 perces formátumok, lényegre törő tartalom.',
   'light', 150, true, 0.95, 0.05, 0.5)
ON CONFLICT (slug) DO NOTHING;

-- 3. Set short_description for existing moods that lack one
UPDATE public.mood_collections SET short_description = COALESCE(short_description, description) WHERE short_description IS NULL;

-- 4. Set time_affinity for ALL active moods. Keys: morning, afternoon, evening, night.
UPDATE public.mood_collections SET time_affinity = jsonb_build_object(
  'morning', CASE slug
    WHEN 'reggeli-radio' THEN 1.0
    WHEN 'munkaba-menet' THEN 1.0
    WHEN 'vilag-esemenyei' THEN 0.85
    WHEN 'gyors-frissites' THEN 0.9
    WHEN 'edzeshez' THEN 0.7
    WHEN 'mosolyogashoz' THEN 0.5
    WHEN 'tanulashoz' THEN 0.5
    WHEN 'uzleti-inspiracio' THEN 0.6
    WHEN 'penzugyi-gondolkodas' THEN 0.55
    WHEN 'kulturahoz' THEN 0.35
    WHEN 'filmekhez' THEN 0.25
    WHEN 'hosszu-utra' THEN 0.4
    WHEN 'nyugodt-beszelgetesek' THEN 0.4
    WHEN 'elmelyuleshez' THEN 0.35
    WHEN 'elalvashoz' THEN 0.05
    ELSE 0.3 END,
  'afternoon', CASE slug
    WHEN 'uzleti-inspiracio' THEN 0.9
    WHEN 'tanulashoz' THEN 0.85
    WHEN 'edzeshez' THEN 0.85
    WHEN 'penzugyi-gondolkodas' THEN 0.8
    WHEN 'vilag-esemenyei' THEN 0.7
    WHEN 'gyors-frissites' THEN 0.65
    WHEN 'mosolyogashoz' THEN 0.6
    WHEN 'hosszu-utra' THEN 0.6
    WHEN 'munkaba-menet' THEN 0.5
    WHEN 'kulturahoz' THEN 0.45
    WHEN 'filmekhez' THEN 0.45
    WHEN 'elmelyuleshez' THEN 0.45
    WHEN 'nyugodt-beszelgetesek' THEN 0.4
    WHEN 'reggeli-radio' THEN 0.15
    WHEN 'elalvashoz' THEN 0.05
    ELSE 0.4 END,
  'evening', CASE slug
    WHEN 'elmelyuleshez' THEN 0.95
    WHEN 'filmekhez' THEN 0.9
    WHEN 'kulturahoz' THEN 0.85
    WHEN 'nyugodt-beszelgetesek' THEN 0.85
    WHEN 'mosolyogashoz' THEN 0.8
    WHEN 'hosszu-utra' THEN 0.7
    WHEN 'tanulashoz' THEN 0.55
    WHEN 'vilag-esemenyei' THEN 0.55
    WHEN 'uzleti-inspiracio' THEN 0.4
    WHEN 'penzugyi-gondolkodas' THEN 0.4
    WHEN 'gyors-frissites' THEN 0.35
    WHEN 'edzeshez' THEN 0.45
    WHEN 'munkaba-menet' THEN 0.15
    WHEN 'reggeli-radio' THEN 0.05
    WHEN 'elalvashoz' THEN 0.5
    ELSE 0.4 END,
  'night', CASE slug
    WHEN 'elalvashoz' THEN 1.0
    WHEN 'nyugodt-beszelgetesek' THEN 0.9
    WHEN 'elmelyuleshez' THEN 0.8
    WHEN 'kulturahoz' THEN 0.6
    WHEN 'filmekhez' THEN 0.55
    WHEN 'hosszu-utra' THEN 0.4
    WHEN 'mosolyogashoz' THEN 0.35
    WHEN 'tanulashoz' THEN 0.3
    ELSE 0.1 END
), default_reason_label = CASE slug
  WHEN 'elalvashoz' THEN 'Esti pihenéshez'
  WHEN 'munkaba-menet' THEN 'Reggelre ajánlva'
  WHEN 'reggeli-radio' THEN 'Reggelre ajánlva'
  WHEN 'edzeshez' THEN 'Energikus tempó'
  WHEN 'hosszu-utra' THEN 'Hosszabb hallgatáshoz'
  WHEN 'vilag-esemenyei' THEN 'Friss témák'
  WHEN 'mosolyogashoz' THEN 'Könnyed hangulat'
  WHEN 'tanulashoz' THEN 'Ha tanulnál valamit'
  WHEN 'elmelyuleshez' THEN 'Elmélyüléshez'
  WHEN 'uzleti-inspiracio' THEN 'Üzleti inspiráció'
  WHEN 'penzugyi-gondolkodas' THEN 'Pénzügyi gondolkodás'
  WHEN 'kulturahoz' THEN 'Kulturális válogatás'
  WHEN 'filmekhez' THEN 'Mozis hangulat'
  WHEN 'nyugodt-beszelgetesek' THEN 'Nyugodtabb tempó'
  WHEN 'gyors-frissites' THEN 'Gyors hallgatáshoz'
  ELSE 'Népszerű most' END
WHERE active = true;

-- 5. Topic hints + per-mood weights for the 6 brand-new moods (existing moods left as-is)
UPDATE public.mood_collections SET
  positive_topic_hints = ARRAY['vállalkozás','startup','cégépítés','vezetés','marketing','sales','growth','alapító'],
  negative_topic_hints = ARRAY['kibeszélő','pletyka','botrány']
WHERE slug = 'uzleti-inspiracio';
UPDATE public.mood_collections SET
  positive_topic_hints = ARRAY['befektetés','tőzsde','részvény','makro','infláció','állampapír','etf','portfólió','jegybank'],
  negative_topic_hints = ARRAY['lottó','szerencsejáték','crypto pump']
WHERE slug = 'penzugyi-gondolkodas';
UPDATE public.mood_collections SET
  positive_topic_hints = ARRAY['könyv','irodalom','színház','művészet','kortárs','klasszikus','esszé','kritika'],
  negative_topic_hints = ARRAY['celeb','botrány']
WHERE slug = 'kulturahoz';
UPDATE public.mood_collections SET
  positive_topic_hints = ARRAY['film','mozi','sorozat','rendező','színész','kritika','streaming','filmtörténet'],
  negative_topic_hints = ARRAY[]::text[]
WHERE slug = 'filmekhez';
UPDATE public.mood_collections SET
  positive_topic_hints = ARRAY['interjú','beszélgetés','történet','pszichológia','mindfulness','reflexió'],
  negative_topic_hints = ARRAY['politika','botrány','hír','kiabálás']
WHERE slug = 'nyugodt-beszelgetesek';
UPDATE public.mood_collections SET
  positive_topic_hints = ARRAY['hír','napi','összefoglaló','rövid','percpodcast','aktuális'],
  negative_topic_hints = ARRAY[]::text[]
WHERE slug = 'gyors-frissites';

-- 6. Mood episode recommendations RPC
CREATE OR REPLACE FUNCTION public.get_mood_episode_recommendations(
  p_mood_slug text,
  p_limit integer DEFAULT 12,
  p_exclude uuid[] DEFAULT '{}'::uuid[]
)
RETURNS TABLE(
  episode_id uuid,
  podcast_id uuid,
  similarity double precision,
  final_score double precision,
  title text,
  display_title text,
  slug text,
  ai_summary text,
  summary text,
  description text,
  published_at timestamptz,
  audio_url text,
  image_url text,
  topics text[],
  podcast_slug text,
  podcast_title text,
  podcast_display_title text,
  podcast_image_url text,
  podcast_category text,
  podiverzum_rank numeric,
  rank_label text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seed vector(768);
  v_fresh numeric;
  v_ever numeric;
  v_quality numeric;
BEGIN
  SELECT mc.seed_embedding,
         COALESCE(mc.freshness_weight, 0.5),
         COALESCE(mc.evergreen_weight, 0.5),
         COALESCE(mc.source_quality_weight, 0.5)
    INTO v_seed, v_fresh, v_ever, v_quality
  FROM public.mood_collections mc
  WHERE mc.slug = p_mood_slug AND mc.active = true;

  IF v_seed IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT ee.episode_id, ee.podcast_id,
           1.0 - (ee.embedding <=> v_seed) AS sim
    FROM public.episode_embeddings ee
    JOIN public.podcasts p ON p.id = ee.podcast_id
    WHERE p.is_hungarian = true
      AND p.language_decision = 'accept_hungarian'
      AND COALESCE(p.rss_status, 'unknown') NOT IN ('dead','removed')
      AND NOT (ee.episode_id = ANY(p_exclude))
    ORDER BY ee.embedding <=> v_seed
    LIMIT 120
  ),
  enriched AS (
    SELECT
      c.episode_id, c.podcast_id, c.sim,
      e.title, e.display_title, e.slug, e.ai_summary, e.summary, e.description,
      e.published_at, e.audio_url, e.image_url, e.topics,
      p.slug AS p_slug, p.title AS p_title, p.display_title AS p_display_title,
      p.image_url AS p_image_url, p.category AS p_category,
      p.podiverzum_rank, p.rank_label,
      (CASE p.rank_label WHEN 'S' THEN 0.10 WHEN 'A' THEN 0.06 WHEN 'B' THEN 0.02 ELSE 0 END) * v_quality * 2 AS quality_boost,
      CASE
        WHEN e.published_at IS NULL THEN 0
        WHEN e.published_at >= now() - interval '30 days' THEN 0.10 * v_fresh
        WHEN e.published_at >= now() - interval '90 days' THEN 0.05 * v_fresh
        ELSE 0
      END AS fresh_boost,
      CASE
        WHEN e.published_at IS NULL THEN 0
        WHEN e.published_at < now() - interval '180 days'
             AND e.ai_summary IS NOT NULL
             AND length(e.ai_summary) > 200 THEN 0.06 * v_ever
        ELSE 0
      END AS ever_boost,
      CASE
        WHEN e.ai_summary IS NULL OR length(COALESCE(e.ai_summary, '')) < 60 THEN -0.06
        ELSE 0
      END AS meta_penalty
    FROM candidates c
    JOIN public.episodes e ON e.id = c.episode_id
    JOIN public.podcasts p ON p.id = c.podcast_id
    WHERE c.sim >= 0.5
  ),
  scored AS (
    SELECT *,
      sim + quality_boost + fresh_boost + ever_boost + meta_penalty AS score,
      row_number() OVER (
        PARTITION BY podcast_id
        ORDER BY (sim + quality_boost + fresh_boost + ever_boost + meta_penalty) DESC
      ) AS rn
    FROM enriched
  )
  SELECT
    s.episode_id, s.podcast_id, s.sim, s.score,
    s.title, s.display_title, s.slug, s.ai_summary, s.summary, s.description,
    s.published_at, s.audio_url, s.image_url, s.topics,
    s.p_slug, s.p_title, s.p_display_title, s.p_image_url, s.p_category,
    s.podiverzum_rank, s.rank_label
  FROM scored s
  WHERE s.rn <= 2
  ORDER BY s.score DESC
  LIMIT GREATEST(1, LEAST(p_limit, 40));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_mood_episode_recommendations(text, integer, uuid[]) TO anon, authenticated;

-- 7. Personalized mood cards RPC
CREATE OR REPLACE FUNCTION public.get_personalized_mood_cards(
  p_viewport text DEFAULT 'desktop',
  p_hour integer DEFAULT NULL,
  p_dow integer DEFAULT NULL
)
RETURNS TABLE(
  slug text,
  title text,
  description text,
  short_description text,
  href text,
  reason_label text,
  sort_order integer,
  energy_level text,
  representative_episode_count integer
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_limit integer;
  v_bucket text;
BEGIN
  v_limit := CASE lower(COALESCE(p_viewport, 'desktop'))
    WHEN 'mobile' THEN 4
    ELSE 6
  END;

  v_bucket := CASE
    WHEN p_hour IS NULL THEN 'afternoon'
    WHEN p_hour BETWEEN 5 AND 10 THEN 'morning'
    WHEN p_hour BETWEEN 11 AND 16 THEN 'afternoon'
    WHEN p_hour BETWEEN 17 AND 22 THEN 'evening'
    ELSE 'night'
  END;

  RETURN QUERY
  WITH base AS (
    SELECT
      m.slug, m.title, m.description, m.short_description,
      m.sort_order, m.energy_level, m.default_reason_label,
      m.recommended_episode_count,
      COALESCE((m.time_affinity ->> v_bucket)::numeric, 0.3) AS aff
    FROM public.mood_collections m
    WHERE m.active = true
  )
  SELECT
    b.slug,
    b.title,
    b.description,
    b.short_description,
    '/hangulat/' || b.slug AS href,
    CASE
      WHEN b.aff >= 0.7 THEN
        CASE v_bucket
          WHEN 'morning' THEN 'Reggelre ajánlva'
          WHEN 'afternoon' THEN 'Most ajánlott'
          WHEN 'evening' THEN 'Estére ajánlva'
          ELSE 'Esti pihenéshez'
        END
      ELSE COALESCE(b.default_reason_label, 'Népszerű most')
    END AS reason_label,
    b.sort_order,
    b.energy_level,
    b.recommended_episode_count
  FROM base b
  ORDER BY b.aff DESC, b.sort_order ASC
  LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_personalized_mood_cards(text, integer, integer) TO anon, authenticated;