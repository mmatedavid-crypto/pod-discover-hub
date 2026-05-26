## Cél

A swipe flow eredménye átáll a generikus „aura kártyáról” egy nyugta-stílusú (thermal receipt) megosztható „Hallgatói profilra”. Ez lesz az új viral motor: könnyű képernyőképet csinálni róla, felismerhető Podiverzum-tárgy, mobil-first 9:16 (+1:1 OG).

## Scope — mit építünk

### 1. Archetype set (`src/lib/listenerProfiles.ts`)
8 indító profil, mindegyik:
- `id`, `name` (pl. „A Fókuszált Elemző"), `traits: [3]`, `recommendedDirection`, `rareBadge?`
- Lista: Fókuszált Elemző, Mélyinterjú-vadász, Stratégiai Figyelő, Közéleti Radar, Üzleti Navigátor, Tech Kíváncsi, Kultúrflâneur, Történetkereső.
- Nincs vallás/egészség/párt/szexualitás dimenzió.
- Mapping a meglévő `tasteVector` topic-súlyaiból → profil-id (heurisztika: legmagasabb 3 topik → legközelebbi profil).

### 2. Receipt komponens (`src/components/receipt/ListenerReceipt.tsx`)
- DOM-alapú render (nem canvas — élesben snapshotolható, a11y barát, jól szerkeszthető).
- Mobil-first, fix 360px szélesség sablon, monospace (`JetBrains Mono`), fekete-fehér, papír textúra (subtle SVG noise), perforált fel/le él, szaggatott divider, pontozott leader sorok pipával, barcode SVG (random 40 vonalból a `share_id`-ből deterministically).
- Struktúra:
  - Fejléc: `PODIVERZUM RECEIPT` · dátum
  - `RECEIPT NO: PZ-YYYY-MMDD-XXXX`
  - `HALLGATÓI PROFIL:` + nagy név
  - 3 trait sor pontozott leaderrel + ✓
  - `AJÁNLOTT IRÁNY:` 1 sor
  - opcionális `RITKA PROFIL` / `TOP 12% FIGYELŐ` (csak ha statisztikailag védhető — most kihagyjuk, flag mögött)
  - `TOTAL: 1 ÚJ HALLGATÓ`
  - barcode + `podiverzum.hu/start`
  - `NEKED MI JÖN KI?` · „Find it. Hear it."

### 3. Kép-export (`src/lib/receiptImage.ts`)
- `html-to-image` (vagy `dom-to-image-more`) lib hozzáadása.
- Két export méret: **9:16 (1080×1920)** story default + **1:1 (1080×1080)** OG/feed.
- Háttér: meleg fehér (#f7f4ee), enyhe folds/noise SVG, nyugta középre, alja levegős.
- `shareOrDownload(blob)`: Web Share API `files` → fallback download → fallback link copy.

### 4. Result screen UX (`StartSwipePage` eredmény fázis)
- Nagy receipt felül.
- Primary: „Megosztom a profilom" (9:16 PNG → native share).
- Secondary: „Kép mentése" (1:1 letöltés), „Link másolása", „Újrapróbálom".
- Share után microcopy: „Most jön a jó rész: nézd meg, a barátaidnak milyen hallgatói profil jön ki."

### 5. Public share oldal
- Új route: `/hallgatoi-profil/:shareId` → `ListenerProfilePage`.
- A régi `/te-podiverzumod/eredmeny/:slug` 301-szerű kliens redirect az újra (backward compat).
- Above the fold: a barátja receiptje, alatta **erős CTA blokk**: „Neked mi jön ki? Készítsd el a saját hallgatói profilod." → `/start?ref={shareId}`.
- `noindex,nofollow` minden egyedi share oldalon.

### 6. Share backend
Újrahasznosítjuk a meglévő `te_podiverzumod_shares` táblát + edge functiont (`te-podiverzumod-share`):
- `result_type='listener_profile_receipt'`
- `result_title` = archetype name, `result_subtitle` = recommended direction, `tags` = traits.
- Új oszlop **nem kell**, a meglévő séma fedi. Egy migráció: index a `created_at`-re ha hiányzik (ellenőrzöm).
- Új edge function nem szükséges — body shape kompatibilis.

### 7. OG image
- A meglévő `og-image` edge function kap egy `kind=receipt` ágat: 1200×630 receipt-szerű render (SVG → PNG), `[Archetype] lettem a Podiverzumon` címmel.
- Per-share dinamikus URL a `ListenerProfilePage` Helmetjében.

### 8. Analytics
- Új helper `src/lib/profileEvents.ts` → írás `analytics_events` táblába (meglévő `page_view`/event sablon mintán).
- Eventek: `swipe_started`, `swipe_completed`, `profile_generated`, `profile_share_clicked`, `profile_image_downloaded`, `profile_link_copied`, `shared_profile_viewed`, `shared_profile_cta_clicked`, `second_generation_from_shared_profile`, `episode_click_after_profile`.
- Mezők: `share_id`, `source_profile_id` (URL `?ref=`), `archetype_id`, `utm_*`, `referrer`, anonim `session_id` (sessionStorage uuid, nem cookie).
- Nincs Meta Pixel, nincs cookie.

### 9. Cleanup
- A régi `tasteShareCard.ts` (aura canvas) megmarad fallbackként, de a result screen alapból a receipt-et hívja.
- Marketing copy a `/start` landing oldalon: H1 → „Milyen podcast-hallgató vagy?", CTA „Indítom".

## Technikai részletek

- Új dep: `html-to-image` (~30 KB gzip, nincs canvas drawingfont gond).
- Fontok: `JetBrains Mono` (már a projektben? ha nem, Google Fonts `<link>` az `index.html`-be).
- Barcode: determinisztikus, `hash(share_id) → 40 oszlop {1,2,3} szélességgel`. Pure SVG.
- Mobile-first: receipt natív DOM scale-up nélkül, export pillanatban 3× pixel-ratio.
- Privacy: nincs cookie, sessionStorage csak `anon_session_id` UUID.
- SEO: shared oldal `<meta name="robots" content="noindex,nofollow">`.

## Fájl-térkép

```
src/lib/listenerProfiles.ts          [új]   archetype lista + mapping
src/lib/receiptImage.ts              [új]   html-to-image export + share/download
src/lib/profileEvents.ts             [új]   first-party analytics
src/components/receipt/
  ListenerReceipt.tsx                [új]   DOM receipt komponens
  Barcode.tsx                        [új]   SVG barcode
src/pages/StartSwipePage.tsx         [edit] eredmény fázis új UX
src/pages/StartLandingPage.tsx       [edit] H1 + CTA copy
src/pages/ListenerProfilePage.tsx    [új]   /hallgatoi-profil/:shareId
src/App.tsx                          [edit] új route + 301 a régi /te-podiverzumod/eredmeny/:slug-ra
src/pages/TePodiverzumodSharePage.tsx [edit] redirect az új route-ra
supabase/functions/og-image/index.ts [edit] kind=receipt ág
package.json                         [edit] +html-to-image
```

## Out of scope (most)
- „RITKA PROFIL" tényleges százalék-számolás (csak ha lesz elég adat).
- Piros pecsét variant.
- Több mint 8 archetype.
- A/B test 9:16 vs 1:1 között.
- Régi `tasteShareCard.ts` törlése (drain-after refactor).

Megerősíted, hogy mehet így? Ha igen, kezdem az implementációt.