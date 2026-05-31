-- Hungarian topic synonym registry expansion.
-- This turns canonical_entity_aliases into a real shared topic synonym layer:
-- every public topic gets deterministic aliases, then high-value Hungarian
-- common-language synonyms are projected into topic_aliases for search,
-- extraction, homepage rails and entity links.

WITH topic_base AS (
  SELECT
    slug,
    name,
    coalesce(short_name, name) AS short_name
  FROM public.topics
  WHERE is_public = true
),
auto_aliases AS (
  SELECT slug, name, name AS alias, 100 AS weight, 'topic_auto_name' AS source, 'topic name' AS notes
  FROM topic_base
  UNION ALL
  SELECT slug, name, short_name AS alias, 96, 'topic_auto_short_name', 'topic short name'
  FROM topic_base
  WHERE short_name IS NOT NULL AND short_name <> name
  UNION ALL
  SELECT slug, name, replace(slug, '-', ' ') AS alias, 92, 'topic_auto_slug_phrase', 'slug phrase'
  FROM topic_base
),
curated_aliases(canonical_slug, canonical_name, alias, weight, notes) AS (
  VALUES
    -- Sport
    ('labdarugas','Labdarúgás','labdarúgás',100,'primary'),
    ('labdarugas','Labdarúgás','foci',98,'hu common synonym'),
    ('labdarugas','Labdarúgás','futball',98,'hu common synonym'),
    ('labdarugas','Labdarúgás','focis',86,'inflected common form'),
    ('labdarugas','Labdarúgás','futballos',82,'inflected common form'),
    ('labdarugas','Labdarúgás','magyar foci',90,'compound synonym'),
    ('labdarugas','Labdarúgás','magyar futball',88,'compound synonym'),
    ('labdarugas','Labdarúgás','NB I',84,'domestic league context'),
    ('labdarugas','Labdarúgás','NBI',82,'domestic league spelling'),
    ('labdarugas','Labdarúgás','válogatott foci',82,'compound synonym'),
    ('kosarlabda','Kosárlabda','kosár',92,'hu short form'),
    ('kosarlabda','Kosárlabda','kosárlabda',100,'primary'),
    ('kosarlabda','Kosárlabda','basketball',72,'en synonym'),
    ('futas','Futás','futás',100,'primary'),
    ('futas','Futás','running',72,'en synonym'),
    ('sport','Sport általában','sport',100,'primary'),
    ('sport','Sport általában','sportok',78,'plural'),

    -- AI / tech
    ('mesterseges-intelligencia','Mesterséges intelligencia','mesterséges intelligencia',100,'primary'),
    ('mesterseges-intelligencia','Mesterséges intelligencia','MI',98,'hu abbreviation'),
    ('mesterseges-intelligencia','Mesterséges intelligencia','AI',98,'common abbreviation'),
    ('mesterseges-intelligencia','Mesterséges intelligencia','GenAI',88,'common abbreviation'),
    ('mesterseges-intelligencia','Mesterséges intelligencia','generatív AI',90,'common phrase'),
    ('mesterseges-intelligencia','Mesterséges intelligencia','ChatGPT',86,'product used as topic proxy'),
    ('mesterseges-intelligencia','Mesterséges intelligencia','LLM',84,'technical alias'),
    ('mesterseges-intelligencia','Mesterséges intelligencia','gépi tanulás',72,'related technical alias'),
    ('technologia','Technológia','technológia',100,'primary'),
    ('technologia','Technológia','tech',94,'common short form'),
    ('technologia','Technológia','IT',86,'common abbreviation'),
    ('digitalizacio','Digitalizáció','digitalizáció',100,'primary'),
    ('digitalizacio','Digitalizáció','digitális átállás',84,'common phrase'),
    ('kiberbiztonsag','Kiberbiztonság','kiberbiztonság',100,'primary'),
    ('kiberbiztonsag','Kiberbiztonság','cybersecurity',76,'en synonym'),
    ('kiberbiztonsag','Kiberbiztonság','hackelés',70,'related common phrase'),
    ('szoftver','Szoftverfejlesztés','szoftverfejlesztés',100,'primary'),
    ('szoftver','Szoftverfejlesztés','programozás',86,'common synonym'),
    ('szoftver','Szoftverfejlesztés','fejlesztés',70,'common shorthand'),

    -- Politics / public life
    ('kozelet','Közélet','közélet',100,'primary'),
    ('kozelet','Közélet','közügyek',88,'common synonym'),
    ('magyar-politika','Magyar politika','politika',100,'primary'),
    ('magyar-politika','Magyar politika','belpolitika',92,'common synonym'),
    ('magyar-politika','Magyar politika','magyar belpolitika',90,'compound synonym'),
    ('magyar-politika','Magyar politika','parlament',78,'strong contextual alias'),
    ('kulpolitika','Külpolitika','külpolitika',100,'primary'),
    ('kulpolitika','Külpolitika','nemzetközi politika',88,'common phrase'),
    ('valasztas','Választás','választás',100,'primary'),
    ('valasztas','Választás','választások',96,'plural'),
    ('valasztas','Választás','országgyűlési választás',86,'compound phrase'),
    ('valasztas','Választás','önkormányzati választás',84,'compound phrase'),
    ('europai-unio','Európai Unió','Európai Unió',100,'primary'),
    ('europai-unio','Európai Unió','EU',96,'abbreviation'),
    ('europai-unio','Európai Unió','Brüsszel',70,'contextual alias'),
    ('haboru','Háború','háború',100,'primary'),
    ('haboru','Háború','orosz ukrán háború',90,'major current context'),
    ('haboru','Háború','ukrajnai háború',90,'major current context'),

    -- Economy / business
    ('gazdasag','Gazdaság','gazdaság',100,'primary'),
    ('gazdasag','Gazdaság','gazdasági',84,'inflected'),
    ('magyar-gazdasag','Magyar gazdaság','magyar gazdaság',100,'primary'),
    ('makrogazdasag','Makrogazdaság','makrogazdaság',100,'primary'),
    ('makrogazdasag','Makrogazdaság','makro',86,'common shorthand'),
    ('penzugy','Pénzügy','pénzügy',100,'primary'),
    ('penzugy','Pénzügy','pénzügyek',92,'plural'),
    ('penzugy','Pénzügy','personal finance',72,'en phrase'),
    ('befektetes','Befektetés','befektetés',100,'primary'),
    ('befektetes','Befektetés','befektetések',94,'plural'),
    ('befektetes','Befektetés','befektetési',80,'inflected'),
    ('tozsde','Tőzsde','tőzsde',100,'primary'),
    ('tozsde','Tőzsde','részvény',92,'related common alias'),
    ('tozsde','Tőzsde','részvények',90,'plural'),
    ('tozsde','Tőzsde','BÉT',84,'market abbreviation'),
    ('inflacio','Infláció','infláció',100,'primary'),
    ('inflacio','Infláció','drágulás',82,'common synonym'),
    ('ingatlan','Ingatlan','ingatlan',100,'primary'),
    ('ingatlan','Ingatlan','lakáspiac',86,'common phrase'),
    ('allampapir','Állampapír','állampapír',100,'primary'),
    ('allampapir','Állampapír','máp plusz',76,'product shorthand'),
    ('vallalkozas','Vállalkozás','vállalkozás',100,'primary'),
    ('vallalkozas','Vállalkozás','business',82,'en synonym'),
    ('vallalkozas','Vállalkozás','üzlet',88,'common synonym'),
    ('cegepites','Cégépítés','cégépítés',100,'primary'),
    ('cegepites','Cégépítés','vállalkozásépítés',88,'common synonym'),
    ('startup','Startup','startup',100,'primary'),
    ('startup','Startup','start-up',92,'spelling variant'),
    ('marketing','Marketing','marketing',100,'primary'),
    ('online-marketing','Online marketing','online marketing',100,'primary'),
    ('online-marketing','Online marketing','digitális marketing',88,'common synonym'),

    -- Health / psychology / family
    ('egeszseg','Egészség','egészség',100,'primary'),
    ('egeszseg','Egészség','egészségügy',82,'related common alias'),
    ('egeszseges-eletmod','Egészséges életmód','egészséges életmód',100,'primary'),
    ('egeszseges-eletmod','Egészséges életmód','életmód',88,'common shorthand'),
    ('taplalkozas','Táplálkozás','táplálkozás',100,'primary'),
    ('taplalkozas','Táplálkozás','étrend',88,'common synonym'),
    ('taplalkozas','Táplálkozás','diéta',82,'common synonym'),
    ('alvas','Alvás','alvás',100,'primary'),
    ('alvas','Alvás','inszomnia',78,'related alias'),
    ('mentalis-egeszseg','Mentális egészség','mentális egészség',100,'primary'),
    ('mentalis-egeszseg','Mentális egészség','lelki egészség',92,'common synonym'),
    ('mentalis-egeszseg','Mentális egészség','szorongás',76,'major subtopic alias'),
    ('pszichologia','Pszichológia','pszichológia',100,'primary'),
    ('pszichologia','Pszichológia','pszicho',78,'common shorthand'),
    ('pszichologia','Pszichológia','lélektan',82,'hu synonym'),
    ('onismeret','Önismeret','önismeret',100,'primary'),
    ('onismeret','Önismeret','önfejlesztés',92,'common synonym'),
    ('onismeret','Önismeret','személyiségfejlesztés',82,'common synonym'),
    ('parkapcsolat','Párkapcsolat','párkapcsolat',100,'primary'),
    ('parkapcsolat','Párkapcsolat','kapcsolat',84,'common shorthand'),
    ('parkapcsolat','Párkapcsolat','szerelem',76,'related alias'),
    ('gyerekneveles','Gyereknevelés','gyereknevelés',100,'primary'),
    ('gyerekneveles','Gyereknevelés','gyermeknevelés',96,'formal synonym'),
    ('gyerekneveles','Gyereknevelés','szülőség',90,'common synonym'),
    ('csalad','Család','család',100,'primary'),
    ('csalad','Család','családi élet',84,'common phrase'),

    -- Culture / media / knowledge
    ('film','Film','film',100,'primary'),
    ('film','Film','mozi',88,'common synonym'),
    ('sorozatok','Sorozatok','sorozatok',100,'primary'),
    ('sorozatok','Sorozatok','tévésorozat',82,'common synonym'),
    ('zene','Zene','zene',100,'primary'),
    ('zene','Zene','muzsika',72,'synonym'),
    ('konyvek','Könyvek','könyvek',100,'primary'),
    ('konyvek','Könyvek','irodalom',86,'related common alias'),
    ('media','Média','média',100,'primary'),
    ('media','Média','sajtó',86,'common synonym'),
    ('tudomany','Tudomány','tudomány',100,'primary'),
    ('tudomany','Tudomány','science',72,'en synonym'),
    ('tortenelem','Történelem','történelem',100,'primary'),
    ('tortenelem','Történelem','história',78,'synonym'),
    ('oktatas','Oktatás','oktatás',100,'primary'),
    ('oktatas','Oktatás','edukáció',82,'synonym'),
    ('tanulas','Tanulás','tanulás',100,'primary'),
    ('tanulas','Tanulás','tanulási módszerek',80,'compound phrase'),

    -- Society / spirituality
    ('tarsadalom','Társadalom','társadalom',100,'primary'),
    ('tarsadalom','Társadalom','szociológia',72,'related alias'),
    ('bunugy','Bűnügy','bűnügy',100,'primary'),
    ('bunugy','Bűnügy','true crime',88,'common genre'),
    ('true-crime','True crime','true crime',100,'primary'),
    ('true-crime','True crime','bűnügyi történetek',82,'genre phrase'),
    ('vallas','Vallás','vallás',100,'primary'),
    ('vallas','Vallás','hit',86,'common related alias'),
    ('keresztenyseg','Kereszténység','kereszténység',100,'primary'),
    ('keresztenyseg','Kereszténység','keresztény',82,'inflected'),
    ('biblia','Biblia','Biblia',100,'primary'),
    ('biblia','Biblia','Szentírás',88,'synonym'),
    ('spiritualitas','Spiritualitás','spiritualitás',100,'primary'),
    ('spiritualitas','Spiritualitás','spirituális',82,'inflected'),
    ('meditacio','Meditáció','meditáció',100,'primary'),
    ('meditacio','Meditáció','mindfulness',82,'common synonym')
),
all_aliases AS (
  SELECT 'topic'::text AS entity_kind, slug AS canonical_slug, name AS canonical_name, alias, weight, source, notes
  FROM auto_aliases
  WHERE alias IS NOT NULL AND length(trim(alias)) >= 2
  UNION ALL
  SELECT 'topic', canonical_slug, canonical_name, alias, weight, 'hu_topic_synonym_registry_v2', notes
  FROM curated_aliases
)
INSERT INTO public.canonical_entity_aliases (
  entity_kind, canonical_slug, canonical_name, alias, normalized_alias,
  weight, status, source, notes, updated_at
)
SELECT
  a.entity_kind,
  a.canonical_slug,
  a.canonical_name,
  a.alias,
  public.normalize_entity_alias(a.alias),
  a.weight,
  'active',
  a.source,
  a.notes,
  now()
FROM all_aliases a
JOIN public.topics t ON t.slug = a.canonical_slug
WHERE t.is_public = true
ON CONFLICT (entity_kind, normalized_alias, canonical_slug) DO UPDATE
SET canonical_name = EXCLUDED.canonical_name,
    alias = EXCLUDED.alias,
    weight = GREATEST(public.canonical_entity_aliases.weight, EXCLUDED.weight),
    status = 'active',
    source = EXCLUDED.source,
    notes = COALESCE(EXCLUDED.notes, public.canonical_entity_aliases.notes),
    updated_at = now();

INSERT INTO public.topic_aliases (topic_id, alias, normalized_alias, weight)
SELECT
  t.id,
  a.alias,
  a.normalized_alias,
  a.weight
FROM public.canonical_entity_aliases a
JOIN public.topics t ON t.slug = a.canonical_slug
WHERE a.entity_kind = 'topic'
  AND a.status = 'active'
ON CONFLICT (topic_id, normalized_alias) DO UPDATE
SET alias = EXCLUDED.alias,
    weight = GREATEST(public.topic_aliases.weight, EXCLUDED.weight);

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'canonical_alias_policy',
  COALESCE((SELECT value FROM public.app_settings WHERE key = 'canonical_alias_policy'), '{}'::jsonb)
  || jsonb_build_object(
    'version', 'canonical_aliases_v2',
    'hu_topic_synonym_registry', 'hu_topic_synonym_registry_v2',
    'auto_topic_aliases_enabled', true,
    'curated_hu_topic_aliases', (
      SELECT count(*)
      FROM public.canonical_entity_aliases
      WHERE entity_kind = 'topic'
        AND status = 'active'
        AND source = 'hu_topic_synonym_registry_v2'
    ),
    'last_topic_synonym_seed_at', now(),
    'note', 'Topic aliases now combine deterministic topic aliases with curated Hungarian common-language synonyms.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'version', 'canonical_aliases_v2',
    'hu_topic_synonym_registry', 'hu_topic_synonym_registry_v2',
    'auto_topic_aliases_enabled', true,
    'curated_hu_topic_aliases', (
      SELECT count(*)
      FROM public.canonical_entity_aliases
      WHERE entity_kind = 'topic'
        AND status = 'active'
        AND source = 'hu_topic_synonym_registry_v2'
    ),
    'last_topic_synonym_seed_at', now(),
    'note', 'Topic aliases now combine deterministic topic aliases with curated Hungarian common-language synonyms.'
  ),
  updated_at = now();
