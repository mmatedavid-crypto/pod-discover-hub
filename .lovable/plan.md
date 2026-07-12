## Cél

Fábry Kornél napi bibliapodcast (és tágabban a `zarandok.ma` bibliás sorozat) URL-jét **percekkel a WP publikáció után** feltölteni a Podiverzumba és bepingelni a Google/Bing indexbe — anélkül, hogy a lassú podcast RSS-re kellene várnunk.

YouTube-ot **kihagyjuk** (nem az igazi).

---

## Építőelemek

### 1) Új edge function: `zarandok-biblia-poll`

Feladat: lekéri a `zarandok.ma` WordPress REST API-t, összeveti az utolsó látott poszttal, és új találat esetén elindítja az instant-index pipeline-t.

- **Forrás:** `https://zarandok.ma/wp-json/wp/v2/posts?_fields=id,slug,date_gmt,modified_gmt,title,link,categories&per_page=5&orderby=date&order=desc`
- **Szűrés:** csak a "biblia egy év alatt" kategória / slug-minta (`/^\d+-nap-/`).
- **State:** `app_settings.zarandok_biblia_poll_state` — `{ last_seen_post_id, last_seen_date_gmt, runs:[{at,found,new,pinged}], errors:[] }`.
- **Ha új post:**
  1. Megkeresi a podiverzumi kanonikus podcast slug-ot (Fábry Kornél — Biblia egy év alatt), az RSS-ből még hiányzó epizódot **placeholder-ként** beszúrja az `episodes` táblába (title + published_at + external_link mezőkkel; audio_url NULL, majd az RSS ingest utólag pótolja).
  2. Meghívja a **`instantIndexEpisodes()`** pipeline-t (`google-indexing-submit` + `indexnow-submit` + `refresh-sitemap`) a friss podiverzumi URL-re.
  3. Logol Telegramra (napi 1 bejegyzés).

### 2) Burst-poll cron ütemezés

Két ütem, hogy ne pörögjön feleslegesen egész nap:

- **Burst window** (23:55–00:15 CEST → 21:55–22:15 UTC nyáron): jobid A, `*/1 21-22 * * *` — percenként.
- **Ritka fallback** (napközben ha elcsúszna): jobid B, `*/10 * * * *` — 10 percenként.

Mindkettő a `zarandok-biblia-poll` edge-et hívja. State-ből tudja, hogy már bepingelte a mai napot → no-op.

### 3) Instant-index pipeline (már megvan, csak összekötjük)

- `google-indexing-submit` — `{ urls: [podiverzumUrl] }` (a `RESERVED_HOT` slot pont erre való).
- `indexnow-submit` — `{ urls: [podiverzumUrl] }`.
- `refresh-sitemap?type=episodes` — hogy a `<lastmod>` frissüljön.

Az edge function `Promise.allSettled`-del hívja mindhármat.

### 4) Admin panel (könnyű): `/admin/zarandok-poll`

Új oldal a state megjelenítéséhez: utolsó látott post, utolsó 20 futás, hibák, "Run now" gomb. Kis dashboard-részlet — nem sok kód.

---

## Technikai részletek

- **Podcast azonosítása:** `podcasts` táblában slug-lookup ("biblia-egy-ev-alatt" vagy hasonló). Ha nincs meg, state.errors-ba logol + Telegram alert.
- **Placeholder episode:** `episodes` insert `{ podcast_id, title, slug (a WP slug-ból), published_at: date_gmt, external_url: link, source: 'zarandok_ma_poll' }`. Ha az RSS ingest később ugyanezt a slug-ot hozná, `onConflict` merge.
- **Rate limit:** WP REST API cache-t nem néz (a mi 3 kérésünk/nap elhanyagolható), de a burst 20 kérése/nap max.
- **Nyári/téli időszámítás:** biztonságból mindkét UTC ablakot lefedjük (`21` és `22` óra), max 40 wasted call/év.

---

## Files

- **NEW** `supabase/functions/zarandok-biblia-poll/index.ts` — a poll + insert + instant-index.
- **NEW** `src/pages/AdminZarandokPollPage.tsx` — state dashboard.
- **EDIT** `src/App.tsx` — új admin route.
- **EDIT** `src/pages/AdminHubPage.tsx` — link az új oldalra.
- **SQL migration** — 2 új pg_cron job (burst + fallback).

---

## Kimenet

Holnap éjfél után **1–3 percen belül** a WP posztot észleljük, létrehozzuk a Podiverzum epizódot placeholder-ként, és bepingeljük a Google-t + Bing-et — így a mi URL-ünk **egy időben** jelenik meg az indexben a `zarandok.ma` posztjával, nem 6–24 órával később.

Mehet így?
