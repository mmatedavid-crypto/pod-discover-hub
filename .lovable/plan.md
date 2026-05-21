# Organizations ernyő (cég/párt/intézmény/média/NGO)

A `people` és `topics` mintát követjük: egy közös `organizations` tábla `org_type` mezővel, közös pipeline (extract → normalize → Wikidata enrich → gated counts), de **két különálló hub** SEO szempontból (`/cegek` és `/partok`), és típusonkénti detail útvonal.

## 1. Schema (migration)

**`organizations`** — kanonikus tábla, a `people`-höz hasonló struktúrával:
- alap: `id`, `slug`, `name`, `normalized_name`, `org_type` (`company` | `party` | `institution` | `media` | `ngo`)
- enrichment: `wikidata_id`, `wikipedia_url`, `wikipedia_extract`, `logo_url`, `logo_source`, `short_description_hu`, `ai_bio`, `country`, `founded`, `headquarters`
- típus-specifikus: `ticker` (company), `political_color` (party), `sector` (company/media)
- gated counts: `episode_count`, `gated_episode_count`, `podcast_count`, `gated_podcast_count`, `latest_episode_at`
- gating flags: `is_public`, `is_indexable`, `is_browsable_in_hub`, `browsable_reason`
- enricher state: `wikipedia_match_status`, `wikipedia_match_confidence`, `wikipedia_match_evidence`, `wiki_match_run_at`
- editorial: `manually_seeded`, `editorial_priority`, `editorial_notes`
- standard: `created_at`, `updated_at`

**`organization_aliases`** — alias dedup (pl. "MOL" = "MOL Nyrt." = "Mol Magyar Olaj-")
- `id`, `organization_id`, `alias`, `normalized_alias`, `source`, `confidence`, `status`

**`episode_organization_map`** — epizód ↔ szervezet relation table
- `episode_id`, `organization_id`, `role` (`primary` | `mentioned`), `confidence`, `source` (`ai` | `editorial`)

**Seed lista (manuálisan):** ~30 ismert HU párt + nagy cégek + intézmények bekerülnek `manually_seeded=true` flag-gel, így a 0-epizódos állapotban is létezik a kanonikus rekord.

**RPC:** `recompute_org_gated_counts()` — a person mintára, 1+ ep → public + indexable + browsable.

## 2. AI extraction bővítés

`entity-backfill-runner` `extract_entities` tool kibővítése:
- jelenleg: `people`, `mentioned`, `companies`, `tickers`, `topics`
- új: `parties` (HU pártok külön tömb), `institutions` (állami/EU szervek), `media_outlets` (újságok, tévék)
- `companies` marad a privát cégeknek

Token-növekedés ~+15%, bekalkulálva a $50/nap budgetbe. `ai_entities_version` 2 → 3, hogy a már feldolgozott epizódokat újra végigfussa egyszer.

## 3. Organizations backfill runner

Új edge function: `organizations-backfill-runner`
- végigmegy az `episodes.companies`, `parties`, `institutions`, `media_outlets` arrayeken
- normalizál (lowercase, ékezet-eltávolítás, jogi forma törlése: "Nyrt.", "Kft.", "Zrt.")
- alias matching → ha létezik kanonikus org, kapcsolódik; ha nem, létrehoz új rekordot
- **párt-whitelist:** Fidesz, KDNP, Tisza, DK, MSZP, Momentum, Jobbik, Mi Hazánk, LMP, Párbeszéd, Kutyapárt, Mü, MKKP → mindenképp `party` típus
- ír az `episode_organization_map`-be
- `recompute_org_gated_counts()`-ot trigger-eli

Cron: `*/15 * * * *` drain alatt, utána `0 * * * *`.

## 4. Wikidata/Wikipedia enricher

Új edge function: `organization-wikimedia-enricher` (a `person-wikimedia-enricher` klónja, org-specifikus mezőkkel)
- HU + EN search fallback
- típus-detektálás Wikidata P31 alapján (Q4830453 → company, Q7278 → political party, Q31855 → research institute, stb.)
- logó: Wikipedia leadimage vagy Wikidata P154
- threshold: verified 0.65, needs_review 0.4
- Cron: `*/3 * * * *` drain alatt, ~25 org/run
- külön budget bucket: `org_enrich` $5/nap (people-vel párhuzamosan elfér a $50 globálisban)

## 5. Frontend

**Két hub oldal:**
- `/cegek` (CompaniesHubPage) — `org_type IN (company, media, ngo, institution)`, csoportosítva típus szerinti tabokkal vagy szekciókkal
- `/partok` (PartiesHubPage) — `org_type = party`, politikai szín szerinti vizuális rendezéssel, választási idővonal

**Két detail útvonal:**
- `/ceg/:slug` (CompanyDetailPage) — logó, bio, ticker (ha van), epizódok, kapcsolódó személyek (CEO-k, vezetők), kapcsolódó témák
- `/part/:slug` (PartyDetailPage) — logó/zászló, bio, vezetők (party president, frakcióvezető), epizódok, kapcsolódó témák, választási eredmények (jövőbeli)

`EntityPage.tsx` átirányítása: ha létezik kanonikus `organizations` rekord a slug-ra, redirect a tipizált útvonalra. Visszafelé kompatibilitás megmarad a régi `/company/:slug` URL-eknek 301-gyel.

**SEO:**
- külön sitemap szegmens: `sitemap-cegek.xml`, `sitemap-partok.xml`
- JSON-LD: `Organization` (cégekre), `PoliticalParty` (pártokra), `NewsMediaOrganization` (médiára)
- H1, meta description AI-generálva (`generate-org-seo` runner későbbi fázisban)
- `TrendingEntities` komponens új `party` és `media` ikonokkal

**Komponensek:**
- `OrgCard` — logó + név + epizód count + típus badge
- `OrgAvatar` (logó fallback inicialékra)
- `TopicDetailPage`-en új szekció: kapcsolódó cégek/pártok

## 6. Roll-out sorrend

1. **Schema migration** + seed (~30 párt + 50 nagy cég/intézmény manuálisan)
2. **AI extractor bővítés** + `ai_entities_version` bump → background reprocess indul
3. **Backfill runner** + cron jobid 38
4. **Wikidata enricher** + cron jobid 39 (a person-enricher után indul, nem előtte, hogy ne fojtsa meg a budgetet)
5. **Detail oldalak** (`/ceg/:slug`, `/part/:slug`) + redirect a régi `EntityPage`-ről
6. **Hub oldalak** (`/cegek`, `/partok`) + SiteHeader nav
7. **Sitemap + JSON-LD**

Becslés: schema + backfill 1 ülés, frontend 1-2 ülés, enrichment drain 4-6 óra.

## 7. Megjegyzések

- Globális AI budget marad $50/nap — az org-enricher és az AI extractor bővítés belefér, mert a person-enricher drain a hét végére befejeződik
- A `topics` és `people` rendszerrel együtt 3 erős entity-tengely → minden TopicDetailPage / PersonDetailPage / EpisodeDetail-en kereszthivatkozni tudunk
- Pártok esetén külön kezelni a frakciókat (Fidesz vs Fidesz-KDNP frakció) — `aliases` táblával oldható meg

**Memória frissítés:** új mem fájl `mem://features/organizations-umbrella.md` és index.md core bejegyzés a launch után.
