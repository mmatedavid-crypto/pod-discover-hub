
# v13 kereső port a remix → podiverzum.hu

## Cél

A `Podiverzum` remix (`566ed77a-…`) v13 keresőmotorja 1:1-ben átkerül ide. A felhasználó által tapasztalt zaj („Zsiday Viktor" → Orbán-találatok, ASTS → asztrológia, ködös találatok ritka neveknél) ezzel rendszerszinten megszűnik.

## Mit kapunk meg

1. **MUST gate** ritka tokenekre + entitásokra (IDF-alapú)
2. **3-pass MUST relaxálás** + **entity pyramid fallback** ticker/person/company esetekre
3. **Spell correction** (pg_trgm) ismeretlen szavakra
4. **HyDE** (hipotetikus dokumentum embedding) topical/question intentre
5. **Cohere rerank v3.5** (cross-encoder, $2/nap budget, ~150 ms)
6. **Entity resolver** (entity_profiles + topic_hubs trgm match)
7. **Stopword + gibberish gate** (azonnali bail értelmetlen lekérdezésre)
8. **Freshness decay** news/ticker intentre
9. **Bigram MUST** person/company query többszavas entitásra
10. **MMR diversity** (egy podcast max 2 a top-10-ben)
11. **Engine version flag** (`engine=v8…v13` query paramen visszafelé tesztelhető)
12. **Cirkuit breaker** AI-hívásokra (60 s cooldown 3 hiba után)
13. **Chunk-level passage recall** (v13) — *opcionális, lásd lent*

## Műveleti sorrend

### 1. fázis — DB migrációk (egy nagy migráció)

| Objektum | Típus | Megjegyzés |
|---|---|---|
| `search_episodes_hybrid(...)` | RPC csere | Új szignatúra: `required_terms`, `entity_terms`, `alpha_lex`, `p_decay_lambda`, `phrase_terms` |
| `token_df_cache` | TÁBLA | Lazy IDF cache |
| `token_idf(p_tokens text[])` | RPC | Visszaadja a tokenek df-jét, 7d cache |
| `suggest_token_corrections(p_tokens text[])` | RPC | trgm spell-correction df ≥ 50, sim ≥ 0.6 |
| `entity_profiles` | TÁBLA | Kanonikus entitások (kind/slug/display_name) |
| `topic_hubs` | TÁBLA | Curated topic hubs aliases tömbbel — HU-specifikus seedet külön kell töltenünk, EN seedet kihagyjuk |
| `resolve_query_entities(p_q, p_max, p_threshold)` | RPC | trgm fuzzy entitás resolver |
| `search_hyde_cache` | TÁBLA | HyDE szöveg + embedding 7d cache |
| `match_podcast_by_name(p_q, p_max, p_threshold)` | RPC | Navigációs pin („Joe Rogan" → adott podcast epizódjai) |

Mindegyikre **RLS**: public read + admin write.

A `search_episodes_hybrid` régi szignatúra `DROP`-olva, az új SQL-jét a remix `20260515154936` migrációjából vesszük át (chunk-augmentáció nélkül, lásd 4. fázis).

### 2. fázis — Shared edge function modulok

Új fájlok másolása a remixből:
- `supabase/functions/_shared/search-understand.ts` (ticker prompt + cirkuit breaker)
- `supabase/functions/_shared/search-hyde.ts` (új)
- `supabase/functions/_shared/cohere-rerank.ts` (új)

### 3. fázis — `search-hybrid` edge function átírás

Az 1148 soros remix-verzió portolása. Egy magyar-specifikus változtatás kell:
- a `lang` default már most `null`/`"hu"` a hívóknál → nincs change kliensen, de a runtime `lang` paramétert a remix `"en"`-re defaultolja: ez **`"hu"`-ra állítjuk**, hogy a HU-only site továbbra is HU találatokat adjon.
- `RARE_GATE_STOPWORDS` listához hozzáfűzünk minimum magyar töltelékszavakat (a, az, és, vagy, de, hogy, mert, ez, az, egy, van, volt, lesz, csak, már, még, most, podcast, epizód, műsor, beszélgetés).

### 4. fázis — Mit hagyunk ki *most*

- **Chunk augmentation (v13)**: hiányzik az `episode_chunks` tábla + `search_episode_chunks` RPC + transcript-chunking pipeline. Engineflag-en `chunkAugment: false` lesz (default `engine=v12`). Külön sprintet érdemel — az STT pilot futása után térünk vissza rá.
- **`topic_hubs` seed**: az angol seedek (GLP-1 stb.) nem relevánsak HU-ra. Üres táblát hozunk létre; külön feladat a magyar hubok feltöltése.

### 5. fázis — Titok

`COHERE_API_KEY` hozzáadása. Cohere `rerank-v3.5` $2/1000 hívás; napi $2 budget a kódban beégetve, app_settings.`cohere_rerank_daily_spent` jsonb tartja a fogyást.

### 6. fázis — Smoke teszt + élesítés

`supabase--curl_edge_functions` POST `/search-hybrid` 6 lekérdezésre:
- `"Zsiday Viktor"` → várjuk Concorde / Zsiday epizódok top-3
- `"ASTS"` → ticker gate, AST SpaceMobile fallback
- `"asdfghjkl"` → nonsense_gate true, 0 epizód
- `"a"` → stopword_gate true
- `"Bertalan Tóth Putyin"` → konkrét személy + esemény
- `"makrogazdaság"` → tág topical, HyDE aktív

Cohere és HyDE telemetria a response JSON-ban; logolva az `edge_function_logs`-ban.

## Kockázat & visszafordíthatóság

- A régi `search_episodes_hybrid` szignatúra **eltűnik** → ha valami más edge fn hívja (search-suggest, search-answer), az hibás lesz. Ellenőrzés a portolás közben; ha igen, azt is frissítjük az új szignatúrára vagy default-okkal kompatibilissé tesszük.
- Az `engine=v8` paraméter visszaad egy egyszerűbb futtatást, így gyors A/B tesztre van fallback.
- Migráció reverzibilis: a régi RPC SQL-jét megőrzöm jegyzetben (csak az új lép működésbe).

## Becsült terjedelem

- 1 migrációs SQL (~600 sor)
- 3 shared TS fájl (~300 sor összesen)
- 1 átírt edge fn (~1150 sor)
- 1 titok-kérés

## Mit kérek tőled jóváhagyásra

1. Indulhatunk a migrációval (1. fázis)?
2. Most kérjem be a `COHERE_API_KEY`-t, vagy intézed külön?
3. A `chunk augmentation` későbbi sprintbe halasztása oké?

A jóváhagyás után indítom a migrációt, majd folyamatosan jelzem a fázisok végét.
