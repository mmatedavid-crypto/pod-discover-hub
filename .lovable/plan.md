## Diagnózis (mért adatok, nem becslés)

- **Sitemap submitted: 10 284 URL → Google indexed: 0.** Nem ranking, hanem indexelési probléma.
- **GSC top page-ek 90 napon:** az "élet jeleit mutató" oldalak `/company/*` és 1 podcast detail (sinoa). Episode-ok és hub-ok teljesen láthatatlanok.
- **Konkrét lyukak prerenderben** (Googlebot UA-val curl-ölve):
  - `/podcastok`, `/szemelyek`, `/szervezetek`, `/partok`, `/temak` → 2.7 KB shell, title "Find it. Hear it.", JSON-LD nincs. **Soft 404 a Google-nek.**
  - `/cegek` → ugyanaz a 2.7 KB shell.
  - Episode page (pl. AI hírek): 5.5 KB, van title+meta+JSON-LD, **de nincs body content**. Borderline thin-content.
  - `/company/telex` és társai: 1.5 KB, csak fejléc, **nulla epizód-lista a HTML-ben** → ezért rangsorol pos 5-7 de **0 click**.
  - `/podcast/sinoa-podcast` (15 KB) és `/person/feledy-botond` (20 KB) → ezek jól prerendereltek, ezért látszanak GSC-ben.
- `www.podiverzum.hu` még külön property → duplikált indexelés.

## A magyar piac kicsi — pontosan ezért nyerhető, de csak ha az alábbi 4 hullám élesen lefut

---

### 1. hullám — Prerender + indexelhetőség (ezen a héten, ez a 80% impact)

**A.** Hub/index oldalak prerendere. Cél: 5 darab landing page legyen Googlebot számára SSR/prerendered, mindegyik ~10 KB hasznos HTML-lel, 30-60 podcast/szervezet/személy listával, H1+H2 struktúrával, BreadcrumbList JSON-LD-vel.
  - `/podcastok` → "Magyar podcastok listája" (top 60 podcast S/A tier)
  - `/szemelyek` → "Magyar közélet és podcast vendégek" (top 60 person)
  - `/szervezetek` → "Szervezetek és intézmények podcastokban"
  - `/partok` → "Magyar pártok podcastokban" (12 párt + epizódszám)
  - `/temak` → "Témák" (21-slug taxonomy + epizódszám)
  - `/cegek` → ugyanaz mint `/szervezetek` (vagy 301-re átirányítva)

**B.** Cég/person prerender content bump. Jelenleg 1.5 KB. Cél: minimum 5 epizód-lista a HTML body-ban (title, ai_summary első 200 char, dátum, link), plus a Wikipedia bio ha van.

**C.** Episode page content bump. 5.5 KB → 8-12 KB: ai_summary teljes hossza, top 3-5 említett személy, szervezet, téma chip-jei mind szerver-rendelt linkként + "Hasonló epizódok" 5 item lista. Minden link `<a href>` formában — JS-utáni hidratált link nem számít.

**D.** Sitemap finomítás:
  - Hub-okat tegyük előre a `pages.xml`-be `priority=0.9 changefreq=daily` flag-gel.
  - Episode sitemap `<lastmod>` legyen az `episodes.updated_at`.
  - `www.podiverzum.hu` GSC property mellé tegyünk explicit 301-et (worker meglévő szabálya alapján már megvan, csak megerősíteni).

**E.** Belső linkelés futószalag: header és footer kapja meg a "Podcastok / Személyek / Szervezetek / Pártok / Témák" linkeket (most a felhasználó látja, de Googlebot ne csak SPA-route-ként). Ha jelenleg `<Link to>` használjuk, prerendered HTML-ben legyen `<a href>`.

---

### 2. hullám — Content depth a meglévő oldalakon (jövő hét)

**A.** Episode page valódi content blokkok (prerendered):
  - Teljes `clean_text`-ből generált 600-800 szavas "Mi hangzik el az epizódban?" prózás összefoglaló (van AI pipeline-unk, csak nem render-eljük az SSR HTML-be).
  - "Említett személyek" + bio-snippet (rangsorolt link)
  - "Említett szervezetek" + 1 mondat
  - "Témák" chip + 1-2 leíró mondat
  - `PodcastEpisode` JSON-LD bővítése `transcript` + `actor` mezővel

**B.** Person page bio teljes Wikipedia-szöveg first paragraph + saját AI-bio (mindkettő prerendered), Person JSON-LD `description` + `sameAs` (wikipedia/wikidata).

**C.** Hub-oldalak SEO copy: minden hub kapjon 200-300 szó intro szöveget (H2 + 2 bekezdés), pl. `/szervezetek` → "A magyar podcast-világban X szervezetet észlel a Podiverzum…". Ezek hozzák a kategória-mid-tail forgalmat.

---

### 3. hullám — Long-tail content moat (2-3 hét)

**A.** Long-tail aggregációs oldalak generálása a meglévő adatból. Magyar nyelvű kereséseknek célozva:
  - `/szemely/{slug}/epizodok` (chronological) — már van, ellenőrizni canonical-t
  - `/szemely/{slug}/temak/{topic}` — Pl. "Mit mondott Orbán Viktor a NATO-ról?" 
  - `/podcast/{slug}/epizodok/{ev}` — éves archívum, RSS-szerű
  - `/temak/{topic}/{ev}` — "Mesterséges intelligencia podcastok 2026"

**B.** Daily brief content publikus oldala. Van daily-brief cron, az output rendelhető `/napi-osszefoglalo/{datum}` slug-on. Friss, dátumos content = Google szereti.

**C.** Új "Top" oldalak (programmatic, frissül naponta):
  - `/top/podcastok-ezen-a-heten`
  - `/top/szemelyek-ezen-a-heten`
  - `/uj-podcastok`

---

### 4. hullám — Off-page + technical hygiene (folyamatos)

**A.** Backlinks: regisztrálás magyar podcast/médiakatalógusokba (refresher.hu, Index Mediatár, RTL podcast oldal stb.) — Semrush backlink_analysis-szel monitorozva.

**B.** Core Web Vitals audit mobile-on (Plausible szerint 86% mobile). LCP/CLS/INP mérés a fő templátokra.

**C.** Open Graph image per-page generálás (cég/person/podcast). Most globális og-image.jpg → minden share ugyanaz.

**D.** Hreflang nincs szükség (HU-only), `<html lang="hu">` már OK.

---

## Mérés

- GSC Indexed/Submitted arány — cél: 14 napon belül 0 → minimum 2 000 indexed.
- Impressions: 90 nap alatt jelenleg ~150 → 30 napon belül 5 000+.
- Clicks: jelenleg 17 → 30 napon belül 300+.
- Top 10-be jutó query-k: jelenleg ~5 (mindegyik 1 imp) → 30 napon belül 50+.

## Most azonnal mit csináljak

1. hullám A+B kódra menjen most. Konkrétan: 6 hub-route prerender pipeline-ba kötése (megnézem hogyan készül a meglévő `/topic/*` prerender, ami működik), plus a company/person prerender template-be epizód-lista beszúrása. Ez 1-2 ülés munka és ez hozza a 80% indexelést.

Ha rábólintasz, megyek és csinálom az 1. hullám A-t és B-t (hub-prerender + company content bump).