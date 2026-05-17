
# People Editorial Quality Layer + HU Localization Fix

15 részből álló terv. Sorrendben haladok, minden lépést egy commitba zárok és a végén jelentést adok.

---

## 1. DB migráció — `people` + új táblák

**`people` új oszlopok** (admin-only, NEM exponáljuk publikusan):
- `is_browsable_in_people_hub bool default false`
- `browsable_reason text`
- `editorial_priority bool default false`
- `editorial_priority_level int default 0`
- `editorial_notes text`
- `manually_seeded bool default false`
- `manual_approval_status text default 'none'` (enum-szerű: `none/approved_public/approved_indexable/approved_browsable/rejected/needs_review`)

**Új tábla `editorial_people_seed`** (admin-only, RLS: csak admin SELECT/WRITE — nem public read):
- id, name, canonical_name, slug, aliases[], context_hints[], priority_level, status, matched_person_id, notes, timestamps

**Új view `person_missing_content_review_view`** — admin only (security definer fn vagy RLS-zárolt).

**Frissített RPC `refresh_person_activation_status()`** — kiszámolja az új `is_browsable_in_people_hub` + `browsable_reason` mezőket a megadott A/B/C/D szabályok szerint, kizárólag HU-elfogadott podcastok (is_hungarian=true AND language_decision='accept_hungarian') figyelembevételével.

**`app_settings`** új kulcs `person_pages` = `{ images_enabled: false }`.

---

## 2. Editorial seed adatok

`editorial_people_seed`-be betöltöm a 14 felsorolt nevet (Frei Tamás, Zsiday Viktor, Ruff Bálint, Sz. Bíró Zoltán, Balásy Zsolt, Lakatos Péter, Schiffer András, Schwab Richárd, Pólus Enikő, Mészáros Blanka, Szirmai Marcel (+ Pogány Induló alias), Hajdu Tibor, Trill Zsolt, Kasza Tibor (+ Kasza Tibi alias)) priority_level + context_hints + aliases mezőkkel.

---

## 3. Új edge function `editorial-people-seed-matcher`

Bemenet: opcionálisan seed slug. Default: minden `status='active'` seed.

Algoritmus seed-enként, HU-elfogadott korpuszon:
1. Person név/normalized/alias keresés.
2. Episode title/description/ai_summary ILIKE + context-token boost.
3. Podcast title/description/host/guest match.
4. Confidence score alias + context-token + co-occurring terms alapján.
5. Disambiguáció: Lakatos Péter→Videoton kontextus required, Pólus Enikő→pszichológia, Szirmai Marcel↔Pogány Induló merge, Kasza Tibor↔Kasza Tibi alias.

Eredmény:
- Erős evidence (≥2 episode mention magas confidence): person create/attach, aliases insert, `person_episode_mentions` insert, `person_podcast_map` update, recompute counts, `editorial_priority=true`, `manually_seeded=true`.
- Gyenge/kétséges: `seed.status='needs_review'`, evidence JSON-ba mentve.
- Semmi evidence: seed marad, NINCS public page.
- Soha nem hozunk létre üres public oldalt.

Manuális admin trigger a `/admin/person-quality-review` oldalról.

---

## 4. Frontend — Person hub és detail oldalak

**`src/pages/PeopleHubPage.tsx`**:
- Lekérdezés szűrése `is_browsable_in_people_hub = true` + meglévő public/active feltételek.
- `<Initials>` komponens mindenkire (nincs image, akkor sem ha `image_url` létezik).
- Semmilyen editorial badge / "seed" / "priority" jelzés.

**`src/pages/PersonDetailPage.tsx`** (megnézem első körben):
- Monogram avatar globálisan, kép elrejtése.
- Képforrás attribútum elrejtve ha kép nincs renderelve.
- Hiányzó `ai_bio` esetén safe HU fallback szöveg.
- Hiányzó `overview_text` esetén overview kártya elrejtése vagy episode-alapú HU fallback.
- Semmi editorial label / seeded info.

**Új közös komponens `<PersonAvatar />`** (`src/components/PersonAvatar.tsx`) — egységes initials/monogram, stabil hash-alapú neutral gradient, accessible contrast, méretvariánsok (sm/md/lg). Lecseréli a HubPage és Detail meglévő avatar-megjelenítését.

---

## 5. HU lokalizáció — generated text + UI címkék

**Globális AI text language guard** új helper `supabase/functions/_shared/hu-language-guard.ts`:
- Egyszerű karakter-arány heurisztika (HU-specifikus betűk: őűáéíóúö + stopwordok `és/hogy/a/az/nem/van`).
- Ha output <30% magyaros vagy >25% angol stopword arány → regenerate egyszer erősebb HU instrukcióval → ha még mindig nem HU → előre definiált HU fallback.

**Érintett edge function-ök** (system promptot kemény HU-only-ra állítom + guard hívás):
- `search-answer` (ez generálja a "Zsiday" alatti angol szöveget — kritikus fix).
- `search-suggest` — HU lowercase prompt erősítés.
- `person-bio-generator` — explicit HU output, guard.
- `entity-profile-runner` — overview szövegek HU-only.
- `seo-enrich-runner` — már HU-aware de a guardot ráteszem a public-facing summary mezőkre.

**Frontend angol címke csere** (rg-vel végigfutok és cserélem ahol publikus):
- Overview → Áttekintés
- Person → Személy
- Episodes indexed → Indexelt epizódok
- Last 30 days → Elmúlt 30 nap
- Why it matched → Miért releváns?
- Drawn from indexed episodes → Az indexelt epizódok alapján generálva.
- Related episodes → Kapcsolódó epizódok
- Related people → Kapcsolódó személyek
- Search summary → Keresési összefoglaló
- No results → Nincs találat
- Try searching → Próbálj más keresést
- Trending → Felkapott
- Fresh → Friss
- Evergreen → Időtálló
- (Admin oldalakat hagyom angolul ahol jelenleg azok.)

**SearchPage AI summary**: ha `search-answer` üres/nem HU → HU fallback szöveg renderelése ("Ehhez a kereséshez magyar podcast epizódokat találtunk…").

---

## 6. Admin — `/admin/person-quality-review` bővítés

Új tab/szekciók a meglévő `AdminPersonQualityReviewPage.tsx`-be:
- Editorial seed státusz táblázat (matched / no-evidence-yet / needs_review).
- Browsable státusz oszlop + filter csipek: one-podcast-only / indexable-not-browsable / browsable / missing-bio / seed-matched / seed-no-evidence.
- Akciógombok: make browsable, hide from hub, generate bio, generate overview, approve/reject seed match, merge aliases, set manual approval, regenerate HU summary, run seed-matcher.
- CSV export a `person_missing_content_review_view`-ból (kliens-oldali CSV blob letöltés).

---

## 7. Verifikációs futás + jelentés

A migrációk és kód deploy után lefuttatom:
1. Seed insert.
2. `editorial-people-seed-matcher` invoke.
3. `refresh_person_activation_status()` RPC.
4. `app_settings.person_pages.images_enabled=false`.
5. Missing content view export top 50.
6. Sanity SELECT-ek: count szerinti before/after, sitemap people count, Zsiday search-answer válasz nyelve.

Visszaadom a részletes riportot (Editorial seed / Browsable+Indexable / Images / Missing content / HU localization / Public safety / Files changed) pontosan a PART 15 szerinti formátumban.

---

## Technikai részletek

**Tools sorrend**:
1. `supabase--migration` (séma + RPC + view).
2. `supabase--insert` (seed adatok + app_settings).
3. `code--write` az új edge function + frontend komponensek.
4. `code--line_replace` a meglévő frontend / edge fn módosításokhoz.
5. `supabase--deploy_edge_functions` az új és módosított fn-ekre.
6. `supabase--curl_edge_functions` a matcher futtatására + `supabase--read_query` a riporthoz.

**Biztonsági szempontok**:
- `editorial_people_seed` és új admin oszlopok: RLS csak admin SELECT/WRITE — NEM `public read`. Public RPC-k és view-k SOHA nem szelektálnak ezekből az oszlopokból (`editorial_priority`, `manually_seeded`, `editorial_notes`, `browsable_reason` kivéve admin).
- `person_missing_content_review_view` security definer wrapper RPC-vel hívható csak admin által.
- JSON-LD, sitemap, public meta tagek ellenőrzése: csak `name`, `slug`, `wikipedia_url`, `wikidata_id`, `episode_count`, `latest_episode_at`, `image_url` (=null mostantól), `short_bio`/`ai_bio`/`overview_text` mehet ki — semmi editorial.

**Méret becslés**: ~1 migráció (300+ sor SQL), 1 új edge fn (400+ sor), ~10 frontend fájl módosítás, ~5 edge fn HU guard injektálás, 1 új komponens, seed insert ~14 sor + 25 alias.

---

## Kockázatok / nyitott pontok

- Az `editorial-people-seed-matcher` első futása hosszú lehet (ILIKE keresések 850 podcast × seed). Time budget: 50s, ha túlfut, részleges progress + folytatható (seed-enként commit).
- A `has_role()` security definer fn-t használom RLS-hez ahogy az index megköveteli.
- A frontend cseréknél a tailwind/design tokenek megmaradnak.
- Disambiguation (Lakatos Péter / Hajdu Tibor) konzervatív lesz: kétes match → `needs_review`, nem auto-create.
- A HU language guard heurisztika nem 100%-os; csak nyilvánvalóan angol kimeneten triggerel — false-positive elkerülés végett küszöbök konzervatívak.

Ha jóváhagyod, megyek és implementálom egyben.
