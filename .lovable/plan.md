## Cél

1. **Töröljük** az 56 nem-magyar podcastet és minden hozzájuk tartozó származékot a DB-ből.
2. **Bezárjuk a szivárgást** az `ai-feed-scout`-ban, ami miatt egyáltalán bekerültek — a `language='hu'`-ként stamp-elte őket akkor is, ha valójában spanyol/angol/kínai stb.

## Mi a hiba (root cause)

`ai-feed-scout/index.ts:540`:
```
language: normLang(v.feed.language) || v.lang_hint,
```
Ha a Podcast Index nem ad nyelvet, vagy Tier 1-ben közvetlen RSS URL-t talált (ahol sosem ellenőrizzük a `<language>` tag-et), akkor a forrás oldal `lang_hint`-jét (`"hu"`) sütjük be. Ezután a `pi-dump-process` látja, hogy `language='hu'`, és nyugodtan importálja — pedig a feed valójában spanyol.

Tier 2 fallback (`piSearch` lang nélkül) szintén beengedi a feedet, ha PI nem ad vissza nyelvet (`piLang` falsy → if-ág kihagyva).

Tier 3 (iTunes HU storefront) ugyanígy — egyáltalán nem nézi a tényleges feed nyelvét.

## Lépések

### 1) Adattisztítás (egy migration)

Nyelv szerinti bontás: 36 en, 9 zh, 5 es, 2 fr, 1 nl/de/pt + 1 `und=` → összesen **56 podcast, ~1850 epizód**.

Egy `DELETE FROM podcasts WHERE language IS NOT NULL AND language NOT ILIKE 'hu%'` — a `podcasts`-ról lefelé minden kapcsolódó sort (episodes, embeddings, transcripts, youtube_links, candidates stb.) explicit `DELETE`-ekkel törlünk, mert a táblákon nincs FK CASCADE. Sorrend:
- `episode_embeddings`, `episode_transcripts`, `episode_youtube_links` az érintett podcast_id-kra
- `episodes` az érintett podcast_id-kra
- `podcast_embeddings`, `podcast_youtube_candidates` az érintett podcast_id-kra
- végül `podcasts`

A `pi_feed_staging`-ből is töröljük azokat a sorokat, ahol a `rss_url` egyezik a most törölt podcastekével, hogy a `pi-dump-process` ne importálja vissza őket.

### 2) Scout javítás (`supabase/functions/ai-feed-scout/index.ts`)

- **NE** essünk vissza a `lang_hint`-re a staging language mezőjében. Ha nincs megbízható forrás (PI vagy RSS `<language>` tag), írjunk `NULL`-t. Ezt a `pi-dump-process` szigorúan szűri (kombinálva az AI nyelvérzékeléssel) — sokkal biztonságosabb, mint hamis HU stamp.
- **Tier 1 (rss_direct)**: a `validateRss`-ben már lehívjuk az első ~8KB-ot. Bővítsük úgy, hogy visszaadja a detektált `<language>` / `<itunes:language>` értéket is, és csak akkor fogadjuk el, ha hu-ra prefixel (vagy üres/und → akkor `NULL`-lel staging-be, majd a downstream szigorú HU szűrőre bízzuk).
- **Tier 2 (PodcastIndex)**: ha a PI-tól strict lang nélkül kérdezünk (fallback), és `piLang` kitöltött és nem `hu`, **utasítsuk el** (most: ha `piLang` falsy, beengedi).
- **Tier 3 (iTunes HU)**: az iTunes feedUrl-jét futtassuk át ugyanazon a `<language>` ellenőrzésen — ha nem HU, dobjuk el.

### 3) Védőháló a `pi-dump-process`-ban

Egy kis szigorítás: ha `r.language` üres ÉS `r.ai_detected_language` üres → ne importáljuk azonnal, hanem kérjünk AI nyelvérzékelést (a meglévő `ai-enrich` / language guard pipeline keretében), és csak utána döntsünk. Egyelőre elég: ha `r.language` nem `hu%` és nem `mul/und/null` → reject (ez most is megvan), és **a scout-stamp leállítása után** ez ténylegesen fogni fogja a nem-HU feedeket.

## Technikai jegyzetek

- A `podcasts`-on nincs `ON DELETE CASCADE`, ezért az adattisztítás migration-ben minden függő tábla rendjén DELETE.
- Az `und=` (1 db) törölhető — szemét érték.
- A 36 angol podcast között sok lehet legacy launch előtti rang-emelt adat — a user megerősítette: töröljük.
- A scout módosítása után csökkenni fog a sikeres találati arány — ez szándékos, inkább kevesebb HU mint sok spanyol szemét.

## Mit NEM csinálunk most

- Nem nyúlunk a `seo-enrich-runner` AI language guard logikájához (jól működik).
- Nem módosítjuk a frontend HU filtereket (már szigorúak).
- Nem futtatjuk újra a scout-ot azonnal — a user dönthet róla a tisztítás után.
