## Cél

Új „Felkapott műsorok" sáv a főoldalon a „Felkapott epizódok" alatt. Forrás: Apple HU + Spotify HU chart + YouTube view-delta proxy. Kumulált rangsor reciprokrang-fúzióval (`score = Σ 1/rank_source`), majd top 8–12 műsor.

## Valóságcheck (most ellenőriztem)

- **Apple HU top 100** → `rss.marketingtools.apple.com/api/v2/hu/podcasts/top/100/podcasts.json` — működik, JSON-ban kapunk `id` (iTunes collection ID), `name`, `artistName`, `artworkUrl100`, `url`.
- **Spotify HU top 50** → `podcastcharts.byspotify.com/hu` — nincs API, HTML scrape Firecrawllal. Show ID + cím kinyerhető.
- **YouTube** → nincs hivatalos podcast chart. Proxy: a 279 paired YT-csatornánk közül a `youtube/v3/channels?id=...&part=statistics` napi `subscriberCount` + `viewCount` delta → 7-napos `view_delta` rangsor. (Új tábla kell a snapshothoz.)
- **Matching probléma:** DB-ben jelenleg `apple_url = NULL` és `spotify_url = NULL` minden HU podcastnál. Tehát első körben **csak fuzzy title match** lesz (`normalized_title` + trigram + opcionálisan artist név). A v2-ben backfilleljük a hiányzó apple/spotify URL-eket (iTunes lookup ingyenes az ID-ből, Spotify Web API kell tokenhez).

## Lépések

### 1. DB séma
- **`podcast_charts`** tábla:  
  `id, source ('apple'|'spotify'|'youtube'), country ('hu'), rank int, podcast_id uuid NULL, raw_name text, raw_artist text, raw_external_id text, image_url text, snapshot_at timestamptz, matched_via text ('apple_id'|'spotify_id'|'youtube_channel'|'title_fuzzy'|null)`.
- **`mv_trending_podcasts`** materialized view: legfrissebb snapshotok unionja → `podcast_id, sum(1/rank)::numeric AS trending_score, jsonb_agg(...) sources, max(snapshot_at)`. Csak `podcast_id IS NOT NULL` sorok.
- RPC `get_trending_podcasts(p_limit int)` → join `podcasts`-ra, csak `is_hungarian=true`, healthy, `rank_label IN ('S','A','B')` korláttal.

### 2. Edge function `chart-fetcher`
- Apple ág: fetch JSON → minden chart entry-re `iTunes lookup` (`https://itunes.apple.com/lookup?id={collectionId}&country=hu`) → kinyer `feedUrl` (RSS!) → match a `podcasts.rss_url_norm`-ra (legmegbízhatóbb), ha nincs → `normalized_title` trigram. Match esetén az `apple_url`-t is backfilleli a `podcasts` táblán.
- Spotify ág: Firecrawl scrape `podcastcharts.byspotify.com/hu` → top 50 → spotify show URL kinyer → ha későbbi Spotify Web API connection lesz, show metadata-ból `rss_url` is jöhet. Most: title fuzzy match.
- YouTube ág: új `youtube_channel_stats` tábla (`channel_id, snapshot_at, subscriber_count, view_count, video_count`) — `chart-fetcher` napi snapshot a 279 paired csatornára (YouTube Data API v3, `YOUTUBE_API_KEY` titok). Ranking: utolsó 7 nap `view_count` deltája szerint. (Ha még nincs előző snapshot: `subscriber_count` rangsor.)
- Output: `podcast_charts` rögzít minden entry-t, majd `REFRESH MATERIALIZED VIEW CONCURRENTLY mv_trending_podcasts`.

### 3. Cron
- Napi 1× `0 5 * * *` UTC → `chart-fetcher`. (Charts naponta frissülnek.)

### 4. Frontend
- `src/pages/Index.tsx`: új section a „Felkapott epizódok" után.
  - Cím: „Felkapott műsorok"
  - Alcím: „Az Apple, Spotify és YouTube top listái alapján — {dátum} szerint"
  - Vízszintes scrolleres `PodcastCard` rail, top 8 műsor.
  - Minden kártyán mini-badge: melyik forrás(ok)ban szerepel (ikonok: Apple/Spotify/YT) + összevont helyezés (pl. „#3 Apple · #7 Spotify").
- Loading skeleton.
- `useTrendingPodcasts()` hook az RPC-hez.

### 5. Admin
- `/admin/charts` oldal: utolsó snapshot per forrás, matched vs unmatched arány, „Force refresh" gomb.

## Mit kérek a titok-fronton
- `YOUTUBE_API_KEY` — kell a YT proxyhoz. (Spotify token nem kell, mert csak scrape.) Ha még nincs, megkérdezem külön a kulcsot.

## Mi nincs benne (későbbi)
- Spotify Web API alapú show metadata + RSS-back-link → pontosabb Spotify matching.
- Apple URL bulk backfill az egész katalógusra (most csak chart-on belül történik).
- v2 YT proxy: nem csak paired csatornák, hanem topic-discovery új HU podcast csatornákra is.
