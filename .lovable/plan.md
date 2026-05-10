# Bot prerender — `/` és `/podcast/{slug}` indító verzió

## Cél

AI crawler-eknek (GPTBot, ClaudeBot, PerplexityBot, Google-Extended stb.) szerver oldalon legyártott, teljes HTML-t adni: `<title>`, meta description, canonical, **teljes JSON-LD** (PodcastSeries / PodcastEpisode / BreadcrumbList), H1, AI summary szöveg, kattintható linkek. A felhasználók továbbra is a normál SPA-t kapják — gyors, semmi sem változik nekik.

A csővezeték már áll (DNS proxied + Worker route-ok bekötve). Most a **tartalom** kerül bele.

## Hatókör — első iteráció

Csak két útvonal típus, hogy gyorsan élesedjen és mérni tudjuk a hatást:

1. `/` — homepage (trending + evergreen episode-ök listája)
2. `/podcast/{slug}` — podcast részletes oldal (cím, leírás, AI summary, top 10 epizód)

Második körben (külön kérésre): `/podcast/{slug}/{episode-slug}`, `/category/{slug}`, entitás hub-ok.

## Architektúra

```text
Bot UA?  ─yes─►  CF Worker  ──►  prerender-page edge fn  ──►  DB (RPC)
                    │              ↓ HTML string
                    ◄────── HTML + JSON-LD
Human ──no──►  Worker passthrough  ──►  Lovable hosting (SPA)
```

## Lépések

### 1. Edge function `prerender-page` (Supabase)

- Bemenet: `?path=/podcast/some-slug` (query param)
- Logika:
  - parse path → `{ kind: 'home' | 'podcast', slug? }`
  - `home`: olvassa `mv_homepage_feed` + `mv_homepage_evergreen` MV-eket (top 30 + 10)
  - `podcast`: `podcasts` row by slug (csak EN, healthy RSS) + top 10 episode by `published_at`
  - HTML template (template literal, semmi React) — egyetlen `<html>` string visszaad
- Tartalom a HTML-ben:
  - `<title>` + meta description (a `seo_title` / `seo_description` mezőkből, vagy fallback a `title` / `summary`-ből)
  - `<link rel="canonical">` mindig `https://podiverzum.com{path}`
  - JSON-LD: WebSite + Organization homepage-en; PodcastSeries + BreadcrumbList podcast oldalon, `hasPart` listában az epizódok
  - `<h1>`, AI summary `<p>`, epizód lista `<a href="...">` linkekkel
  - `<noscript>` fallback link
- Headers: `Cache-Control: public, max-age=3600`, `Vary: User-Agent`, `X-Prerendered: 1`, `Content-Type: text/html; charset=utf-8`
- `verify_jwt = false` (publikus)

### 2. Cloudflare Worker (`podiverzum-bot-prerender`) frissítése

A jelenleg passthrough Worker helyett:

- Bot UA detektor (regex listán): `GPTBot|OAI-SearchBot|ChatGPT-User|ClaudeBot|Claude-Web|PerplexityBot|Google-Extended|Applebot-Extended|Bytespider|Meta-ExternalAgent|DuckAssistBot|CCBot|YouBot|Diffbot|Googlebot|Bingbot`
- Path filter: csak `/` és `/^\/podcast\/[^\/]+$/` — minden más passthrough (még bot UA-val is)
- Ha bot + támogatott path:
  1. CF Cache API lookup (kulcs: `path + UA-osztály`)
  2. Cache miss → `fetch('https://<project>.functions.supabase.co/prerender-page?path=...')`
  3. Cache 1h-ra, `X-Prerender-Cache: HIT|MISS` header
- Ha nem bot vagy nem támogatott path: `fetch(originalRequest)` (passthrough)
- Hibatűrés: ha a prerender 5xx-et ad vagy timeout (>3s), passthrough az SPA-ra (sose törjük az oldalt)

Worker upload a már meglévő API tokennel megy (Cloudflare API).

### 3. Smoke teszt

`curl` szkripttel verifikáljuk:
- bot UA + `/` → `X-Prerendered: 1`, JSON-LD jelen, megfelelő `<title>`
- bot UA + `/podcast/<létező-slug>` → JSON-LD `@type: PodcastSeries`
- bot UA + `/search?q=...` → passthrough (nincs `X-Prerendered`)
- normál Chrome UA + `/` → passthrough, normál SPA HTML
- második hívás bot UA-val → `X-Prerender-Cache: HIT`

## Ami NEM ez a plan része (későbbre)

- Episode detail, category, entity hub oldalak (külön iteráció — minta kell hozzá az első kettőből)
- `bot_visits` logging tábla (egyelőre csak a Worker logokat nézzük)
- Edge cache tisztítás új epizód érkezésekor (1h TTL bőven elég kezdetnek)

## Becsült kockázat

Alacsony — a Worker fail-safe (hiba esetén passthrough), és csak bot UA-knak változik valami. Felhasználói forgalom 0 hatás.
