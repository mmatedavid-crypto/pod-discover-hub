## Cél

A `/jelentes/haboru-mint-tema-2026` ne adat-falként, hanem **egyetlen ívű sajtócikként** olvasódjon — a „Magyar podcast piac 2026" jelentés szerkezetét és hangját követve. Az adatokon és számokon **nem változtatunk**, csak a sorrenden, a tagoláson, a szövegen és azon, hogy mit emelünk vizuálisan ki.

## A jelenlegi probléma

- 4 hero-metrika + 5 chart szekció + 5 metodikai lábjegyzet egymás után, narratív kapcsolat nélkül.
- Minden chart önállóan próbál „mindent megmondani" → ismétlődő számok (5,16% / −70% / 2,91% / 1,06% háromszor is megjelennek).
- A módszertani magyarázatok a fejezetek közé ékelődnek, megakasztják az olvasást.
- A „Top podcastok" tábla és a kontextus-chart önmagában nem visz előre a sztoriban.

## Új szerkezet — 3 fejezet, egy ív

```
HERO
  H1 + lead (változatlan, már jóváhagyott)
  → 1 sor under-lead: „Mit látunk 13 hónap adataiban?"

[Insight-strip: 3 db kártya, mint a piac-jelentésben]
  1. „A háború kis, de mérhető szelet" — 13 havi átlag 2,28%
  2. „Egy márciusi csúcs uralja az évet" — 5,16%, Gáza/tűzszünet hetei
  3. „A választás után törés jött" — pre 2,91% → post 1,06% (−64%)

FEJEZET 1 — „Egy év, egy görbe" (sztori: a háború súlya hullámzott, de nem dominált)
  → A 13 hónapos ráta-chart (megtartjuk, ez a fő vizuál)
  → Alatta 2 rövid bekezdés: mit látunk hullámként, mikor volt csúcs, mikor mély
  → 1 callout: „2026. március — minden idők csúcsa"

FEJEZET 2 — „A választás előtt és után" (a cikk lényege, ez a hír)
  → Pre/post 65 napos összevetés (megtartjuk, ez a második fő vizuál)
  → Új súlyozás: ez a fejezet kapja a legtöbb prózát, mert ez a hír
  → 2 bekezdés narratíva: a Gáza-tűzszünet körüli márciusi csúcs után
    áprilisban beomlott az Ukrajna-vonal (−80%), és a választás
    utáni 65 napban a téma fele annyi műsornál maradt napirenden
  → 1 callout: „87 → 46 podcast" — ez az emberi szám, nem a ráta

FEJEZET 3 — „Mi maradt: a specialisták" (kontextus + kik viszik tovább)
  → Ukrajna vs. Közel-Kelet havi chart EGYSZERŰSÍTVE
    (a 2-soros bar/hónap helyett egy vékony line/area, kevésbé domináns)
  → Top 3-5 podcast rövid listában (nem nagy táblaként), prózai
    bevezetővel: „A téma 2026 nyarára néhány Ukrajna-specialista
    műsorhoz húzódott vissza."

ZÁRÁS — „Mit jelent ez?" (1 bekezdés, kb. 5-6 mondat)
  Egységes prózai konklúzió a jelenlegi 3 különálló Callout helyett.
  Megfogalmazás: a háború súlya a kínálatban követte a kampány
  ritmusát, a választás után visszafogottabb téma lett — a Podiverzum
  katalógusa lehetővé teszi az ilyen elmozdulások mérését.

CTA (változatlan, már javítva: /temak/haboru)

A jelentésről (boilerplate, változatlan)

Módszertan + letöltések
  → Egy összevont, kinyitható szekció a végén (jelenleg 5 lábjegyzet
    a chart-ok közé szórva — ezeket itt összegyűjtjük).
  → Letöltés gombok (.md, .json) ide kerülnek a heroból, hogy a hero
    tisztább legyen.
```

## Mit törlünk / olvasztunk össze

- A 4 hero-metrika kártyát (havi átlag / márciusi csúcs / májusi mélypont / pre-post) **kivesszük a heroból** — ezek a számok beépülnek a 3 fejezet prózájába és az insight-stripbe. Hero = H1 + lead + 1 mondat, semmi más.
- A módszertani kis-lábjegyzeteket a chart-ok alól töröljük; **egyetlen** „Módszertan" szekció lesz a cikk végén.
- A jelenlegi „Mit jelent mindez?" 3 különálló Callout helyett **egy bekezdés** zárás.
- Top-podcastok tábla → szöveges felsorolás 3-5 névvel, hogy ne nyomja agyon a 3. fejezetet.

## Mit NEM változtatunk

- Az összes szám, dátum, százalék, podcast-név.
- A már jóváhagyott H1 és lead.
- A CTA célpontja (`/temak/haboru`).
- A JSON-LD és SEO meta-adatok.
- A letölthető .md / .json fájlok tartalma.
- Az AI-ügynök kártya hidden marad.

## Technikai

- Egyetlen fájl: `src/pages/HaboruTemaReport.tsx`.
- A `DownloadableFigure`, `Callout`, `InsightCard`, `huNum`/`huInt` helperek és a `MONTHS` / `PREPOST` / `TOP_PODS` adat-objektumok érintetlenek — csak újrarendezzük őket.
- A pre/post chart az új súlyozás miatt vizuálisan picit nagyobb hangsúlyt kap (nem új komponens, csak elsőre kerül a fejezet élére).
- Az Ukrajna vs. Közel-Kelet chart komponens helyett egy egyszerűbb, kompaktabb vizuál (kis havi sávok két színnel egymás alatt — ugyanaz a `DownloadableFigure` keret).

## Eredmény

Kb. ugyanannyi adat, fele annyi „nézzd a chartot" pillanat, és **egy összefüggő, hírré olvasható szöveg** — pont olyan stílus, mint a piac-jelentés.
