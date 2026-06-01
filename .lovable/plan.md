## Cél
Sitemap napi automatikus frissítése **Lovable Cloud-on belül**, GitHub interakció nélkül. A `gen-sitemap.mjs` logikája átköltözik egy edge function-be, az XML-ek Supabase Storage-ban élnek, és a Cloudflare worker proxyzza őket a `podiverzum.hu/sitemap.xml` és `/sitemaps/*.xml` URL-ekre.

## Lépések

### 1. Storage bucket
- Új public bucket: `sitemaps` (SELECT public, INSERT/UPDATE csak service_role).
- Migration írja meg a bucketet + RLS policy-t.

### 2. Edge function: `refresh-sitemap`
- `supabase/functions/refresh-sitemap/index.ts` — a `scripts/gen-sitemap.mjs` Deno-portja.
- Ugyanaz az adatlekérés (podcasts/episodes/people/organizations/topics/pages), ugyanazok a szabályok és priority-k.
- A generált XML-eket nem fájlba írja, hanem `supabase.storage.from('sitemaps').upload(...)` `upsert:true`-val:
  - `sitemap.xml` (index)
  - `pages.xml`, `podcasts-*.xml`, `people-*.xml`, `organizations-*.xml`, `topics-*.xml`, `episodes-*.xml`
- Content-Type: `application/xml`, cache-control: `public, max-age=3600`.
- Visszatérési JSON: `{ok, total_urls, files: [...], duration_ms}`.
- `verify_jwt = false` (cron hívja, nincs user).

### 3. pg_cron job
- Új cron: `refresh-sitemap-daily`, `30 4 * * *` (04:30 UTC = 06:30 CEST).
- `net.http_post` a function URL-re, service role apikey header-rel.
- `supabase--insert`-tel mint a többi cron (nem migration, mert anon key benne van).

### 4. Cloudflare worker proxy
- `infra/cloudflare-worker/worker.js` kiegészítés:
  - `GET /sitemap.xml` → fetch `https://<project>.supabase.co/storage/v1/object/public/sitemaps/sitemap.xml`, response body proxyzva, `Content-Type: application/xml`.
  - `GET /sitemaps/*` → ugyanígy, path mapped to storage object.
  - Edge-cache 1h.
- A `public/sitemap.xml` és `public/sitemaps/*.xml` fájlok a repo-ból törölhetők (a worker mindenképpen elveszi a kérést a Lovable hostingról) — de biztonságból maradjanak fallback-nek, mert a build oldal nem érinti a worker route-okat.

### 5. GitHub Actions workflow törlése
- `.github/workflows/refresh-sitemap.yml` törlése — nincs rá szükség.

### 6. Bootstrap futtatás
- A function első futtatása élesben (manuálisan, `supabase--curl_edge_functions`), hogy a Storage azonnal feltöltődjön és a `podiverzum.hu/sitemap.xml` ne 404-ezzen, amíg a cron először lefut.

## Technikai részletek

- Service role key már elérhető edge function-ben (`SUPABASE_SERVICE_ROLE_KEY` env).
- Storage path = ugyanaz, mint most a repo-ban (`sitemaps/podcasts-1.xml` stb.), a `sitemap.xml` index ezekre mutat: `https://podiverzum.hu/sitemaps/podcasts-1.xml`.
- Worker route-ok már léteznek a `podiverzum.hu` zónán (prerender + 301), csak két új útvonal kell.
- Memory: új core sor a sitemap refresh cron-ról.

## Mi marad változatlan
- `scripts/gen-sitemap.mjs` megmarad lokális manuális futtatáshoz (debug, one-off).
- A `podiverzum.com` workerét nem érintjük.
- GSC-nek továbbra is a `https://podiverzum.hu/sitemap.xml` URL-t adjuk meg.

## Mit nem csinálok
- Nem nyúlok a podiverzum.com workeréhez.
- Nem változtatok a sitemap tartalmán/szűrőin (a "mindent bele" policy marad).
- Nem kell GitHub secret, nem kell semmilyen kézi GH lépés.
