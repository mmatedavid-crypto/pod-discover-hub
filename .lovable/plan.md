## Miért üresek a mood kártyák

A `mood-collections-seed` edge function az angol Podiverzum verzióból maradt itt:
- `DEFAULT_SEEDS` 5 angol slug-ra van (`morning-inspiration`, `deep-focus`…), **egyik sem egyezik a 9 HU slug-gal** (`elalvashoz`, `munkaba-menet`, `edzeshez`, …)
- `match_podcasts_by_embedding` hívása **`p_lang: "en"`** → magyar podcastra sosem talál match-et
- Nincs cron, ami futtassa → kézzel sem fut le

A `reggeli-radio` valószínűleg manuálisan lett feltöltve, ezért van benne 3 podcast.

## Mit csinálok

### 1. `supabase/functions/mood-collections-seed/index.ts` átírása HU-ra
- `DEFAULT_SEEDS` cseréje 9 magyar seed promptra a HU slugokhoz, mindegyik 3–4 mondatos tematikus leírás magyarul (alvás/relax, reggeli ingázás, edzésenergia, hosszú út, hírek/aktualitás, humor, tanulás/tudomány, mélyebb filozófia/pszichológia, reggeli rádiózás).
- `p_lang: "en"` → `p_lang: "hu"`.
- `limit` default 8 marad (megfelelően sok podcast/mood, mobil top4-et úgyis vág a frontend).
- Tier szűrésen nem nyúlunk (RPC már S/A-t preferál a shadow_rank szerint).

### 2. Egyszeri futtatás
Meghívom az edge fn-t `dryRun:false` módban — feltölti mind a 9 mood `podcast_ids` mezőjét és perzisztálja a `seed_query`-t is későbbi re-runokhoz.

### 3. Heti cron (pg_cron)
- Új cron `podiverzum-mood-collections-seed-weekly`, `0 4 * * 1` (hétfő 04:00 UTC).
- Drift ellen: ha új S/A HU podcast érkezik a héten, automatikusan bekerül a megfelelő mood-okba.
- Költség elhanyagolható: 9 embedding hívás / hét (~$0).

### 4. Mit NEM csinálok
- Frontend (`MoodCollections.tsx`, `MoodCollectionPage.tsx`) nem változik — az már mai szerkezetében működik, csak adat kell neki.
- Az `episode_ids`-t most nem töltjük (a mood oldal a podcast_ids-ből összeszedi a friss epizódokat — ez a meglévő pattern).
- A 9 slug, ikonok, accent színek, `MOOD_SUBTITLES` változatlanok.

## Várt eredmény
A kezdőlapon mind a 9 (mobilon top 4) mood kártya mögött 8 releváns HU podcast lesz, a `/mood/<slug>` oldalakon pedig friss epizódlisták töltődnek.
