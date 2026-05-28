# Netflix-szintű podcast-élmény — egyben, ma

Mind a 4 lépés egy körben kerül be. A funkciók egymásra épülnek: az auth + watchlist alapozza meg a személyre szabott főoldalt; az AI fejezet markerek és a megoszthatóság a már meglévő `episode_chunks` és vektor-infrastruktúrán futnak.

## 1) Auth + Watchlist + Progress sync (fundamentum)

**Cél:** belépő felhasználó bármelyik eszközön ott folytathatja, ahol abbahagyta; menteni tud egy "Később meghallgatom" listára.

- `/auth` oldal már él (email+jelszó + Google), nem nyúlunk hozzá.
- Új táblák:
  - `watchlist (user_id, episode_id, added_at)` — RLS: csak saját.
  - `playback_progress (user_id, episode_id, position_seconds, duration_seconds, completed, updated_at)` — RLS: csak saját.
- `SmartPlayerProvider` 10 másodpercenként **belépett usernek** is upsertel a `playback_progress`-be (a localStorage marad fallbacknek vendégeknek).
- Új gomb az `EpisodeAudioPlayer` és `SmartPlayerBar` jobb oldalán: **"Mentés"** (bookmark ikon) — toggle, vendégnek felugró: "Jelentkezz be a mentéshez".
- Új főoldali sáv (csak belépve):
  - **"Folytasd ott, ahol abbahagytad"** — top 6 nem-befejezett `playback_progress` sor join `episodes`.
  - **"Mentett epizódok"** — utolsó 6 watchlist elem.

## 2) Személyre szabott főoldal — vektor-átlagból ajánlás

**Cél:** belépett user főoldala "Netflix" módban: "Mert hallgattad: X" sávok valódi szemantikai hasonlóság alapján.

- Új edge function: **`personalized-home-rails`**.
  - Lekéri user utolsó ~20 `play_30s`+ taste interakcióját.
  - Lehúzza ezek `episode_embeddings` vektorát, kiszámol egy **átlag-vektort**.
  - Meghívja a meglévő `match_episodes_by_vector` RPC-t (vagy hasonló, ha nincs, létrehozzuk) → top 30, kiszűri amit már hallgatott.
  - Plusz: 3 db "Mert hallgattad: {epizód-cím}" sáv — a 3 legfrissebb taste-interakció epizódjából egyenkénti hasonlóság.
- Új komponens: `PersonalizedHomeRails.tsx` — belépett usernek **a `MoodCollections` és `TrendingEntities` HELYETT** jelenik meg az `Index.tsx`-en. Vendég továbbra is a régit látja.
- Cache: 1h böngészőben + edge function `app_settings.personalized_home_cache` opcionális.

## 3) AI fejezet markerek `episode_chunks`-ból (a megvalósítható verzió)

A user jelezte: tudja, hogy nincs teljes epizód-szöveg embedelve. De `episode_chunks` van (135k chunk a 135k epizódon). Ezekből **chapter-szerű markerek generálhatók** — nem szöveg-pontosak, de kapaszkodót adnak.

- Új edge function: **`episode-chapters-generator`** — egy epizódra:
  - Lekéri az adott epizód `episode_chunks` sorait `start_sec`/`end_sec`+`text` mezőkkel sorrendben.
  - Lovable AI Gateway `google/gemini-2.5-flash` → kéri: 4-8 fejezet, mindegyikhez `start_sec` (a chunk határokból) + magyar cím + 1 mondat összegzés.
  - Tárolás: új tábla `episode_chapters (episode_id, idx, start_sec, title, summary)` — RLS public read.
  - Lazy, on-demand: a frontend ha nincs chapter, triggerel egy generálást (csak ha S/A tier vagy >100 ep podcast — költségvédelem).
- Új komponens: `SmartPlayerChapters.tsx` — `SmartPlayerBar` expanded view-ban és `EpisodeAudioPlayer` alatt kattintható timeline ("Skip Intro" gomb az első chunk végéig + fejezetek lista timestamppel → kattintásra `seekTo`).

## 4) Megosztható audio-card

**Cél:** "Szabó Dávid azt mondta…" típusú megosztó képek a SmartPlayerből.

- Új komponens: `ShareMomentCard.tsx`.
  - SmartPlayerBar/EpisodeAudioPlayer-ben "Megosztás" ikon → modal.
  - Aktuális timestamp + epizód kép + podcast cím + "Hallgasd meg X-nél" CTA.
  - Egyszerű HTML/CSS card → `html-to-image` lib → PNG letöltés + Web Share API (mobilon natív share, desktopon link másolás).
  - Share link: `https://podiverzum.hu/podcast/{slug}/{epslug}?t={sec}` — az `EpisodeDetail` már kezeli a `?t=` paramot (átadja a playernek `startAt`-tel).
- Ha `?t=` még nincs kezelve: hozzáadjuk `EpisodeDetail`-hoz hogy az autoplay/play call kapja meg `startAt`-ként.

## Technikai részletek

**Új migrations (3 tábla):**

```sql
-- watchlist
CREATE TABLE public.watchlist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, episode_id)
);
-- GRANT + RLS (csak saját)

-- playback_progress
CREATE TABLE public.playback_progress (
  user_id uuid NOT NULL,
  episode_id uuid NOT NULL,
  position_seconds int NOT NULL DEFAULT 0,
  duration_seconds int,
  completed boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, episode_id)
);
-- GRANT + RLS (csak saját)

-- episode_chapters
CREATE TABLE public.episode_chapters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL,
  idx int NOT NULL,
  start_sec int NOT NULL,
  title text NOT NULL,
  summary text,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(episode_id, idx)
);
-- GRANT public read + service_role write
```

**Új edge functions:**
- `personalized-home-rails` — JWT-vel, user-vektor átlag → similar episodes.
- `episode-chapters-generator` — on-demand, public, dedup `episode_chapters` táblán.

**Új komponensek:**
- `src/components/ContinueListening.tsx` bővítve (auth-aware) vagy új `MyLibraryRails.tsx`.
- `src/components/home/PersonalizedHomeRails.tsx`.
- `src/components/smart-player/SmartPlayerChapters.tsx`.
- `src/components/smart-player/SaveButton.tsx`.
- `src/components/smart-player/ShareMomentCard.tsx`.

**Index.tsx logika:** ha `user` → PersonalizedHomeRails + MyLibraryRails felülre, MoodCollections lejjebb. Vendég: változatlan.

**SmartPlayerProvider bővítés:**
- Új useEffect: ha `user`, a `saveProgress` mellett `supabase.from("playback_progress").upsert(...)` 10s-enként.

**Költségbecslés:**
- Chapter-generálás: ~$0.002/epizód × becslés ~5000 epizódra ami valaha lejátszásra kerül = ~$10 egyszeri.
- Personalized rails: vektor-műveletek olcsók, LLM nem kell.

## Sorrend (egy menet)

1. Migration (3 tábla + RPC `match_episodes_by_user_vector`).
2. SmartPlayerProvider: progress sync + Save button.
3. Edge function `personalized-home-rails`.
4. PersonalizedHomeRails + MyLibraryRails komponensek + Index.tsx integráció.
5. Edge function `episode-chapters-generator` + SmartPlayerChapters komponens.
6. ShareMomentCard + `?t=` kezelés EpisodeDetail-ben.
7. Build check + gyors smoke (vendég + belépett route).

Megerősíted, hogy mehet egyben?
