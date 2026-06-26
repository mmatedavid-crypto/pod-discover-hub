## Cél
Az új és long-tail epizódok indexelési idejét napokról órákra csökkenteni, és az MTI-hez kiküldött 2 jelentés sajtó-linkjeinek "juice"-át mélyebbre vezetni a katalógusban.

---

## A. Google Indexing API integráció

**Mit csinál:** Új epizódok publikálásakor / napi cron-ban közvetlenül megpingeli a Google-t, hogy "ezt az URL-t indexeld most". Limit: 200 URL/nap/property, batch 100/hívás.

**Előfeltétel (te csinálod meg, 2 perc):**
1. GSC → Settings → Users and permissions → Add user
2. E-mail: `podiverzum@copper-diorama-496119-t3.iam.gserviceaccount.com`
3. Permission: **Owner** (kötelező az Indexing API-hoz, nem elég a Full)
4. Google Cloud Console-ban a `copper-diorama-496119-t3` projektnél engedélyezni: **Indexing API** + **Search Console API** (ha még nincs)

**Amit én csinálok:**
1. A service account JSON-t `GOOGLE_INDEXING_SA_JSON` secretbe rakom (`set_secret`)
2. Új edge function `google-indexing-submit`:
   - RS256 JWT sign → access token csere `oauth2.googleapis.com/token` ellen
   - Batch HTTP POST: `https://indexing.googleapis.com/batch` 100 URL/batch
   - Body: `{ url, type: 'URL_UPDATED' }`
   - Logolás `app_settings.indexing_api_state`-be (sent/succeeded/quota_exceeded)
3. URL kiválasztás napi 200-ra:
   - **Prioritás 1 (max 50):** új epizódok ≤24h ÉS bármely HU tier (long-tail is!)
   - **Prioritás 2 (max 100):** ≤7 napos epizódok, amelyek **még nincsenek indexelve** (`gsc_query_daily` join — ha 0 impression eddig)
   - **Prioritás 3 (max 50):** új podcast/person/topic hub oldalak ≤7 napos
4. Cron `0 5 * * *` napi 05:00 UTC (új edge cron 92)
5. Admin oldal `/admin/indexing-api` egyszerű state-monitorral (utolsó 7 nap submission stats)

**Várható hatás:** új epizódok **órák alatt** Google-ben, nem 5-14 nap múlva.

---

## C. Homepage "Most felfedezve" long-tail rail

**Mit csinál:** A főoldal egyik legerősebb crawl-juice forrás. Adunk neki egy új sávot, ami direkt linkel **friss long-tail epizódokra** (D/E tierre is!), nem csak a top picksre — így Googlebot a következő crawl-on követi a linkeket az árva epizódokra.

**Implementáció:**
- Új komponens `src/components/MostFelfedezve.tsx`
- Query: `episodes` WHERE `podcast.language='hu%'` AND `published_at > now() - 48h` ORDER BY `published_at DESC` LIMIT 12
- **NEM** tier-szűrve, **NEM** ai_summary-szűrve — pont a long-tail kell
- 12 kártya horizontális scroll-lal, csak cím + podcast + idő (kompakt)
- Beillesztés `src/pages/Index.tsx`-be a `HeroTrendsStrip` ÉS `DailyEditorials` közé (felső harmadban → maximum crawl-juice)
- Cím: **"Most felfedezve — friss epizódok minden zugból"** (jelzi a Google-nek is hogy ez nem curated, hanem teljes lefedettség)

---

## MTI jelentések belső linkelése

A két oldal jelenleg külön él, és csak felületesen linkel befelé. Mivel ezek kapják az MTI/sajtó backlinkeket, **innen kell a "juice"-t a mélyebb oldalakra irányítani**.

### PodcastReport2026 (`/jelentes/magyar-podcast-piac-2026`)
Jelenleg linkel: `/ceg/:slug` (pártok), `/partok`, `/modszertan`. **Hozzáadunk:**
- A "Toplistás podcastok" / "Heti+ kategória" stat-blokkokban a podcast nevek **legyenek linkek** a `/podcast/:slug`-ra (most csak szöveg)
- Új CTA blokk a végére: **"Fedezd fel"** → 3 link: `/toplista` + `/heti` + `/uj-podcastok`
- A "Műsorvezetők" vagy hasonló statisztikákban szereplő nevek → `/szemelyek/:slug` linkekkel
- A kategória-bontásnál a kategórianevek → `/kategoria/:slug` linkekkel

### HaboruTemaReport (`/jelentes/haboru-mint-tema-2026`)
Jelenleg linkel: `/temak/haboru` (egy CTA), `/jelentes/magyar-podcast-piac-2026`. **Hozzáadunk:**
- A "Top közvetítő podcastok" listából minden podcast név → `/podcast/:slug`
- A jelentésben említett kulcsszemélyek → `/szemelyek/:slug`
- Új "Kapcsolódó témák" blokk: `/temak/ukrajna`, `/temak/orosz-ukran-haboru`, `/temak/izrael`, `/temak/iran` (ha léteznek — query-ből ellenőrzöm)
- Új "Legfrissebb háborús epizódok" mini-rail (utolsó 5 epizód a témából, dinamikus query) — élő tartalom + folyamatos belső link az új epizódokra

**Miért fontos:** Egy MTI cikk linkje a `/jelentes/...` oldalra → onnan 30-40 belső link → Google crawl bot követi mindegyiket → tucatnyi mély oldal kap "endorsement"-et.

---

## Implementációs sorrend (egy menetben megcsinálható)

1. **MTI jelentés oldalak link-bővítés** (frontend only, ~15 perc)
2. **"Most felfedezve" rail** a főoldalra (új komponens + 1 sor Index.tsx, ~15 perc)
3. **Google Indexing API edge function + cron + secret** (~30 perc)
4. **Admin monitor oldal** `/admin/indexing-api` (~10 perc)

Te közben elintézed a GSC Owner-add lépést a service account-nak — addigra a cron már fut, és az első ping a következő napon megy.

---

## Mit NEM csinálunk

- Sitemap nem szűkül (long-tail marad benne)
- D/E tier epizódokra nem teszünk `noindex`-et
- News-sitemap bővítés átkerül egy másik körre (kisebb prio mint az Indexing API)

---

## Technikai részletek

**Edge function vázlat (Indexing API):**
- Deno `crypto.subtle.importKey` + `sign` RS256-tal (no external lib needed, native)
- JWT payload: `{ iss: client_email, scope: 'https://www.googleapis.com/auth/indexing', aud: 'https://oauth2.googleapis.com/token', exp, iat }`
- Token cache `app_settings.indexing_api_state.access_token` ~50 perc TTL-lel (token 60 perc érvényes)
- Quota tracker: ha 429 → `app_settings.indexing_api_state.quota_exceeded_until` 24h
- Pipeline-watchdog ne nézze (külön, low-cost runner)

**URL kiválasztás SQL:**
```sql
-- Prio 1: új epizódok ≤24h
SELECT 'https://podiverzum.hu/podcast/' || p.slug || '/' || e.slug AS url
FROM episodes e JOIN podcasts p ON p.id = e.podcast_id
WHERE p.language ILIKE 'hu%' AND p.language_decision='accept_hungarian'
  AND e.published_at > now() - interval '24 hours'
ORDER BY e.published_at DESC LIMIT 50;
```

**MTI report linkelés:** csak markup-szintű módosítás, nincs új DB query (a meglévő `report.podcasts` / `report.people` adatból).
