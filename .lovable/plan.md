## Diagnózis — mit találtam

Három külön ember létezik az adatbázisban, és tartalmilag **nem keverednek** (a `person_episode_mentions` jól szét van válogatva):

| Név | Slug | Gated ep. | Megemlítések | Publikus |
|---|---|---|---|---|
| Magyar Péter | magyar-peter | **3** | 191 | igen |
| Magyari Péter | magyari-peter | 14 | 14 | igen |
| Magyary Péter | magyary-peter | 1 | 1 | nem |
| **Péter Magyar** (duplikátum, fordított sorrend) | peter-magyar | 0 | – | nem |

A keveredés érzése három valódi problémából jön:

1. **Magyar Péter „üresnek” látszik (3 gated ep., 191 valós mention helyett).**
   Minden mention `relevance_status = 'pending'` — a `recompute_person_gated_counts` szigorúan csak az `accepted` / magas confidence-ű mentionöket számolja, így a politikus mentionjei lényegében nem számítanak bele. Magyari Péter (14 ep., mint Partizán/HetiVálasz visszatérő vendég) `guest` típusú mentionöket kap 0.8–0.9 confidence-szel → bekerül. Vizuálisan Magyari néz ki „a komolyabb" oldalnak.

2. **Autocomplete prefix-illesztés**: a `search-autocomplete` `normalized_name.ilike.magyar%`-ot futtat, ami **mindkét nevet visszahozza**, és `gated_episode_count DESC` szerint rendez → Magyari Péter (14) Magyar Péter (3) elé kerül. Tipikus „miért jön elsőként a hasonló nevű ember?".

3. **`Péter Magyar` duplikátum**: ugyanaz az ember, fordított (nyugati) sorrendben felvéve. Nem publikus, de zaj — alias-ként kéne csatolni a kanonikus `magyar-peter` rekordhoz.

Nincs viszont keveredés a `person_episode_mentions`-ben — minden „Magyari Péter" mention valóban Magyari Péter. A `person_aliases` is tiszta.

---

## Javasolt javítás (4 lépés, csak ezt a 3 névcsoportot érinti, biztonsági korlátokkal)

### 1. Duplikátum-egyesítés: `Péter Magyar` → `Magyar Péter`
Migrációval:
- `person_aliases`: `('Péter Magyar', 'peter magyar', confidence=0.9, source='manual_merge')` a `magyar-peter` `person_id` alá.
- Bármilyen `person_episode_mentions` / `person_podcast_map` átkapcsolása a `peter-magyar` → `magyar-peter` id-re (jelenleg 0 sor, de defenzív UPSERT-tel).
- `peter-magyar` személy törlése (vagy `identity_status='merged_into'` + `is_public=false`).

### 2. Disambiguation label a 3 megmaradt embernél
Hogy a UI/autocomplete soha ne keverhesse őket szemre:
- `Magyar Péter` → `disambiguation_label = 'politikus, Tisza Párt'`
- `Magyari Péter` → `disambiguation_label = 'újságíró, Partizán/HetiVálasz'`
- `Magyary Péter` → marad nem-publikus

A `SiteHeader` autocomplete és a `PeopleHub` már most jelenít meg `disambiguation_label`-t, ha van — semantikai változás nem kell.

### 3. Autocomplete súlyozás javítása (`search-autocomplete/index.ts`)
A jelenlegi rendezés tisztán `gated_episode_count DESC` → a több-epizódos hasonló nevű ember előrekerül. Két finomítás, csak ebben az egy fájlban:
- **Exact-match bónusz**: ha `normalized_name === normalized_query`, kapjon konstans `+1000` súlyt a rendezésben (egyébként marad `gated_episode_count`).
- **Túl rövid prefix levágás**: ha a query rövidebb mint a kanonikus név első tokenje + 1 karakter (pl. „magyar" 6 char ≤ „magyari" 7 char), akkor **nem prefix-bónusz**, hanem visszaesik trigram-szerű hasonlóságra → így „magyar péter" lekérdezés Magyari Pétert nem promotálja a Magyar Péter elé.

Konkrétan: új `score = (exactName ? 1000 : 0) + (startsWith ? 100 : 0) + gated_episode_count` és ezzel rendezünk a `gated_episode_count` helyett.

### 4. (Opcionális) Magyar Péter mention gating újraszámolása
A 191 `pending` mention nagy része valós host/guest/topic. Ezeket nem most-most kell elfogadni, de érdemes egy célzott `topic-judge-runner` / `person-relevance-judge` futás csak erre az 1 person_id-ra, hogy a gated_episode_count 3-ról reálisabb (~30–80) értékre álljon. **Ez külön döntés** — a vizuális keveredést a 1–3. pont önmagában megoldja.

---

## Mit NEM csinálunk
- Nem mergeljük Magyari ↔ Magyar Péter mentionjeit (különböző emberek, audit megerősítette).
- Nem nyúlunk a `topEntitiesFrom` / általános alias-feloldóhoz (törékeny, korábban elvetett).
- Nem futtatunk globális name-disambiguation backfillt — csak ezt a 3 névcsoportot.

## Érintett fájlok
- `supabase/migrations/<new>.sql` — Péter Magyar merge + disambiguation labels.
- `supabase/functions/search-autocomplete/index.ts` — pontozási logika.

## Elfogadási kritériumok
- Autocomplete „Magyar Péter" → Magyar Péter (politikus) az 1. találat.
- Autocomplete „Magyari" → Magyari Péter az 1. találat (változatlan).
- `Péter Magyar` slug → 404 vagy redirect `/szemelyek/magyar-peter`-re.
- A 3 publikus személy oldalán látszik a disambiguation label.
- 4. pont (gated count újraszámolás) csak explicit jóváhagyásra fut.

Mehet? Vagy a 4. pontot is csináljam egyben?