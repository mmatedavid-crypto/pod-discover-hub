# Kutatási draft: "A háború mint téma a magyar podcast-piacon (2025.06 – 2026.06)"

**Státusz:** DRAFT (munkaanyag, következő kutatás alapja)
**Készült:** 2026-06-15
**Cél:** sajtóanyag + podiverzum.hu kutatási oldal
**Forrás PDF:** `/mnt/documents/haboru-kutatas-v2-osszesitett.pdf` (13 oldal, összesítve)
**Kapcsolódó grafikonok:** `/mnt/documents/haboru-emlitesek-2025-06_2026-06.png`, `/mnt/documents/haboru-kontextus-2025-06_2026-06.png`

---

## 1. Vezetői összefoglaló (a sztori íve)

1. **Felvezetés:** hogyan futott a "háború" szó a magyar podcast-címekben és -leírásokban 2025.06 – 2026.06 között (havi bontás, abszolút és %).
2. **Tisztítás:** levesszük az Irán-Izrael/Gáza kontextust → marad a tiszta orosz–ukrán háborús diskurzus.
3. **Csattanó:** a 2026.04.12-i magyar országgyűlési választás után az ukrán háború mint téma **látványosan elhal** a magyar podcastokban — nem csak szűkül, hanem szinkronizáltan eltűnik a teljes politikai spektrumon.

## 2. Kulcs-megállapítások

- **2025-06 csúcs** (Irán-Izrael 12 napos háború miatt felugrás).
- **2026-03 második csúcs** (kampányhajrá, ukrán-háború narratíva).
- **2026-04-12 után meredek esés** mind abszolút értékben, mind a teljes HU epizódszámhoz viszonyítva.
- **Ukrajna-kontextus: −60% relatív csökkenés** választás előtt vs. után (havi szinten ~5×-ös különbség a csúcshoz képest).
- **Szinkronizált elhallgatás:** kormánypárti, ellenzéki és háború-specialista podcastok **egyszerre** ejtették a témát — ez nem véletlen szünet, hanem programozási váltás. → a háború kampánytéma volt, nem önálló érdeklődés.

## 3. Top podcastok a háborús témában (2025.06 – 2026.06)

Teljes "háborús" epizódszám szerinti top 20, Ukrajna / Irán / Izrael-Gáza kontextusbontással. Lásd PDF 7-8. oldal.

**Ukrajna-specialisták:** Frontvonal (21/23), Szuverén (12/12), Kontroll (23/31), PestiSrácok (11/14).
**Mindenes politikai/közéleti:** Szélsőközép, Partizán, Márki-Zay Péter, 444, HVG, Magyar Hang.
**Gazdasági lencse:** Portfolio, Portfolio Checklist, Klasszis, Concorde.
**Pártközeli:** XXI. Század Intézet (kormánypárti).
**Zaj (kiszűrendő):** TheHistoryGeek, Gépész — történelmi/szakmai "háború".

## 4. "Ki felejtette el?" — választás előtt vs. után (Ukrajna)

≥3 ep pre-küszöbbel, pre = 2026.01.01 – 2026.04.11, post = 2026.04.12 – 2026.06.15.

| Podcast | Pre | Post |
|---|---:|---:|
| Szélsőközép | 11 | 1 |
| Szuverén | 8 | **0** |
| Partizán | 8 | **0** |
| Magyar Hang | 7 | **0** |
| PestiSrácok | 7 | **0** |
| XXI. Század Intézet | 5 | **0** |
| Innen és Túl | 4 | 0 |
| Frontvonal | 4 | 0 |
| Chud Hadművelet | 3 | 0 |
| Jelen Podcast | 3 | 0 |
| Kontextus | 3 | 0 |
| Portfolio | 3 | 0 |
| Védvonal | 3 | 0 |

**Kivételek (témát részben fenntartók):** Kontroll, Klasszis (3-3 post-ep), Márki-Zay Péter (1).

## 5. Módszertan

- **Adatforrás:** Podiverzum HU katalógus (`podcasts.language ILIKE 'hu%'`), `episodes` tábla, `title + description` regex match.
- **Háború match:** `\\m(háború|háborús|háborúz|haboru)\\M` szótő (ékezettel és anélkül).
- **Kontextusbontás:** Ukrajna / Irán / Izrael-Gáza külön regex pattern-ekkel, multi-tag megengedett (egy epizód több bucketbe is eshet).
- **Időablak:** 2025-06-01 – 2026-06-15.
- **Választási cut:** 2026-04-12 (magyar országgyűlési választás).
- **Limitációk:** csak cím + leírás (transcript-szintű elemzés még nem készült); false-positive a történelmi/szakmai használatra (Gépész, TheHistoryGeek); nem AI-osztályozás, hanem regex.

## 6. Következő lépések a publikációhoz

- [ ] **Transcript-szintű ellenőrzés** a top 20 podcaston (most csak cím/leírás) → pontosabb kontextus
- [ ] **Pre/post bontás további metszetekkel:** "béke" mint ellentett téma; gazdaság/infláció felfutása mint "helyettesítő" téma
- [ ] **Párt-korreláció:** Fidesz/Tisza említések együttmozgása a háborús témával
- [ ] **2026-03 csúcs mélyebb bontása:** mely podcastok, mely epizódok hajtották
- [ ] **Vizuális egységesítés:** Podiverzum brand színek, podiverzum.hu kutatási oldal layout
- [ ] **Sajtó-anyag verzió:** 1 oldal + 3 kulcs grafikon + idézhető megállapítások
- [ ] **Web-verzió:** interaktív (havi szűrő, podcast szűrő, kontextus toggle)
- [ ] **Etikai/jogi review:** podcastok név szerinti említése pre/post listán — egyértelműen adatleíró, nem értékítélet

## 7. Reprodukálhatóság

- Lekérdezések: psql ad-hoc, a session során futtatva — a SQL-eket be kell emelni `scripts/research/haboru-tema/` mappába a végleges publikáció előtt.
- Generáló script: matplotlib + reportlab, szintén archiválandó.
- Snapshot dátum: 2026-06-15 (a katalógus folyamatosan bővül, a számok kissé változhatnak).
