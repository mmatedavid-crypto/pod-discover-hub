UPDATE public.people
SET
  short_bio = 'Zsiday Viktor magyar befektető, portfóliómenedzser. A HOLD (korábban Concorde) Alapkezelő Befektetési Bizottságának tagja, a Citadella Származtatott Befektetési Alap korábbi tanácsadója. Blogján (zsiday.hu) rendszeresen ír a magyar és globális makrogazdaságról, tőkepiacokról.',
  overview_text = 'Zsiday Viktor (született 1975) magyar befektető, portfóliómenedzser és tőzsdei elemző. 1996 óta foglalkozik tőkepiacokkal; első munkahelye a Wintrust Értékpapírügynökség (Pretium Holding) volt, ahol megismerkedett a határidős részvény-, deviza- és kamatpiaci kereskedéssel. 2000-től az AEGON csoportnál dolgozott elsősorban részvényvagyon-kezelőként. 2003-ban elindította Magyarország első abszolút hozamú befektetési alapját, 2006-ban két további abszolút hozamú származtatott alapot indított. Az általa kezelt AEGON közép-európai részvényalap 2000 és 2008 között a legmagasabb hozamú hazai részvényalap volt, a Citadella Alfa Származtatott Alap pedig indulásától 2008 végéig a legmagasabb hozamú magyarországi befektetési alap. 2009-től a Concorde (mai HOLD) Alapkezelővel közösen működtette a Citadella Származtatott Befektetési Alapot, amely 2025 végén több mint 120 milliárd forint vagyont kezelt, majd 2026 januárjában beolvadt a HOLD Columbus Befektetési Alapba. Zsiday 2011-ben alapította és vezette a Budapesti Értéktőzsdére vitt Plotinus Holding Nyrt.-t, amelyet 2017-ig irányított; a társaság befektetői ezen időszak alatt nagyjából megnégyszerezhették tőkéjüket. Ma a HOLD Alapkezelő Befektetési Bizottságának tagja, és zsiday.hu blogján rendszeresen elemzi a magyar és nemzetközi makrogazdasági-tőkepiaci fejleményeket. A magyar podcastszíntér egyik legkeresettebb szakértővendége, gyakori beszélgetőpartner a gazdasági, tőzsdei és befektetési témájú műsorokban.',
  ai_bio = 'Zsiday Viktor (született 1975) magyar befektető, portfóliómenedzser és tőzsdei elemző. 1996 óta foglalkozik tőkepiacokkal; első munkahelye a Wintrust Értékpapírügynökség (Pretium Holding) volt, ahol megismerkedett a határidős részvény-, deviza- és kamatpiaci kereskedéssel. 2000-től az AEGON csoportnál dolgozott elsősorban részvényvagyon-kezelőként. 2003-ban elindította Magyarország első abszolút hozamú befektetési alapját, 2006-ban két további abszolút hozamú származtatott alapot indított. Az általa kezelt AEGON közép-európai részvényalap 2000 és 2008 között a legmagasabb hozamú hazai részvényalap volt, a Citadella Alfa Származtatott Alap pedig indulásától 2008 végéig a legmagasabb hozamú magyarországi befektetési alap. 2009-től a Concorde (mai HOLD) Alapkezelővel közösen működtette a Citadella Származtatott Befektetési Alapot, amely 2025 végén több mint 120 milliárd forint vagyont kezelt, majd 2026 januárjában beolvadt a HOLD Columbus Befektetési Alapba. Zsiday 2011-ben alapította és vezette a Budapesti Értéktőzsdére vitt Plotinus Holding Nyrt.-t, amelyet 2017-ig irányított; a társaság befektetői ezen időszak alatt nagyjából megnégyszerezhették tőkéjüket. Ma a HOLD Alapkezelő Befektetési Bizottságának tagja, és zsiday.hu blogján rendszeresen elemzi a magyar és nemzetközi makrogazdasági-tőkepiaci fejleményeket. A magyar podcastszíntér egyik legkeresettebb szakértővendége, gyakori beszélgetőpartner a gazdasági, tőzsdei és befektetési témájú műsorokban.',
  short_description_hu = 'Magyar befektető, portfóliómenedzser, a HOLD Alapkezelő Befektetési Bizottságának tagja, a zsiday.hu blog szerzője.',
  disambiguation_label = 'Befektető, portfóliómenedzser (HOLD Alapkezelő)',
  disambiguation_context = 'Magyar befektető, a Citadella Alap egykori tanácsadója, a Plotinus Holding Nyrt. alapítója',
  occupation_labels = ARRAY['befektető','portfóliómenedzser','tőzsdei elemző','blogger'],
  ai_bio_status = 'published',
  ai_bio_confidence = 0.95,
  ai_bio_generated_at = now(),
  ai_bio_model = 'manual/curated',
  ai_bio_sources = coalesce(ai_bio_sources, '{}'::jsonb) || jsonb_build_object(
    'manual_curated', true,
    'sources', jsonb_build_array('https://zsiday.hu/bemutatkozas/', 'https://hu.wikipedia.org/wiki/HOLD_Alapkezelő'),
    'confidence', 0.95,
    'curated_at', to_char(now(),'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  ),
  overview_sources = coalesce(overview_sources, '{}'::jsonb) || jsonb_build_object(
    'manual_curated', true,
    'sources', jsonb_build_array('https://zsiday.hu/bemutatkozas/', 'https://hu.wikipedia.org/wiki/HOLD_Alapkezelő'),
    'confidence', 0.95
  ),
  overview_generated_at = now(),
  manual_approved = true,
  identity_status = 'confirmed',
  identity_ambiguous = false,
  is_public = true,
  is_indexable = true,
  activation_status = 'active',
  updated_at = now()
WHERE slug = 'zsiday-viktor';