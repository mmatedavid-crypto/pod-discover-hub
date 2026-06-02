## Terv

### 1) Meglévő heti anyag részoldalának javítása
- Javítom a `/heti/:slug` betöltést a `HetiArticlePage.tsx`-ben.
- A mostani hiba oka: a slug ISO-hétből hétfőt számol, de a meglévő anyag `week_start` dátuma vasárnapra esik, ezért a túl szűk keresési ablak nem találja meg.
- Új logika: a slugból kinyert év/hét alapján több közeli publikált heti anyagot lekér, majd azt választja, amelynek `hetiSlug(post)` pontosan egyezik, vagy ugyanabba az ISO-hétbe esik.
- Ezzel a `/heti` listában látható régi anyag kattintás után nem üres oldalra megy.

### 2) Hiányzó új heti anyag létrehozása és publikálása
- Meghívom a heti szerkesztőségi generálót a hiányzó időszakra: **2026-05-25 – 2026-06-01**.
- Nem hagyom draftban: publikált státuszra állítom, hogy azonnal látszódjon a `/heti` oldalon és a főoldali heti stripben is.
- Utána ellenőrzöm, hogy a legfrissebb heti anyag publikáltként szerepel-e az adatbázisban.

### 3) Heti automata ütemezés helyreállítása
- Beállítom a heti automatikus futást, hogy ne maradjon ki a következő hét.
- Ütemezés: hétfő reggel, Lovable Cloud backend function hívás, draft vagy publish beállítással a meglévő `weekly-editorial-post` működéséhez igazítva.
- A cél: június 2 után már ne kézzel kelljen pótolni a heti anyagokat.

### 4) Google News sitemap javítása
- A `/news-sitemap.xml` most 404-et ad, ezért Google nem fogadja el.
- Javítom a sitemap generálást úgy, hogy a `news-sitemap.xml` ténylegesen kikerüljön a publikus sitemap tárhelyre.
- A Google News sitemap tartalma:
  - friss, 48 órán belüli Podiverzum Heti cikkek,
  - friss, magyar podcast-epizód oldalak, ha megfelelnek az indexelési feltételeknek,
  - helyes Google News namespace és mezők: publication, language, publication_date, title.
- Felveszem a `news-sitemap.xml`-t a sitemap indexbe és a `robots.txt`-be is.

### 5) Cache és worker korrekció
- A Cloudflare workerben rövidebb cache-t állítok a `/news-sitemap.xml`-re, hogy a friss hírek ne egy órás késéssel kerüljenek ki.
- A worker mindkét példányát frissítem:
  - `infra/cloudflare-worker/worker.js`
  - `.lovable/cloudflare-worker.js`

### 6) Regenerálás és ellenőrzés
- Lefuttatom a sitemap frissítést.
- Ellenőrzöm:
  - `/heti` mutatja az új hetet,
  - a régi heti anyag részoldala betölt,
  - `https://podiverzum.hu/news-sitemap.xml` 200-as választ és XML-t ad,
  - a Google News XML nem üres és valid szerkezetű.

### 7) Deploy
- A backend változások automatikusan élesednek.
- A frontend/worker változás után publikálási lépést is kérek/indítok a Lovable oldalon, hogy a javítás éles domainen is kimenjen.