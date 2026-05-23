# "Neked válogatva" + folyamatos profil-fejlesztés

## Cél

A bejelentkezett user az `/en-podiverzumom` oldalon kap egy **„Neked válogatva"** szekciót: friss magyar epizódok, amik az ízléséhez illenek. A profilja folyamatosan élesedik a lejátszásból + like/dislike-okból — minden interakció után pár perc múlva új ajánlások jönnek.

## User flow

1. Swipe végén login → profilba bekerül archetype + a swipe pozitívokból seedelt taste-vektor.
2. `/en-podiverzumom` „Profil" tabján legfelül: **„Neked válogatva"** szekció — 12 epizód kártya, mindegyiken ❤︎ / ✕ gomb + play.
3. Lejátszás → SmartPlayer csendben rögzíti: `play_start`, `play_30s`, `play_complete`.
4. Like / dislike / play eseményekből cron 5 percenként újraszámolja a taste-vektort → frissebb találatok.
5. Mindig kizárjuk azokat, amiket a user már látott (interakció vagy dislike).

## Adatmodell (új)

### `profiles` (kiegészítés)
- `taste_vec vector(768)` — élő taste-vektor (átlag a pozitív epizód-embeddingekből, downweight a negatívokra)
- `taste_vec_updated_at timestamptz`
- `taste_signal_count int default 0` — hány interakcióból épült (UI bizalmi jelzőhöz)

### `user_episode_interactions` (új)
- `id uuid pk`, `user_id uuid not null`, `episode_id uuid not null`
- `kind text` enum: `like`, `dislike`, `play_start`, `play_30s`, `play_complete`, `skip`, `dismiss`
- `weight real not null` — like=+1.0, play_complete=+0.8, play_30s=+0.4, play_start=+0.1, skip=-0.2, dislike=-1.0
- `source text` — `recommended_feed` / `episode_page` / `player`
- `created_at timestamptz default now()`
- Unique `(user_id, episode_id, kind)` — egy adott kind csak egyszer számít
- Indexek: `(user_id, created_at desc)`, `(episode_id)`

### RLS
- `user_episode_interactions`: user csak a saját sorait látja/inserteli.
- `profiles.taste_vec` olvasás csak saját + service role.

### RPC-k
- `record_episode_interaction(p_episode_id uuid, p_kind text, p_source text)` — auth.uid()-ra, upsert + súly táblából, fail-safe.
- `match_user_episodes(p_user uuid, p_limit int, p_exclude_seen bool)` — taste_vec → episode_embeddings cosine, csak HU + Formula C tier ≥ B + freshness ≤ 90 nap, kizárja az érintett epizódokat, max 2 epizód/podcast (DISTINCT ON podcast_id partition).

## Edge functions

### `taste-recommend` (új, public, RLS-mögött JWT)
- Auth header → user id.
- Lehívja `match_user_episodes`-t, hidratálja epizód+podcast meta-t, visszaad 12-24 elemet.
- Ha `taste_signal_count < 3` → fallback: archetype.liked_topics + freshness rangsor (a meglévő `episodes.topics` mezőre).
- Cache: per-user 2 perc memory cache az edge fn-ben.

### `taste-vector-refresh` (új, service-only)
- Inputs: user_id vagy `stale` (mind, ahol új interakció van `taste_vec_updated_at` óta).
- Lépések user-enként:
  1. Pozitív epizód-embeddingek lekérése (kind ∈ like/play_complete/play_30s, weight > 0, max 50 legfrissebb).
  2. Súlyozott mean → kandidát vektor.
  3. Dislike epizódok átlagát kivonjuk 0.3 súllyal.
  4. Ha van archetype seed (kezdeti `taste_vec`), 0.2 súllyal beleblendelünk amíg `signal_count < 10`.
  5. L2-normalizálás → írás `profiles.taste_vec`.
- Cron jobid új, `*/5 * * * *`.

### `taste-seed-from-archetype` (egyszer, archetype mentés után hívva)
- Az archetype JSON-ből kiszedi a like-olt topic slug-okat → tölt 8-16 reprezentatív epizód-embedding átlagát → `profiles.taste_vec` kezdőértéke + `taste_signal_count = 0`.

## Frontend

### `SmartPlayerProvider` (player event hook)
- `play` esemény: invoke `record_episode_interaction(id, "play_start", "player")` egyszer.
- 30 mp folyamatos lejátszás után (`timeupdate` watcher): `play_30s`.
- `ended` / 90% pozíció: `play_complete`.
- Csak ha bejelentkezett user. Mindent fire-and-forget, nincs UI blokk.

### `EpisodeCard` (új like/dislike)
- ❤︎ / ✕ kis ikongombok a kártya jobb alsó sarkán (csak auth user-nek).
- Klikk → `record_episode_interaction(id, "like"|"dislike", source)` + helyi optimisztikus UI (kiszürkül a dislike-olt).

### `EnPodiverzumomPage` „Profil" tab
- Új komponens `RecommendedForYou` legfelül a tab tartalmában.
- Hívja a `taste-recommend` edge fn-t React Query-vel, 60 mp staleTime.
- 12 epizód grid, csak HU, mindegyiken ❤︎/✕/▶.
- Empty state: ha 0 talált → CTA „Még pár swipe és élesedik az ízlésed" a `/te-podiverzumod` flow-ra.
- Bizalmi jelző: „A profilod {N} interakcióból épül — minél többet hallgatsz, annál pontosabb."

## SEO & privacy

- A „Neked válogatva" szekció bejelentkezett user-nek, `noindex` (már beállítva az oldalon).
- Interakciókat soha nem küldjük 3rd party tracker-nek (nincs is).

## Technikai részletek

- **Vektor mező**: `vector(768)` — kompatibilis a meglévő `episode_embeddings` HNSW indexszel (`google/gemini-embedding-001` 768d, ami már a project default).
- **Match RPC**:
  ```sql
  -- order by taste_vec <=> embedding, DISTINCT ON (podcast_id)
  -- where podcast.language ilike 'hu%' and tier_rank in ('S','A','B')
  -- and published_at > now() - interval '90 days'
  -- and episode_id not in (interactions of this user last 60 days)
  ```
- **Súlyok táblázata** RPC-ben hardcoded, hogy egy helyen módosítható legyen.
- **Cost**: nincs új AI hívás user-enként — csak pgvector match. A `taste-vector-refresh` cron csak DB-számítás, ingyenes.
- **Throughput**: cron `*/5`, max 500 user/run, így 100 aktív user-ig nincs torlódás.

## Fázisok

**1. fázis (most, 1 menet):**
- DB migráció (profiles oszlopok + új tábla + RLS + 2 RPC)
- `taste-recommend` edge fn + cron-mentes refresh on-write (most még nem cron, csak ha user megnyitja az oldalt — ha `taste_vec_updated_at` > 5 perc régi, sync refresh)
- `EpisodeCard` ❤︎/✕ gombok
- `SmartPlayerProvider` play tracking
- `EnPodiverzumomPage` „Neked válogatva" szekció
- Archetype seedelés a meglévő `/en-podiverzumom` redirect után

**2. fázis (külön kör, ha ez beválik):**
- Külön `taste-vector-refresh` cron + jobid bejegyzés
- „Hasonló hallgatók kedvelték" szekció
- Topic/mood bontás a Profil tabon (top_topics, top_moods JSONB cache)
- Watchdog runner az új cronra

## Mit NEM csinálok meg most

- Nem nyúlok a swipe flow algoritmusához.
- Nem cserélem le a meglévő `EnPodiverzumomPage` többi szekcióját.
- Nem indítok új batch-et a 134k embeddingre — minden már megvan.
- Nem építek külön /neked route-ot.

## Jóváhagyás után

Lépésrend (egy menetben):
1. `supabase--migration` → schema + RLS + RPC-k (külön kérek jóváhagyást).
2. Edge fn `taste-recommend` + deploy.
3. Frontend: SmartPlayer hook, EpisodeCard gombok, EnPodiverzumomPage szekció.
4. Smoke test: konzol + 1 valódi swipe → login → ajánlás megjelenik → like → 2 perc múlva új ajánlás.