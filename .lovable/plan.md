## A jelenlegi állapot (HU korpusz, 830 podcast)

`app_settings.formula_c_thresholds` jelenleg HU-kalibrált: **S≥6, A≥5, B≥4, C≥3, D≥2**. A `podiverzum_rank` viszont a HU korpuszon nem folytonos 0–10 skála, hanem csak **7 diszkrét egész érték (3,4,5,6,8,9,10)**, így a küszöbök gyakorlatilag egy 1‑az‑1 leképezést adnak:

| podiverzum_rank | rank_label | db | átlag epizód | aktív RSS | friss 30d | friss 180d |
|---:|:---:|---:|---:|---:|---:|---:|
| 10 | S | 186 | ~175 | 163 | 162 | 174 |
| 9 | S | 7 | 45 | 7 | 6 | 7 |
| 8 | S | 6 | 7 | 6 | 1 | 6 |
| 6 | S | 117 | 68 | 115 | 96 | 106 |
| 5 | A | 155 | 32 | 151 | 46 | 74 |
| 4 | B | 326 | 9 | 313 | 79 | 130 |
| 3 | C | 38 | 5 | 36 | 4 | 8 |

Aggregát:
- **S: 281 (34%)**, A: 155 (19%), B: 326 (39%), C: 38 (5%), D/E: 0, null: 30
- S+A = 436 podcast (53%) — ez az a halmaz, amit a főoldali MV-k, evergreen, sitemap, AI sprintek és a kereső ranking is „minőségi" jelzésként használ.

## Problémák

1. **Inflált S-tier.** 281 podcast jelölése „S" devalválja a címkét. Külön gond, hogy a `podiverzum_rank=6` és `podiverzum_rank=8` is S-be esik, pedig a 8-asok közül csak 1/6 friss 30 napon belül — ezek valójában B/A jellegű shows-ok.
2. **Felesleges A↔B ugrás csak +1 raw ponton.** A=5 → 32 átlagos epizód, frissességi ráta ~30%. B=4 → 9 epizód, ~24% friss. A különbség nem indokolja a kétszintű kategorizálást a jelenlegi corpusban.
3. **C alig létezik (38 db) és D/E üres.** A ladder alsó fele nem dolgozik, miközben az adminban duplikálva van a B (326).
4. **Nincs frissességi gate a tierbe.** Egy 5 éves S-szintű podcast ugyanúgy bekerül a homepage trending feedbe (csak az epizód-szintű 30 napos filter szűr, de a podcast tiering nem). Eredmény: dead-but-S shows előnyt élveznek a sitemapban és az AI prioritásokban.
5. **Az S-tier a refresh intervalt is vezérli (S=30p).** 281 podcastot percenként polling-olunk az RSS-en — sok közöttük inaktív.

## Cél

Olyan küszöbök, ahol a HU korpusban:
- **S ≈ top 10–12%** (csak igazán friss, mély katalógusú, aktív RSS-szel rendelkező shows)
- **A ≈ 15–20%** (rendszeresen aktív, közepes katalógus)
- **B ≈ 30–35%** (működik, de ritka vagy szegényesebb)
- **C/D ≈ a maradék** (alvó / kis volumen / nem fontos)

Ez kb. **S≤100, A≈140–160, B≈280–320, C+D≈170–250** célzott eloszlást ad.

## Két lépcsős megoldás

### 1. lépcső — küszöbök szigorítása (azonnali, alacsony kockázatú)

Új `formula_c_thresholds` HU-ra: **S=8, A=5, B=4, C=3, D=2**.

Eredmény az aktuális rangokon:
- S: 178+7+6 = **191** (rank≥8, 23%) — még mindig magas
- A: **117** (rank=6, 14%)
- (átsorolt) A: + rank=5 → ahhoz hogy A=5 maradjon, a B-t mozgatni kell
- B: **326** (rank=4, 39%)
- C: **38** (rank=3)

Ez önmagában csökkenti az S-t 34→23%-ra, és levesz egy refresh-load adag terhelést.

### 2. lépcső — frissességi gate az S/A-ra (cél: valódi „top tier")

A küszöb mellé egy másodlagos szűrő, ami csak a `rank_label` címkét húzza vissza, a `podiverzum_rank` raw értéket nem módosítja:

- **S marad** csak, ha (`rss_status='active'` ÉS friss 90 napon belül ÉS hydrated_episode_count ≥ 20). Egyébként → A.
- **A marad** csak, ha friss 180 napon belül. Egyébként → B.

Becsült eredmény a fenti táblából (kb.):
- S: 191 → ~150–160 (mert 180+ből ~170 friss 30d-n, és a 6 db rank=8 nagyrésze kiesik)
- A: 117 + S→A átsoroltak ≈ 150
- B: 326 + A→B átsoroltak ≈ 360
- C: 38

Implementálás vagy a `formula-c-runner`-ben, mint új komponens (`tier_after_freshness`), vagy egy külön szakaszként a `shadow_rank_tier` után. Visszavonhatóság: a `rank_reason` JSONB-be `freshness_demotion` mezővel logoljuk az átsorolást.

## Érintett felületek (impact ellenőrzés)

- `mv_homepage_feed` — S/A vagy featured. Az S szűkítésével a feed kisebb lesz, de az evergreen MV (S only) érintettsége a fontos: ott akarjuk a szigorítást.
- `mv_homepage_evergreen` — csak S, 30–365 napos epizódok. Ez pontosan a réteg, ahol a túl bőkezű S-tier ártott.
- Sitemap — S/A podcast oldalakat tartalmaz; szigorítás után jobb minőségű URL halmaz.
- Refresh interval — S=30p, A=2h. ~80–100 podcastnyi csökkenés az S-szinten → kevesebb RSS poll.
- AI sprintek (`deep-hydrate-runner`, `seo-enrich`, `embed-podcast`) — tier-aware prioritások és napi quoták. Kevesebb S/A → gyorsabb backlog feldolgozás.
- Search ranking — `src/lib/search.ts` `tierMap` súlyok. Nem kell módosítani; csak kevesebb show kap magas súlyt.

## Tervezett lépések

1. **Dry-run riport** — egy SELECT query, ami megmutatja:
   - jelenlegi vs. javasolt rank_label eloszlás (lépcső 1 és 1+2 után)
   - melyik konkrét S-tier podcastok esnének vissza A/B-be
   - a refresh-poll terhelés várható csökkenése
   - hány homepage / evergreen / sitemap URL érintett
2. **User jóváhagyás** a dry-run alapján.
3. **Migration**: `app_settings.formula_c_thresholds` frissítése (S=8, A=5, B=4, C=3, D=2).
4. **formula-c-runner kiterjesztés** opcionálisan a 2. lépcső frissességi gate-tel (külön PR, opcionális).
5. **Tömeges relabel**: `formula-c-runner` lefuttatása minden HU podcastra (`ids=[…]` vagy `limit` ciklusban). A runner idempotens, csak `rank_label`-t és `shadow_rank_tier`-t mozgat.
6. **MV refresh** (`refresh_homepage_feed()`).
7. **Verifikáció** — riport futtatása újra, főoldal vizuális ellenőrzés, sitemap diff.
8. **Memory frissítés** a `formula-c-thresholds.md` jegyzetben.

## Nyitott kérdések a usernek

1. Csak az **1. lépcsőt** futtassuk most (csak threshold), és a frissességi gate-et külön körben? Vagy egyszerre mindkettő?
2. Az S-tier célaránya **~10–12%** (kb. 90–100 podcast) megfelelő? Vagy szigorúbb (top 5%, ~40) / lazább (top 15%, ~125)?
3. A frissességi „S-megtartás" küszöbe **90 nap** és **20 epizód** elfogadható? (Alternatíva: 60 nap / 30 epizód, vagy 120 nap / 10 epizód.)
4. Mi legyen az A-megtartás frissességi limitje — **180 nap** vagy szigorúbb (90 nap)?
