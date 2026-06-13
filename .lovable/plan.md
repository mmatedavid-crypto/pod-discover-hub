## Mit csinálunk

Két dolog, ahogy kérted:

1. **Nem hagyjuk benn a zavaros rendszereket még read-only-ként sem.** Az `episodes.topics` tömb (100 270 epizód, kevert angol/magyar RSS+AI szemét) és az `episode_ai_classifications` tábla (131 623 sor, 79-elemes angol/magyar keverék taxonómia) **nem hivatkozható többet sehonnan a frontendből**. Maga az adat törlésre kerül kódból elérhető helyekről, a táblákat csak admin-only marad olvashatóként (RLS lezárás), hogy egy későbbi audithoz visszanézhető legyen — de a UI-ban és a publikus API-kban nem lesznek.

2. **Az `episode_extracted_topics` (134 774 sor, 28 166 epizód, 115 544 különböző label) klaszterezése.** Ez a rendszer minőségileg messze a legjobb (magyar, specifikus, evidence-alapú: „magyar péter” 121, „orbán viktor” 111, „orosz-ukrán háború” 87, „mesterséges intelligencia” 86, „önismeret” 57…). A baj csak az, hogy a long-tail miatt 115k variáns van. Ezt klaszterezzük le egy **kanonikus magyar témakészletre**, és **ez** lesz az egyetlen publikus tématár.

## Hogyan klaszterezünk (egyszerű, olcsó, determinisztikus)

Nem új AI futás kell. Két lépcsős, SQL + egy kicsi script:

**1. lépcső — determinisztikus összevonás (95% lefedettség, $0):**
- normalizálás (lowercase, ékezet nélkül, szóköz-trim) — már megvan
- lemmatizáció + szuffixum-levágás (`-ról/-ről/-ban/-ben/-ja/-je/-k` stb.)
- alias-egyenértékűségek (`ai` = `mesterséges intelligencia` = `mi` = `gpt` = `llm`, `orbán` = `orbán viktor`, `oroszország háborúja` = `orosz-ukrán háború`, stb.)
- ezek mind beleülnek a meglévő `topic_aliases` táblába

**2. lépcső — embedding-alapú klaszter a maradékra (~5k label, egyszeri ~$2):**
- a már meglévő `google/gemini-embedding-001` (768d) modellel a top ~5000 maradék label embedjét legyártjuk
- agglomeratív klaszterezés cosine ≥ 0.82 küszöbbel
- minden klaszternek a leggyakoribb label lesz a **kanonikus magyar neve**
- < 3 epizódot lefedő klaszterek mehetnek „long tail” bucketbe (nem indexálható)

A végeredmény: ~150-300 kanonikus magyar téma, mindegyikhez slug, leírás, és tényleges, evidence-alapú epizód-lefedettség.

## Mit írunk át / törlünk

**Adatbázis (migráció):**
- új `topic_clusters` tábla (cluster_id, canonical_label_hu, slug, episode_count, is_indexable) — ÉS a kötelező GRANT-ek
- új `episode_topic_cluster_map` (episode_id, cluster_id, confidence) — szintén GRANT-ek
- `topics` + `episode_topic_map` (a régi 79-elemes kanonikus tábla) marad, de **a klaszter-eredmények ide is feltöltődnek** (egy forrás)
- RLS lezárás: `episode_ai_classifications` és `episode_extracted_topics` csak `service_role` SELECT — anon/authenticated nem érheti el
- `episodes.topics` oszlop nem törlődik fizikailag (drága lenne), de a publikus selectekből kivesszük

**Frontend (csak ezek):**
- `src/components/EpisodeCard.tsx`: téma-chipek forrása `episode_topic_cluster_map` JOIN `topic_clusters`-en — semmi más
- `src/lib/episodeUnderstanding.ts`: `topics` mező onnan
- `src/lib/aggregateEntities.ts`: ugyanonnan
- `src/pages/TopicDetailPage.tsx` + `TopicsHubPage.tsx`: új klaszterek
- `src/components/PodcastEntitiesCompact.tsx`: ugyanezt használja
- a `PodcastReport2026.tsx` riport végleges adatai a klaszterekre építve

**Backend pipelines:**
- `episode-topic-extractor` marad **leállítva** amíg nincs új ep tömege (~1 hetente futtatjuk csak az új epizódokra, batch)
- új edge: `topic-cluster-runner` — egyszeri klaszterezés, futtatható kézzel, eredménye perzisztens
- `episode-ai-classifier` runner archiválva, nem fut többet

## Sorrend, kb. időigény

1. Migráció: `topic_clusters` + `episode_topic_cluster_map` + RLS-zár + GRANT-ek — ~10 perc
2. `topic-cluster-runner` edge function (determinisztikus szakasz + embedding-szakasz) — ~30 perc
3. Egyszeri futtatás, eredmény ellenőrzése admin oldalon — ~20 perc (a klaszterezés futása maga ~10-15 perc, ~$2)
4. Frontend átállítása a fenti 5 fájlban — ~20 perc
5. Riport (`PodcastReport2026`) regenerálás a klaszter-számokból — ~10 perc

**Összesen kb. 1,5 óra munkám, + ~$2 AI költség.** Visszafordítható (a régi táblák megmaradnak), de a UI-ban ettől kezdve **egyetlen** rendszer szolgáltatja a témákat.

## Mit nem csinálunk meg

- Nem nyúlunk a person/organization rendszerekhez (azok rendben vannak).
- Nem futtatunk újra Gemini-vel olyat, ami már le van futtatva — pont ezt akarjuk kiküszöbölni.
- Nem írom át a keresőt vagy a ranking-et, csak a téma-réteget.
