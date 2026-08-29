# Podiverzum HU — mérési igazság-hierarchia (analytics phase 1)

Két, egymást ellenőrző réteg működik:

1. **First-party Supabase** (`page_events`, `search_events`, `player_events`) — változatlan, ez a **kontroll/validációs** forrás. Tartalmazza a botokat is (`page_events.is_bot`).
2. **PostHog** (client-side, projekt token) — termékanalitika. Csak a valós production hoston (`podiverzum.hu`, `www.podiverzum.hu`), nem-bot böngészőkben, admin/auth útvonalak kizárva.

## Metrika-hierarchia

| Szint | Definíció | Esemény |
|---|---|---|
| Human engaged session | olyan tab/session, amelyben történt megbízható humán input | `human_interaction` |
| Search activation | a felhasználó explicit keresést indított | `search_submitted` |
| Search success intent | a találati listából megnyitott egy találatot | `search_result_opened` |
| Listening activation | elindította az epizódot | `episode_play_started` |
| Meaningful listening | 25%-ig hallgatta | `episode_play_25` |
| Deep listening | 50% / 75% | `episode_play_50`, `episode_play_75` |
| Completion | végighallgatta | `episode_play_completed` |
| Diagnosztika | `$pageview`, bounce, session hossz | **nem** North Star, botokat is tartalmazhat |

North Star jelöltek: *human engaged session*, *search activation → search success intent* arány, *listening activation → meaningful listening* arány.

## Esemény-taxonómia (pontos nevek)

- `human_interaction` — tabonként **egyszer**, az első `isTrusted` `pointerdown` / `touchstart` / `keydown` eseménynél. Property: `path`, `input_type`, `viewport_class`.
- `search_submitted` — csak explicit felhasználói submit/kattintás. Property: `source` (`search_page` | `ask_podiverzum` | `example`), `query_length`, `terms_count`. **Nyers keresőszöveg nincs.**
- `search_result_opened` — `/kereses` találat megnyitása. Property: `source: "search"`, `result_kind` (`episode` | `podcast` | `person` | `organization` | `topic` | `other`), `slug`, opcionálisan `episode_id` / `podcast_id`.
- Player tükrözés (a Supabase insert változatlan marad): `play_start → episode_play_started`, `play_25 → episode_play_25`, `play_50 → episode_play_50`, `play_75 → episode_play_75`, `play_complete → episode_play_completed`, `playback_error → episode_playback_error`, `external_open → external_listen_opened`. Property: `episode_id`, `podcast_id`, kerekített `position_sec`, `duration_sec`, `playback_rate`. A `meta` **nem** kerül át (szabad szöveges, nem garantáltan PII-mentes).

## Szabályok

- URL-ből (`?q=`) rendered keresés vagy crawler-navigáció **nem** generál `search_submitted`.
- Nincs session replay (`disable_session_recording: true`).
- Nincs PII: e-mail, user id, név nem kerül PostHogba; `person_profiles: "identified_only"`, anonim látogatót nem azonosítunk.
- Nyers keresőkifejezés kizárólag a saját Supabase `search_events` táblában marad.
- Az analitika mindig csendben hibázik, sosem blokkolja a UI-t.
- Bot-detektálás egy helyen: `src/lib/botDetect.ts` (a `PageViewTracker` is ezt használja).

## Validáció

Hetente vessük össze: PostHog `human_interaction` unique session vs. Supabase `page_events` `is_bot = false` distinct `session_id`. Nagy eltérés → ad-blocker arány vagy hibás bot-szűrés.
