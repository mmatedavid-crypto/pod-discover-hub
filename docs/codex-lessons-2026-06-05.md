# Codex feedback — 2026-06-05

Két frissen leszállított munkára vonatkozó konkrét tanulság. Mindkettő működik,
de a hatása ~0, mert az alapfeltevés rossz volt. Ezeket olvasd el, mielőtt
hasonló típusú feladatot csinálsz.

---

## 1. `episode-article-pairer` — outlet pre-filter túl tág volt

### Mit csináltál
A `app_settings.episode_article_pairer_controls.sources[]` minden outlethez
`podcast_title_patterns` listát kapott. A pairer ILIKE pre-filterrel csak azokat
az epizódokat scoring-olja a cikk ellen, amelyek podcast-title-je matchel egy
mintára. Eddig jó.

A **mintalisták viszont általános tématerület-szavakat** tartalmaztak:

| Outlet | Hibás minta | Mit szivárogtatott |
|---|---|---|
| HVG | `tech`, `tudomány`, `gazdaság`, `közélet` | Hifibogár, TechCrunch (CoinColors), NEWtechtalk, Techműsor, Balfül |
| Portfolio | `forint`, `tőzsde`, `biznisz` | bármely gazdasági podcast |
| Hold | `befektetés`, `after hours`, `hold` (önmagában) | bármely pénzügyi podcast, Hold a tenyeremben, stb. |
| Telex | `téma`, `after`, `nyomozó` | sok kvíz/krimi műsor |

A user szabálya világos: **HVG cikk csak HVG-saját podcasthez kerülhet,
444 csak 444-hez.** A `tech` szóra HVG-cikket ráereszteni TechCrunch-ra
durva minőség-szennyezés.

### A javítás (`brand_anchor_v2_20260605`)
A minta lista csak **brand-anchor + ismert műsornév** lehet:

```jsonc
{ "outlet": "hvg", "podcast_title_patterns": ["hvg", "fülke"] }
{ "outlet": "444", "podcast_title_patterns": ["444", "borízű", "tyúkól", "saját tőke", "háromharmad"] }
{ "outlet": "portfolio", "podcast_title_patterns": ["portfolio", "portfolio checklist"] }
{ "outlet": "hold", "podcast_title_patterns": ["hold after hours", "holdblog"] }
{ "outlet": "telex", "podcast_title_patterns": ["telex", "after money", "ízfokozó", "nyomozó podcast", "telex filmklub"] }
{ "outlet": "partizan", "podcast_title_patterns": ["partizán", "partizan"] }
{ "outlet": "qubit", "podcast_title_patterns": ["qubit"] }
```

Plusz töröltük a már bekerült, ilyen okból téves `needs_review`
candidate-eket (confirmed-eket nem nyúltunk, mert azokat manuálisan
ellenőriztük).

### Tanulság
**A scope-szűrés a kiadó brand-jén alapul, nem témakörön.** Általános témaszót
soha ne tegyél outlet-mintába; a tartalmi egyezést a scoring (cím-token
overlap + dátum) bírálja el — az a feladata, nem a pre-filter dolga
tématerületet matchelni.

---

## 2. `canonical_entity_aliases` — registry seedelve, de nem javít semmit

### Mit csináltál
`canonical_entity_aliases` tábla + `normalize_entity_alias()` +
`resolve_canonical_entity_alias()` + policy. 206 seed (94 topic + 112 org).
A `person-entity-extractor` és `entity-backfill-runner` előre tekintve
használja: új extraction normalizálódik canonical formára.

### A baj (dry-run riport)
Az új `canonical_alias_backfill_dryrun()` futtatva:

| Entity | Total | Renamed | Collisions |
|---|---|---|---|
| person | 3591 | **0** | 0 |
| organization | 42197 | **0** | 17 |
| topic | 93 | **0** | 0 |

Egyetlen sort sem nevezne át a meglévő állományban. **A 206 seed
gyakorlatilag passzthrough volt** — a canonical_name értékek
azonosak voltak a már a `people`/`organizations`/`topics` táblákban
szereplő `name` értékekkel, mert a seedet a piszkos állapotból generálta.

Tehát:
- ✅ Új mention érkezésekor a registry használ (előre).
- ❌ A meglévő 2604 person / 21k org / 79 topic nem javul semennyit.

A 17 org-collision viszont **valódi duplikátum-pár** (lásd
`/mnt/documents/canonical_alias_org_merge_candidates.csv`), pl. 5 különböző
Fradi-sor (FTC, Ferencvárosi TC, fradi.hu, FTC-Telekom, Ferencvárosi Torna
Club) → mind `Ferencvárosi Torna Klub`-ra mergelendő. Ezt nem futtatjuk
automatikusan, mert FK-cascade kockázat (`episode_organization_map`).

### Tanulság
**Egy normalizáló registry értelme, hogy a piszkos variánsokat a tiszta
canonical-ra képezi.** Ha a seedet kizárólag a meglévő `name` értékekből
csinálod, a registry önmagával egyenlő → 0 javulás.

Helyes seedelés:
1. Először derítsd fel a valódi variánsokat (pl. „FTC" / „Fradi" /
   „Ferencvárosi TC" / „fradi.hu" mind ugyanaz).
2. Tedd be őket `alias` mezőként, **a canonical pedig a célzott**
   tiszta név (pl. `Ferencvárosi Torna Klub`).
3. Akkor a backfill apply renamelni fog, és a forward extraction is
   normalizálódik.

A jelenlegi 206 seed-ből kb. 100+ entry tartalmaz alias≠canonical párokat
(pl. `kormány` → `Magyarország Kormánya`, `EU` → `Európai Unió`), de
ezekből egyik sem szerepel `people.name`/`organizations.name` cellában —
mert ott már a canonical forma van. A registry jövőbeli mention-ökre
hasznos, de a backfill-narratíva, hogy „rendet csinál a meglévő
állományban", **nem teljesült**.

### Mit kell még megcsinálnod
1. **Bővítsd a registry-t valódi sérült variánsokkal**, amelyek
   ténylegesen előfordulnak a `people.name` / `organizations.name`
   mezőkben. Sample query a kandidátusokhoz:

   ```sql
   -- "Gyanús" org variánsok: rövidítések, pontatlan formák
   SELECT name, slug
   FROM organizations
   WHERE length(name) <= 6 OR name ~ '\\.(hu|com|net)$'
   ORDER BY name;
   ```
2. **Tervezz egy biztonságos org-merge eljárást** (`merge_organizations(src_id, dst_id)`
   ami áthúzza az `episode_organization_map` rekordokat ON CONFLICT DO NOTHING,
   majd törli a forrást) — a 17 ismert duplikátum megoldásához.
3. Documents/`canonical_alias_org_merge_candidates.csv` az első 17 célpont.

---

## Általános minta, amit jegyezzünk meg

Ha egy „rendrakó" eszközt szállítasz (article scope, alias normalizer, dedup),
**a végén kötelező lefuttatni egy mérést, ami megmondja, mennyit javított a
meglévő állományon.** Nem elég, hogy a kód jó és a unit-tesztek zöldek.

- Az article pairer-nél ez lett volna: „a confirmed candidate-ek közül hány
  esik HVG-cikk → HVG-podcast párba a teljes listán" — az árulta volna el
  a `tech`-szivárgást.
- A canonical alias-nál ez lett volna: „hány `people.name` / `organizations.name`
  változna meg a resolveren keresztül" — az árulta volna el, hogy
  a seedek passzthrough-k.

A `canonical_alias_backfill_dryrun()` és a watchdog/verifier gate-ek
pontosan ilyen méréseket adnak. **Új feltérképező/normalizáló munkához
kötelező legyen egy dry-run / méri-e-a-hatást funkció a deploy előtt.**
