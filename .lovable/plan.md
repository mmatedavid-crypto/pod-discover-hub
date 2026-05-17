# Pre-publish SEO / Sitemap / Robots javítások

## Jelenlegi állapot (audit)

- `supabase/functions/sitemap/index.ts` HU szűrője csak `is_hungarian=true` → 691 helyett 1377 podcast szivárogna át; kell a `language_decision='accept_hungarian'` is.
- Sitemap **index** child URL-jei `FN_BASE = https://<projectref>.supabase.co/functions/v1/sitemap?type=...` formátumban mennek → GSC a Supabase domain-t látja a sitemap tartalmában. Nem oké.
- `public/robots.txt` Sitemap direktívája szintén Supabase URL-re mutat.
- Cloudflare Worker (`.lovable/cloudflare-worker.js`) **már** proxyzza `https://podiverzum.hu/sitemap.xml` → Supabase sitemap edge fn (1h cache). Tehát a dinamikus megoldás már a helyén van, csak ki kell bővíteni a query-s child URL-ekre.
- `public/sitemap.xml` statikus fájl létezik, de a Worker árnyékolja → tényleg sosem szolgálódik ki podiverzum.hu-ról. Félrevezető, törölni vagy újragenerálni kell egy „buildtime" snapshotként (B opció), de mivel A út jó, törlés a tisztább.
- robots.txt blokkolja a `/kereses`-t és `/search`-öt → noindex meta sosem érvényesül.
- Indexable oldalak (homepage, podcast, episode, category, topic, person, mood, statikus) noindex-szabálya rendben (`useNoindex` csak admin/auth/404/keresés).

## Megvalósítás

### 1) Sitemap edge function — kanonikus HU gate
File: `supabase/functions/sitemap/index.ts`

Cseréljük minden helyen az `.or("is_hungarian.eq.true"...)` szűrőt a szigorú gate-re:

- `buildPodcasts`: `.eq("is_hungarian", true).eq("language_decision", "accept_hungarian")` + meglévő rss_status/rank_label/health_state kizárások.
- `buildEpisodesByMonth`: `podcasts!inner(...)` joinban ugyanígy, `.eq("podcasts.is_hungarian", true).eq("podcasts.language_decision", "accept_hungarian")` + nem broken RSS.
- `buildEntitiesByMonth` (jelenleg amúgy is kikapcsolva az index-ben): ugyanaz a join feltétel — vagy hagyjuk inaktívan.
- `buildCore`: kategóriák, topics (`is_indexable=true AND is_public=true`), people (a meglévő szigorú activation/ai_review gate marad) — nem érint nyelv.
- Mood collections — jelenleg `buildCore` nem listázza őket; ha kell, hozzáadunk `mood_collections.is_indexable=true AND active=true AND recommended_episode_count >= 10` szűrővel (ezt használja a statikus gen is).

### 2) Sitemap kanonikus URL podiverzum.hu alatt

- `FN_BASE` cseréje: `const FN_BASE = "https://podiverzum.hu/sitemap";` — így a sitemap-index minden child loc-ja `https://podiverzum.hu/sitemap?type=core` stb. lesz.
- Worker bővítése (`.lovable/cloudflare-worker.js` és `infra/cloudflare-worker/worker.js`): a `/sitemap.xml` és `/sitemap` (query-vel) is proxy-zódjon Supabase felé. Cache-key tartalmazza a query stringet. TTL marad 1h. Bump cache namespace v4-re.
- `public/robots.txt` Sitemap direktíva: `Sitemap: https://podiverzum.hu/sitemap.xml`.
- `public/sitemap.xml` statikus fájl és `public/sitemaps/*.xml` törlése (a Worker árnyékolja, és félreérthető). A `scripts/gen-sitemap.mjs`-t megtartjuk de jelöljük "no longer used"-nak vagy töröljük.

### 3) Stale sitemap kockázat

- Mivel A út megy: dinamikus, mindig friss adatbázisból. Nincs build hook, nem lehet elfelejteni. Stale risk = 0 (1h CF cache).
- `package.json` változatlan.

### 4) robots.txt frissítés

Új tartalom (vázlat):

```
User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin/
Disallow: /admin-bootstrap
Disallow: /growth-status
Disallow: /auth
Disallow: /belepes

Sitemap: https://podiverzum.hu/sitemap.xml
```

- Eltávolítjuk: `/kereses*`, `/search*` Disallow (a SearchPage már noindex, follow → engedjük crawlolni).
- AI bot explicit Allow blokkok maradnak (Googlebot/Bingbot/OAI-SearchBot stb.).
- A `/admin`, `/admin-bootstrap`, `/growth-status` Disallow marad. `/internal`, `/debug` route nincs az appban; nem adunk hozzá nem létező pathot.

### 5) Audit run (a fixek után)

- `curl https://podiverzum.hu/robots.txt` → 200, helyes tartalom.
- `curl https://podiverzum.hu/sitemap.xml` → 200, valid XML, child loc-ok podiverzum.hu alatt.
- Fetch egy child sitemap-et (`?type=podcasts`, `?type=core`, egy `?type=episodes&ym=...&part=1`) → 200, csak `https://podiverzum.hu/...` URL-ek.
- Leaks ellenőrzés: `grep -E "(podiverzum\.com|lovable\.app|supabase\.co|localhost)"` minden lekért XML-ben → 0 találat.
- Számolás: total URL, breakdown core/podcasts/episodes (people a core-ban).
- DB ellenőrzés: foreign podcast (`is_hungarian=false OR language_decision<>'accept_hungarian'`) nem szerepel — random spot-check 3 sample.
- HTTP 200 audit: `/`, `/kategoriak`, `/szemelyek`, `/hangulatok`, `/temak`, `/uj`, `/napi`, `/rolunk`, `/modszertan`, `/adatvedelem`, `/feltetelek`, `/kapcsolat`, egy podcast, egy episode, egy topic, egy person, egy mood detail page.
- Noindex meta ellenőrzés a `/kereses` és `/admin` route-on (HTML response-ban).

### 6) Final report

A user által kért 10 részes táblát adom vissza a végén, számokkal, „safe to publish" / „safe to submit GSC" döntéssel, és a launch sorrenddel (publish → CF purge `/robots.txt` + `/sitemap.xml` → GSC submission).

## Technikai részletek

- A Worker deploy-ja külön folyamat — a `.lovable/cloudflare-worker.js` változás akkor lép életbe ha a Worker újra deploy-olódik (Cloudflare dashboard / wrangler). Megemlítem a végén mint manuális launch step.
- Az edge function deploy automatikus (Lovable Cloud).
- Régi CF cache (`proxy-cache-v3`) kulcsot bump-oljuk v4-re, hogy az új sitemap azonnal érvényesüljön deploy után.

## Nem érintett

- Auth flow, business logic, AI pipeline, search ranking — semmi nem változik.
- `is_indexable`/activation szabályok nem változnak.
- Tracking / `page_events` változatlan.
