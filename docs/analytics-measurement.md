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

## Bounce rate értelmezése (2026-09-02)

A látogatók döntő többsége **nem a főoldalra érkezik**: keresőből (Google, Bing) és
AI-asszisztensekből (ChatGPT) közvetlenül epizód-, podcast-, téma-, személy- vagy
szervezet-oldalra lépnek be. Ezért az aggregált bounce rate (~84%) **nem KPI**, hanem
műtermék.

Mért példa (7 nap, nem-bot sessionök):

| Forrás → landing | Session | Oldal/session | Bounce |
|---|---|---|---|
| Google → /podcast/... | 201 | 2,28 | 28,9% |
| Bing → /podcast/... | 9 | 1,89 | 11,1% |
| ChatGPT → /podcast/... | 9 | 2,00 | 33,3% |
| direkt/nincs referrer → entitásoldal | ~340 | ~1,2 | 64–100% |
| bármi → főoldal | 27 | 5,5–8 | 0–27% |

Szabályok:

- A bounce rate-et **mindig forrás + landing típus bontásban** nézzük (admin: `/admin/analytics`
  → „Belépési pontok és bounce”), soha nem aggregáltan.
- Az „direkt/nincs referrer + entitásoldal + 1 pageview + nincs `human_interaction`” szegmens
  nagyrészt maradék bot / AI-fetch — nem valódi felhasználói csalódás; diagnosztikaként kezeljük.
- Valódi elköteleződési KPI marad: `human_interaction`, `search_submitted`,
  `search_result_opened`, `episode_play_started` / `_25` / `_completed`.
- SEO-optimalizálás célpontja továbbra is az entitásoldal, nem a főoldal.
