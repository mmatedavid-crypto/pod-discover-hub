# Podiverzum: első növekedési és SEO javításcsomag

Dátum: 2026. szeptember 16. (alkalmazva és ellenőrizve: 2026. szeptember 17.)
Érintett oldal: kizárólag podiverzum.hu.

## Állapot

A javításcsomag teljes egészében alkalmazva a HU projektben. A korábbi kreditblokk
(amely miatt csak a két közös szövegmodul került be a
`39b91ce1d564bd6e220664be957463ae734f6deb` commitban) megszűnt, a bekötés elkészült.

- Frontend: alkalmazva, buildelve, előnézetben ellenőrizve.
- Prerender edge függvény: telepítve a Lovable Cloud mechanizmusával.
- Cloudflare Worker: mindkét forráspéldány frissítve és bájtra azonos; az éles
  telepítés 2026. szeptember 17-én megtörtént a projektben tárolt Cloudflare
  hitelesítő adatokkal. A `podiverzum.hu/*` és `www.podiverzum.hu/*` útvonalakhoz
  kötött script (`podiverzum-hu-bot-prerender`) frissült; külső ellenőrzéssel
  igazolva (lásd az Ellenőrzés szakaszt).

## Kiinduló adatok

Forrás: a tulajdonoshoz csatlakoztatott Google Search Console.

| Mutató | 2026. aug. 17. – szept. 13. | Előző 28 nap |
|---|---:|---:|
| Google webkeresési kattintás | 774 | 418 |
| Google megjelenés | 22 375 | 14 710 |
| Átkattintás | 3,46% | 2,84% |

A kattintások növekedése 85,2%. Az adott időszakban 684 kattintás Magyarországról,
492 mobilról érkezett. Ez földrajzi országadat; települési vagy megyei lefedettséget
nem bizonyít. A 774 kattintás nem 774 egyedi látogató.

Az aug. 18. – szept. 14. közötti időszakban a főoldal 5 kattintást és 64 megjelenést
kapott. A „podcast” keresésnél 13 megjelenés és 46,31-es átlagos pozíció, a
„magyar podcast” kifejezésnél 2 megjelenés és 30,5-es pozíció szerepelt. A kis
elemszám miatt ezek irányjelzők, nem stabil rangsormérések.

A sitemap API 164 330 beküldött URL-t jelzett. Az ott szereplő indexed=0 mezőből
nem következik, hogy az oldal nincs indexelve: a főoldal és a /kategoria/tech
URL-ellenőrzése egyaránt „Submitted and indexed” eredményt adott. A beküldött
URL-ek indexeltségét nem állítjuk.

A szándékosan eltávolított Szélsőközép-epizód 170 kattintást hozott az első
időszakban. Ezt nem szabad visszaállítani vagy növekedési lehetőségként kezelni;
a későbbi összehasonlításokban a megszűnt forgalmat külön kell kezelni.

## A javítások

1. A főoldali felfedező blokk valódi, aktív kategóriákra és a fő böngészési
   utakra (toplista, kategóriák, témák, személyek) vezető hivatkozásokat kap.
   Ugyanezek a linkek a keresőknek kiszolgált változatban is megjelennek.
   A keresés, a lejátszó és a Hallgatási helyzetek változatlanok.
2. A kategóriaoldalak címsora a kategóriát és a „podcastok” kifejezést is
   tartalmazza. Közös szövegmodul adja a bevezetőt és a metaadatot. Morzsamenü
   és más valóban aktív kategóriákra mutató linkek segítik a böngészést.
3. A közös SPA HTML-ből kikerült a minden aloldalon főoldalra mutató canonical
   és og:url; az oldalak saját canonicalt állítanak be, keresési paraméter nélkül.
4. A prerender főoldal elkülöníti a friss („Most érdemes meghallgatni”) és az
   időtálló epizódokat; archív tartalmat nem nevez frissnek.
5. Az ellenőrzött podcast-, epizód- és kategórialekérdezések elválasztják az
   adatbázishibát a valóban hiányzó rekordtól: előbbi 500/no-store, utóbbi
   megjelölt (`X-Prerender-Missing: 1`) 404/noindex választ ad.
6. A két azonos Worker-forrás csak a megjelölt 404/410 válaszokat továbbítja
   valódi hibakóddal. Ismeretlen/nem kezelt útvonalak és átmeneti hibák továbbra
   is az eredeti alkalmazáshoz kerülnek, és nem kerülnek gyorsítótárba. Az új
   cache-névtér élesítéskor elkerüli a korábbi változat visszaadását; hiányzó
   tartalom cache-e 60 mp.

Nincs adatbázis-módosítás, migráció, import, tartalomgeneráló feladat, cron-,
rangsor-, AI-modell-, jogosultság-, tárhely- vagy .com-módosítás. Nem került
kiküldésre üzenet.

## Ellenőrzés (2026. szeptember 17., tényleges eredmények)

- `node --test scripts/test-seo-growth.mjs`: 14/14 teszt sikeres (megjelölt
  404/410, nem megjelölt 404, 401/429/500/503, hálózati hiba, cache-névtér,
  emberi böngészés, Worker-példányok azonossága, kategóriaszöveg és linkek).
- `bunx vitest run`: a projekt meglévő tesztkészlete sikeres.
- `tsgo` típusellenőrzés: hiba nélkül.
- Vite build: sikeres, build-errors.log „build OK”.
- Böngészőpróba (Playwright, 1280 és 390 px): főoldal és /kategoria/tech
  megjelenés, felfedező linkek, kategória-morzsamenü, keresés és lejátszó
  elérhetőség rendben.
- A két Worker-példány bájtra azonos.

## Cloudflare Worker élesítés (2026. szeptember 17., tényleges eredmények)

A telepítés a projektben korábban tárolt `CLOUDFLARE_API_TOKEN` és
`CLOUDFLARE_ACCOUNT_ID` hitelesítő adatokkal történt, egy egyszeri, azóta
törölt segédfüggvényen keresztül. Fontos tanulság: a zóna útvonalai a
`podiverzum-hu-bot-prerender` scriptre vannak kötve (nem a wrangler.toml-ban
szereplő `podiverzum-bot-prerender` névre) — a helyes script frissült.

Külső ellenőrzés az éles domainen, Googlebot felhasználói ügynökkel:

- Törölt Szélsőközép-epizód: HTTP 404, `x-prerender-missing: 1`,
  `x-robots-tag: noindex, nofollow`, rövid (60 mp) gyorsítótár.
- Főoldal: 6 valódi kategóriahivatkozás (/kategoria/tech, true-crime,
  tortenelem, uzlet, onfejlesztes, gyerek).
- /kategoria/tech: „Tech podcastok” címsor, saját canonical.
- Ismeretlen útvonal: 200-as origin fallback (nem válik álnév-404-gyé).
- Emberi böngésző: 200-as SPA. robots.txt, sitemap.xml: 200.
- www.podiverzum.hu: 301 a www nélküli címre, útvonal megtartva.

## Fennmaradó blokkoló

Nincs. A teljes csomag éles: frontend közzétéve, prerender telepítve, Worker élesítve.

## Országos növekedés: következő 90 nap

| Időszak | Feladat | Mit mérünk? |
|---|---|---|
| 1–2. hét | A Worker élesítése; főoldal és 6 kategória ellenőrzése | Indexelhetőség, kategóriák megjelenése/kattintása, hibás URL-ek |
| 3–6. hét | A tech, bűnügy, történelem, üzlet, önismeret és gyerek/család gyűjtőoldalak tartalmi szerkesztése | Nem márkázott keresések, belépések, epizódkattintás |
| 3–6. hét | Meglévő eseménymérésből keresés → epizód → érdemi hallgatás összekötése | Lejátszásindítás és hallgatási idő; botok/admin külön |
| 6–12. hét | Forrásokkal ellenőrzött heti ajánlók és kapcsolatfelvétel műsorkészítőkkel, külön engedélyezett kiküldéssel | Partneri hivatkozások, visszatérő hallgatók, keresési forgalom |

Tervezési cél: 90 napon belül 2000 havi Google-kattintás felé haladni. Ez cél,
nem előrejelzés vagy garancia; a 28 napos alapot az eltávolított epizód nélkül is
mérni kell. A napi ezres közönség egy későbbi lépcső; a mostani keresőforgalom
napi átlaga 27,6.

Technikai háttér:
- https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics
- https://developers.google.com/search/docs/crawling-indexing/links-crawlable
