## Cél

A `szervezetek` oldalon ma 21 299 entitás van publikusként, **0 db wikipedia match**, **0 db AI bio**. Ezért egyik szervezet sem hoz SEO értéket, és a search-be sincsenek bekötve. A user kérése: ugyanúgy járjunk el, mint a `személyek`-kel — érdemes alapot építeni, párosítani Wikipediával, beemelni a query/search rétegbe — és közben **szűrjük ki a rádiókat**, amik csak azért vannak a katalógusban, mert nem clean text alapján zajlott a korai entity-extract.

## 1) Radio_station tisztítás (azonnal, migration)

194 `radio_station` van. Ezek többsége nem "podcastban említett" rádió, hanem csak a podcast forrása (publisher), mert a régi extract nem tisztított szövegen futott. Lépések:

- Minden `org_type='radio_station'` sor → `is_public=false, is_indexable=false, is_browsable_in_hub=false`, `browsable_reason='radio_publisher_noise'`.
- Whitelist kivétel (manuálisan visszahozva, mert valós szereplők): `Tilos Rádió`, `Kossuth Rádió`, `Klubrádió`, `InfoRádió`, `Szabad Európa Rádió`, `Petőfi Rádió`, `Bartók Rádió`, `Katolikus Rádió`, `Magyar Rádió` → ezek maradnak publikusak, és Wikidata-matchre kerülnek.
- A `Cégek / Média` fülön a `media` típus mellől levesszük a `radio_station` belistázást (`CompaniesHubPage.tsx`).
- `OrganizationsIndexPage.tsx` típus-szekciókból eltávolítjuk az `radio_station`-t (a 9 whitelistelt rádió a `media` szekcióba kerül átsorolva — vagy maradnak `radio_station` típuson és csak a hub-listából vesszük ki őket).

## 2) Wiki-párosító edge function (`organization-wikimedia-enricher`)

`person-wikimedia-enricher` mintájára:

- Wikidata search (HU → EN fallback), 5 jelölt.
- Pontozás: label-egyezés (0.35), huwiki sitelink (0.2), `instance_of` ellenőrzés org-típushoz (party→Q7278, company→Q4830453, ngo→Q163740, university→Q3918, church→Q1530022, stb., +0.15 ha stimmel, -0.4 ha pl. human Q5), context-overlap az `episode_titles` + `podcast_titles` mezőkkel (0.1-0.25), single-word penalty (-0.2).
- Threshold: `verified≥0.65`, `needs_review≥0.4`, `no_match` alatta — ugyanaz mint a people-nél (Phase 2).
- Mentett mezők: `wikidata_id`, `wikipedia_url`, `wikipedia_title`, `wikipedia_extract` (≤1200 char), `wikipedia_description`, `wikipedia_match_status/confidence/evidence`, `wiki_match_run_at`, `wiki_match_reason`.
- Logo: `verified` esetén Wikidata P154 (logo) vagy P18, Commons-licensz ellenőrzés (reusable-only), letöltés `entity-images` bucketbe `organizations/{id}/original.{ext}`, mezők: `logo_url`, `logo_source='wikimedia'`, `logo_license`, `logo_attribution`.
- Job tracking: ha van `organization_enrichment_jobs` táblánk, beírjuk; ha nincs, csak az `organizations` mezőkre frissítünk és külön job-táblát most NEM hozok létre (kisebb scope).
- Cron: `*/3 * * * *`, 25 org/run — ugyanúgy mint a people-nél. Csak `is_public=true` + `gated_episode_count>=3` (alacsony zaj küszöb).

## 3) Gated indexability újraszámítás

A jelenlegi 21 299 publikus szervezet túl sok. A people-mintát követve:

- `0 ep` → nem publikus
- `1–2 ep` → publikus, **nem** indexable, nem browsable
- `3+ ep` → publikus + indexable + browsable
- Minden `party` (politikai relevancia) + minden `wikipedia_match_status='verified'` → felülíró: indexable+browsable még ha `<3 ep` is
- `radio_station` → mindig hidden, kivéve a 9 whitelist

`recompute_org_gated_counts()` RPC frissítése (vagy új `recompute_org_indexability()` RPC) és egyszeri lefuttatás migrationben.

## 4) Search integráció

A search-hybrid most nem hoz organizations találatokat. Hozzáadunk egy egyszerű lépést:

- A query-understanding `entity_candidates` mezőbe felvesszük az `organizations` táblát is (név + alias ILIKE match), csak `is_indexable=true` szűrővel.
- Search-result-ben "Szervezet" típusú kártya, link `/ceg/{slug}` vagy `/part/{slug}`.
- Részletek: külön technikai szekció a search-hybrid-en belül `match_org_by_name()` RPC hívással, threshold mention_count alapján.

## 5) AI bio (későbbi sprint, nem most)

A `person-bio-generator` analógiájára `organization-bio-generator` kell, de ez külön sprint. **Most NEM** építjük meg — előbb Wikipedia legyen lefedve, és csak a top 200 szervezetre futtatunk AI bio-t (költségkímélés).

## Technikai részletek

- Új edge function: `supabase/functions/organization-wikimedia-enricher/index.ts`
- Új cron job (jobid 44 körül): `*/3 * * * *` → hívja a fenti edge functiont, body `{ limit: 25 }`
- Migration:
  - Radio whitelist + hide minden más radio_station
  - `recompute_org_indexability()` RPC + egyszeri futtatás
  - (opcionálisan) `match_org_by_name(query text)` RPC search-hez
- Frontend:
  - `OrganizationsIndexPage.tsx`: `radio_station` szekció törlése (vagy whitelistre szűkítés)
  - `CompaniesHubPage.tsx`: `Media` tab típuslistából `radio_station` levétel (vagy hagyni, mert a query úgyis csak indexable-eket hoz)
  - `OrgCard`: ha van `wikipedia_url`, mutassunk egy apró Wiki badge-et
  - `OrganizationsIndexPage` query-iba: `is_indexable=true` szűrő (ne csak `is_public`)

## Becsült futásidő a wiki enricherre

21k publikus → 3+ ep után ~5-6k indexable → ~2 nap futás `*/3` cron mellett, 25/run sebességgel.

## Mit NEM csinálunk most

- Nem építünk AI bio-t (külön sprint)
- Nem nyúlunk a backfill runner-hez (az fut tovább, csak ez utána fut)
- Nem írunk át search ranking formulákat — csak hozzáadjuk a szervezeteket a candidate set-be

---

Kérlek hagyd jóvá, vagy mondd, ha valamit szűkítenénk / bővítenénk (pl. ha az AI bio is kéne most, vagy ha a search integrációt későbbre tolnánk).