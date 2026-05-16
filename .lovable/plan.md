# Személy-entitások minőség-sprint

Három párhuzamos workstream, közös DB-séma migrációval indít, majd runner- és frontend-változások.

---

## 1. DB séma (egy migráció)

**`podcasts` tábla**
- `hosts text[] not null default '{}'` — kanonikus host-nevek (pl. `['Bochkor Gábor','Boros Lajos']`).
- `hosts_updated_at timestamptz` — mikor szerkesztette admin / AI utoljára.
- `hosts_source text` — `manual` | `ai_inferred` | `null`.

**`episodes` tábla**
- `mentioned text[] not null default '{}'` — csak említve, nincs jelen.
- `people` jelentése szigorodik: kizárólag **megszólaló** vendég/szereplő.
- `ai_entities_version` bumpolva: `2` = új modell futott (mentioned + host-szűrés).

**`entity_profiles` tábla** (már létezik, csak töltjük)
- Bevezetjük az auto-jelölést: új `app_settings.entity_profile_controls` kulcs (`min_episodes`, `daily_budget_usd`, `enabled`, `model`).

**RLS:** mindkettő public read + admin write — az existing podcasts/episodes policy alá tartoznak, nincs új policy.

---

## 2. Hostok kiszűrése (workstream A)

**Admin UI** (`/admin/podcasts/:id` vagy új panel a podcast detail oldalon)
- Hosts szerkeszthető lista (chip input).
- "AI javaslat hostokra" gomb → új edge function `infer-hosts` egyszer lefuttatja a podcast leírás+pár ep cím alapján Geminivel, de mentés csak admin-jóváhagyással.

**Runner változások**
- `seo-enrich-runner` és `entity-backfill-runner` minden epizódnál:
  1. Lekéri a podcast `hosts` tömbjét.
  2. AI extract után **kiveszi a `people` és `mentioned` tömbből** a hostokat (case-insensitive, ékezet-toleráns összehasonlítás).
- A search-hybrid HyDE prompt és `MARKET_SYMBOL_ALIASES`-szerű listák nem érintve.

**Backfill**
- Egyszeri SQL update, ami megnyitja a host-szűrést a régi sorokon: `update episodes set people = array(select x from unnest(people) x where lower(x) not in (...)) where podcast_id = ...`. Adminból futtatható, vagy egyszeri script.

---

## 3. Jelen vs. említve (workstream B)

**AI tool schema bővítés**
- `seo-enrich-runner` (`EPISODE_SEO_TOOL`) és `entity-backfill-runner` (`ENTITY_TOOL`):
  - `people`: max 6, csak akik **megszólalnak** (vendég, host, interjúalany).
  - `mentioned`: max 6, akikről beszélnek, de nincsenek jelen.
  - Promptban explicit szabály: politikusok, hírességek alapból `mentioned`, **kivéve** ha a leírás egyértelműen jelzi (pl. „interjú", „vendégünk", „beszélgetés vele").
- Új `ai_entities_version=2` marker. A `seo-enrich-enqueue` és az entity-backfill `version < 2` epizódokat eligible-nek tekinti — fokozatos újrafutás.

**Frontend (`EntityPage.tsx`)**
- Új `kind="person"` oldalon a lekérdezés mind `people`, mind `mentioned` mezőre néz, de:
  - Fő lista: ahol `people` tartalmazza (megszólal).
  - Külön szekció lent: „Említve" — ahol csak `mentioned`.
  - Stat-row új mező: „Megszólal X ep · Említve Y ep".
- `aggregateEntities.ts` kibővítve `field: "mentioned"` opcióval (entity tag cloudokhoz, ha kell).

---

## 4. Auto sztár-profil oldalak (workstream C)

**Új runner: `entity-profile-runner` edge function + cron jobid 24**
- Cadence: `0 */6 * * *` (6 óránként).
- Controls: `app_settings.entity_profile_controls`:
  ```json
  { "enabled": true, "min_episodes": 8, "daily_budget_usd": 3,
    "model": "google/gemini-3.1-flash-lite-preview", "max_per_run": 20 }
  ```
- Logika:
  1. SQL aggregálás: `people` mezőből számolja, hány HU epizódban szólal meg egy név (slug szerint). Csak `published_at >= now() - 730d` és csak `podcasts.language ILIKE 'hu%'`.
  2. Jelöltek = aki ≥ `min_episodes` ep-ben, de még nincs `entity_profiles` rekordja (vagy `updated_at < now() - 30d`).
  3. Top N (max_per_run) jelöltre AI-bio generálás (név, ki ő egy mondatban, miről beszél tipikusan, 80-160 szó, magyarul).
  4. `featured_episode_ids` = top 5 epizód a frissesség + tier alapján (`compareByScore` JS-ben replikálva SQL-ben, vagy egyszerű frissességalapú).
  5. Upsert `entity_profiles`-be (`kind='person'`, `slug`, `display_name`, `bio`, `episode_ids`, `featured_episode_ids`, `model`, `cost_usd`).
- Budget guard ugyanaz a pattern, mint az `entity-backfill-runner`-nél: `ai_spend_daily.by_kind.entity_profile`.

**Frontend (`EntityPage.tsx`)**
- `useEffect`-ben a lekérdezés mellé `entity_profiles` lookup slug + kind szerint.
- Ha van profil:
  - Hero alá kerül egy „Bio" card (`p.bio`), és a Featured szekció prioritást kap (`featured_episode_ids`).
  - SEO description a `bio` első mondatából (jobb mint a generikus szöveg).
  - JSON-LD `Person.description` mező hozzáadva.
- Ha nincs profil, marad a jelenlegi viselkedés.

**Admin felület** (`/admin/people` új oldal — opcionális, MVP-ben kihagyható)
- Lista a jelöltekről, manuális trigger, bio újragenerálása.

---

## 5. Sorrend és kockázat

1. **DB migráció** (kicsi, biztonságos — csak default-tal új oszlopok).
2. **Runner-ek + tool schema** (visszafelé kompatibilis, mert default `[]`).
3. **Host admin UI + 1-2 nagy podcastnál kézi feltöltés** (Frizbi, 444 stb. — gyors win).
4. **EntityPage frontend** (új `mentioned` szekció, profile bio).
5. **`entity-profile-runner` + cron** (utolsó, mert előtte legyen tisztább a `people` adat).

**Költségbecslés:** ~$1-2/nap extra (entity-profile-runner), a meglévő runner-ek csak ~+5% tokenért (egy plusz tömb a tool output-ban).

**Mit NEM csinálunk most:** Beszélgetés-stílusú segmentáció, transcript-alapú szerepfelismerés, kézi adminkurálás minden szereplőre. Ezek később jöhetnek.

---

## Mit szeretnék jóváhagyni

- ✅ Séma változtatások (3 oszlop)
- ✅ Két runner módosítása (host-szűrés + `mentioned` mező)
- ✅ EntityPage frontend bővítése (mentioned szekció + bio render)
- ✅ Új `entity-profile-runner` + cron jobid 24 6 óránként, $3/nap budget
- ✅ Host admin szerkesztés a podcast oldalon

Ha jó, lefuttatom a migrációt, és sorban deployolom a runnereket.
