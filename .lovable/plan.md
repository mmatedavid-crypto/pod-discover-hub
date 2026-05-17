## Cél

Minden epizód **teljes érdemi szöveges tartalma** kerüljön be a vektor-indexbe, ne csak az első 1600 karakter. Hosszú description / ai_summary esetén egy epizódhoz **több vektor** tartozzon (egyenként ~2500 karakter), és előtte egy **intelligens szűrő** dobja ki a reklám / sponsor / repetitív outró / link-szemét részeket. STT és YouTube transcript pipeline addig **szünetel**.

## Jelenlegi helyzet (mérve)

- 60 847 HU S/A/B/C epizód.
- `description` upstream **4000 karakterre van vágva** (deep-hydrate vagy RSS parse) — ez egy másik bottleneck, amit a tervben szintén kezelünk.
- 84% description ≤1600 char → 1 chunk marad.
- 15% (~9 500 epizód) 1600–4000 char → 2 chunk.
- 0% >4000 char (truncated upstream — ezért nem látjuk a tényleg hosszú leírásokat).
- p50: 488 char, p90: 2148 char, p99: 3237 char, max: 4000 char.

Tehát a chunkolás önmagában csak ~9 500 extra vektort jelent. **De ha a 4000-es felső plafont felemeljük 12 000 karakterre, várhatóan jóval több epizódnál lesz 2–4 chunk** (sok podcast description natívan 6–15k char).

## Chunkolási stratégia

- **Chunk méret: 2500 karakter** (user javaslat — elfogadom; Gemini embedding-001 kontextusába bőven belefér, ~600–800 token / chunk, szemantikailag elég nagy egy bekezdés-csoport-szintű reprezentációhoz).
- **Overlap: 250 karakter** (10%) — szóhatáron törve. Ez segít a query-knél, ahol a kulcsszó pont a chunk-határra esne.
- **Forrás-szöveg összerakás priority order:**
  1. `display_title` / `title`
  2. `ai_summary` (max 1500 char — ezt nem chunkoljuk, mindegyik chunk elejére prepend)
  3. **Cleaned description** (a szűrő után, lásd lent — ezt chunkoljuk)
  4. `topics`, `people`, `companies`, `tickers` listák (mindegyik chunk elejére prepend, kompakt formában)
- Tehát minden chunk struktúrája: `[TITLE + AI_SUMMARY + ENTITIES közös prefix] + [CLEANED_DESCRIPTION i-edik szelete]`. Prefix max ~800 char.
- **1 chunk minimum mindig**: ha cleaned description üres vagy nagyon rövid, az 1 chunk a prefix + amennyi van.

## Intelligens szűrő (cleaner)

Két lépcső, hash-cached:

**1. Heurisztikus pre-clean** (deterministic, ingyenes, helyben fut a runnerben):
- URL-ek tömeges levágása (több mint 5 link soronként → eltávolít).
- Időbélyeg-listák (pl. `00:12:34 Topic name`) eltávolítása, ha 4-nél több ilyen sor van egymás után.
- Ismétlődő boilerplate detektálás: ha az adott podcast utolsó 20 epizódjában ugyanaz a 200+ karakteres blokk megjelenik ≥10×, betesszük egy `podcast_boilerplate_blocks` cache-be és kiszedjük. Egyszer/podcast/nap fut.
- HTML maradványok, ismétlődő whitespace, "Subscribe to / Follow us on / Patreon" sablon-mondatok kis fix lista alapján.

**2. AI clean (Gemini Flash-Lite)** — csak ha az 1. lépés után még mindig >2500 char és/vagy magas link/sablon-arány:
- Egy hívás / epizód, ~$0.0003.
- Prompt: "Return the substantive editorial content only. Remove: sponsor reads, ad copy, repeated podcast intro/outro, link lists, calls to action, social media plugs. Keep: topic discussion, names mentioned, factual claims, guest bios."
- Tool-output JSON: `{ cleaned_text: string, removed_categories: string[] }`.
- Hash-elt cache: új `episode_clean_text` tábla, `episode_id PK, source_hash, cleaned_text, removed_categories, model, cost_usd, created_at`. Ha a source `description` hash változatlan, nem hívjuk újra.

Ha **AI clean limit** kimerül (napi budget) vagy hibázik → fallback az 1. lépés outputjára. Egyik sem dob el adatot teljesen.

## DB séma változások

**Új tábla: `episode_chunks`**
```
episode_id    uuid     not null
podcast_id    uuid     not null
chunk_idx     int      not null         -- 0..N
chunk_count   int      not null         -- total for episode
content       text     not null         -- final embedded text
content_hash  text     not null
char_start    int      not null
char_end      int      not null
model         text     not null
embedding     vector(768) not null
updated_at    timestamptz not null default now()
PRIMARY KEY (episode_id, chunk_idx)
```
+ HNSW cosine index az `embedding`-en, btree index `(podcast_id)`-on.
RLS: ugyanúgy mint `episode_embeddings` (admin write, public read).

**Új tábla: `episode_clean_text`**
```
episode_id          uuid PK
source_hash         text not null     -- hash(description)
cleaned_text        text not null
removed_categories  text[] default '{}'
cleaner_method      text not null     -- 'heuristic' | 'ai' | 'ai+heuristic'
model               text
cost_usd            numeric
created_at          timestamptz default now()
updated_at          timestamptz default now()
```

**Új tábla: `podcast_boilerplate_blocks`**
```
podcast_id   uuid not null
block_hash   text not null
block_text   text not null
hit_count    int not null default 0
detected_at  timestamptz default now()
PRIMARY KEY (podcast_id, block_hash)
```

**`episode_embeddings` sorsa:** marad legacy-ként; **NEM töröljük**, de az új keresés a `episode_chunks`-ot használja. Egy migration step átmásolja a meglévő 60k egy-vektoros sorokat `episode_chunks (chunk_idx=0, chunk_count=1)` formátumban, hogy a search RPC napon belül átállhasson. A régi tábla marad fallbacknek 1–2 hétig.

**Upstream truncation feloldása:** `deep-hydrate-runner`-ben (ahol a description ≤4000-re vágódik) emeljük 12 000 karakterre. Külön egysoros patch, együtt a többi változással. Ez sok új tartalmat hoz be — épp ezért szükséges a clean pipeline ELŐSZÖR készen legyen, különben a 12k karakteres rss-szemét közvetlenül a vektorba menne.

## Új runner: `embed-episode-chunks-runner`

A meglévő `embed-episode-runner` mellé (vagy helyette — lásd lent) új edge function:

1. `select_embed_chunks_candidates(_model, _limit)` RPC: olyan epizódok, ahol vagy nincs `episode_chunks` sor a `_model`-re, VAGY a max(content_hash) eltér a most számolttól (description / ai_summary változott).
2. Drain loop, 55s budget, concurrency 6, batch 30 epizód.
3. Minden epizódra:
   a. `episode_clean_text` lookup hash alapján; ha hit → cleaned_text; ha miss → heurisztika; ha még mindig "piszkos" → AI clean; cache-elés.
   b. Chunkolás 2500 char + 250 overlap, szóhatár-tisztelet.
   c. Minden chunkra prefix + chunk_text összeállítása, hash.
   d. Gemini embedding hívás (a meglévő `embed()` helper).
   e. `episode_chunks` upsert; régi `episode_embeddings` sor opcionálisan frissítve a chunk_0 vektorral (átmeneti kompat).
4. Spend könyvelés: `ai_spend_daily.by_kind.embed_episode_chunks_usd` + `embed_episode_clean_usd` külön.
5. Adaptive cron RPC `set_embed_episode_chunks_schedule(pending)`, ugyanaz a logika mint `set_embed_episode_schedule`.

**`embed-episode-runner` sorsa:** 1–2 hétig párhuzamosan fut (új epizódok azonnal kapnak legacy 1-vektoros embeddinget is); aztán kivezetjük.

## Controls (új kulcsok app_settings-ben)

```
embed_episode_chunks_controls = {
  enabled: true,
  model: 'google/gemini-embedding-001',
  daily_budget_usd: 3.0,
  batch_size: 30,
  concurrency: 6,
  chunk_chars: 2500,
  chunk_overlap: 250,
  tiers: ['S','A','B','C']
}

episode_text_cleaner_controls = {
  enabled: true,
  ai_enabled: true,
  ai_model: 'google/gemini-3.1-flash-lite-preview',
  daily_budget_usd: 2.0,
  min_chars_for_ai: 2500,
  always_heuristic: true
}
```

Költségbecslés: ~65k epizód × 1.2 chunk átlag × ~700 token = ~55M token × $0.000025/1k = **~$1.4 egyszeri**. AI clean ~10k epizódra × $0.0003 = **~$3 egyszeri**. Folyamatos napi költség: <$0.20.

## Search RPC frissítés

`search_episodes_hybrid` jelenleg `episode_embeddings`-ből vesz. Új verzió `episode_chunks`-ból válogat, és **epizódonként a max-similarity chunkot veszi** (`SELECT DISTINCT ON (episode_id) ... ORDER BY episode_id, sim DESC`). Az FTS (`search_tsv`) változatlan. Cohere rerank input nem változik (mindig egész epizód-record szintű).

Ezt **csak akkor kapcsoljuk át**, amikor az `episode_chunks` tábla legalább 95%-ban tele van.

## STT és YouTube transcript pipeline — szüneteltetés

A user kérése szerint amíg ez nem készül el:
- `stt-runner-pilot` (cron jobid 22) → disable
- `stt-enqueue-pilot` (cron jobid 23) → disable
- `youtube-transcript-fetch` (cron jobid 21) → disable
- `youtube-channel-scout` (jobid 19), `youtube-episode-pairer` (jobid 20) → **maradnak** (csak pairing metaadat, olcsó, nem érint embeddinget).
- A meglévő 193 transcript marad érintetlenül; a transcript-grounded ai_summary regenerálás (`ai_summary_source` mező) szintén szünetel.
- Kill switch: a 3 érintett cron `active=false` állapotba, NEM töröljük. Visszakapcsoláshoz egy SQL UPDATE elég.

## Implementációs sorrend (rollout)

1. **DB migration**: 3 új tábla + indexek + RLS. (`supabase--migration`)
2. **Stop crons**: STT + YT transcript cronok deaktiválása. (`supabase--insert`)
3. **Cleaner edge fn helper**: `_shared/episode-text-cleaner.ts` — heurisztika + AI fallback + cache.
4. **Új runner**: `embed-episode-chunks-runner` edge fn + új RPC (`select_embed_chunks_candidates`, `embed_chunks_candidate_stats`, `set_embed_episode_chunks_schedule`).
5. **Backfill**: meglévő 60k `episode_embeddings` sort átmásoljuk `episode_chunks(chunk_idx=0)`-ba migration scriptben.
6. **Cron schedule** (jobid 25): `*/15` baseline, adaptive.
7. **Upstream truncation feloldás**: `deep-hydrate-runner`-ben description limit 4000 → 12000.
8. **Drain figyelése** 24–48 óra. Cleaner kimenetek minőségi spot-check (10 random epizód handmade review).
9. **Search RPC átállítás** `episode_chunks`-ra (külön loop-ban).
10. **Legacy `embed-episode-runner` kivezetése** (1–2 hét múlva).

## Mit NEM csinálunk most

- Transcript-grounded chunk-embedding (ezt visszatesszük post-completion).
- Külön podcast-szintű reprezentáció chunkokból (marad a `podcast_embeddings`).
- Reranking-súlyozás chunk-számmal (nem akarjuk a hosszú epizódokat torzítani).
- Multilingual cleaner — most HU + EN ugyanazzal a prompttal megy, a Flash-Lite mindkettőt elviszi.

## Várt hatás

- A 9 500 jelenleg ≥1600 char description-ű epizód teljes szöveges tartalma indexelve.
- A 4000-es upstream plafon feloldása után várhatóan további ~10–15k epizód kap értelmes 2–4 chunkot (becslés a 4000-en "leragadt" eloszlás farkából).
- Search recall érzékelhetően javul long-tail és idézet-szerű query-knél.
- A reklám-szűrés miatt a precision is javul: a "Patreon Subscribe Follow" típusú zaj nem dominálja a kis epizódok embeddingjét.
- Költség elhanyagolható (<$5 egyszeri, <$0.50/nap folyamatos).
