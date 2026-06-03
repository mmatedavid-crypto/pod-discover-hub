## GSC akciósorrend — végrehajtási terv

A 3 hónapos Search Console elemzés alapján 5 lépésben haladunk, priorizálva. Minden lépés végén megállunk, megnézzük a hatást, mehetünk a következőre.

### 1. Title/meta sweep — top-20 brand-query oldal (LEGNAGYOBB ROI)
**Cél:** pos 4-15 sávban lévő oldalak CTR-jét 0% → 10%+ vinni.

Érintett oldalak (GSC top brand-query találatok, jelenleg 0 klikk):
- `/podcast/emazon` (29m, pos 8.5)
- `/podcast/vedvonal-podcast`
- `/podcast/miting`
- `/podcast/oszinte-forex`
- `/podcast/bod-peter-akos-podcastja`
- `/podcast/remenyhal`
- `/podcast/csalovadaszok`
- + további ~15 podcast a top-listából

**Mit változtatunk a `PodcastDetail.tsx` SEO blokkjában:**
- Title template: `"{Podcast név} – {epizódok száma} epizód · podcast | Podiverzum"` (most: rövidebb/generikus)
- Meta description: első mondat a podcast leírásából + "Hallgasd meg az összes epizódot a Podiverzumon — magyar podcast katalógus."
- Brand-anchor a title végén: `| Podiverzum` egységesen
- Ha 1+ verified person/org van → name-drop a description-be (pl. "Műsorvezető: X Y")

**Hatásmérés:** 2 hét múlva GSC újraellenőrzés ezeken az URL-eken.

### 2. `www.podiverzum.hu` URL-ek kitakarítása GSC-ből
**Probléma:** GSC még mindig 17m/4c a `www`-s verzión, a 301 működik de a property kettős indexelést mutat.

**Lépések:**
- GSC Removals tool → `www.podiverzum.hu` prefix temp removal (90 nap)
- Ellenőrizzük hogy a `infra/cloudflare-worker/worker.js` 301-e helyes és `Cache-Control: max-age=31536000` van
- Sitemap-ből kiszedjük az esetleges www referenciát (most már apex-only, de ellenőrizzük)
- Robots.txt-ben `Host: podiverzum.hu` direktíva

### 3. Person hub title-template újratervezés
**Cél:** `/person/*` oldalak (pl. Feledy Botond pos 26, 0 klikk) snippet-je releváns legyen.

**`PersonDetailPage.tsx` SEO frissítés:**
- Title: `"{Név} – {epizód szám} podcast epizódban hallható | Podiverzum"`
- Description: első bekezdés bio + "Megnézhető {N} podcast epizód, amelyben {Név} szerepel."
- H1 már stimmel, csak a `<title>` és meta description kell

Ugyanez analóg módon: `OrgDetail` / `CompanyDetail` (`/company/klubradio` 16m/0c, pos 7.2).

### 4. Topic-hub javítás
**Cél:** `/topic/keresztenyseg` típusú oldalak (18m/0c, pos 10) snippet-jét feldobni.

**`TopicDetailPage.tsx`:**
- Intro-bekezdés a téma rövid leírásával (most lista, nincs szöveg → snippet üres)
- Title: `"{Téma} – {N} podcast epizód magyar podcastokból | Podiverzum"`
- Felső 200-300 karakteres intro (statikus vagy AI-generált egyszer)

### 5. Várakozás + újraelemzés (2 hét múlva)
- Új sitemap (146k URL, 2026-06-01 LIVE) GSC indexelési hatása
- 1-4. lépés CTR-hatása
- Új GSC dump → következtetések → következő iteráció

---

### Technikai részletek
- Mind frontend-only változtatás (SEO komponens, helmet/title-only)
- 0 DB migráció, 0 edge function
- `PodcastDetail.tsx`, `PersonDetailPage.tsx`, `OrganizationDetailPage` (vagy `CompaniesHubPage` item), `TopicDetailPage.tsx` érintett
- Brand-anchor egységesen `| Podiverzum` (most vegyesen `— Podiverzum` és csak név)

### Sorrend és időigény
1. ~30 perc, legnagyobb hatás
2. ~10 perc, infra ellenőrzés
3. ~20 perc
4. ~20 perc
5. passzív, 2 hét múlva

Kezdjük az 1-essel? Vagy van más prioritás?
