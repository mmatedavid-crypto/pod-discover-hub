# Felhasználói fiókok — V1 terv

## Cél
Diszkrét, GDPR-tiszta Google-only bejelentkezés a Podiverzumon. A regisztráló felhasználók extra funkciókat kapnak: archetípus mentés, kedvenc/meghallgatandó jelölés, podcast-követés email-értesítéssel, hallgatási történet (jövőbeli Netflix-szerű ajánlóhoz), hangulat-preferenciák, megosztható publikus profil.

## Scope (jóváhagyott)
- ✅ Google-only auth (0 jelszó-felelősség, GDPR-minimum)
- ✅ Header bal oldalon diszkrét `User` ikon (kék/aktív szín ha belépve, avatar ha van)
- ✅ Soft regisztráció-felajánlás a `/start` végén (elegáns kártya, nem felugró)
- ✅ Archetípus mentés a fiókba a `/start` végén
- ✅ Kedvenc (❤️) + Meghallgatandó (🔖) jelölés minden `EpisodeCard`-on
- ✅ Podcast-követés (🔔) + **email-értesítés új epizódról** (heti összevont digest, nem azonnal)
- ✅ Hallgatási történet (csak jelölt + lejátszott epizódok, alapja a jövőbeli ajánlónak)
- ✅ Hangulat-preferenciák (max 3, homepage személyre szabás)
- ✅ Publikus, megosztható profil-oldal: `/p/<username>` — archetípus + nyilvános kedvencek
- ✅ Fiók törlése = teljes adattörlés (GDPR cikk 17)

## Scope-ból kihagyva
- ❌ A. Folytatás-emlékeztető (flow elég rövid)
- ❌ F. Napi +1 swipe (későbbi v2)
- ❌ Email/jelszó auth (nem szükséges Google mellett)

---

## UI változások

### 1. Header (`SiteHeader.tsx`)
- Bal oldalon, a `BrandMark` és a nav között: `User` ikon button
- **Nincs belépve** → halvány szürke `User` ikon → kattintásra `/belepes`
- **Belépve** → avatar (Google profilkép) vagy primary színű `User` ikon → kattintásra dropdown:
  - "Az én Podiverzumom" → `/en-podiverzumom`
  - "Beállítások" → `/en-podiverzumom?tab=beallitasok`
  - "Kijelentkezés"

### 2. `/start` flow vége
A swipe befejezése után az eredmény-kártya alá **soft CTA**:
```
┌─────────────────────────────────────┐
│  💾 Mentsd el a fiókodba is        │
│                                     │
│  Google-fiókkal 5 mp alatt:        │
│  • A Podiverzumod örökre megmarad  │
│  • Kedvencek + meghallgatandó      │
│  • Értesítés ha új rész jön        │
│                                     │
│  [Belépés Google-lal]  Most nem    │
└─────────────────────────────────────┘
```
- Nem blokkoló, scrollozható tovább
- Sessionben elmenti hogy mutattuk → nem zavarjuk újra

### 3. `/en-podiverzumom` (új oldal, csak belépve)
Tabs:
- **Profilom** — archetípus kártya, avatar, megjelenítendő név
- **Kedvencek** (❤️) — lista
- **Meghallgatandó** (🔖) — lista
- **Követett podcastok** (🔔) — lista
- **Hangulatok** — 3 hangulat-chip kiválasztása (Reggel fókusz / Este lazítás / Edzés alatt energikus / Munka közben / Utazás közben / Lefekvés előtt)
- **Történet** — utolsó 50 hallgatott/jelölt epizód
- **Publikus profil** — `/p/<username>` link + másolás gomb + nyilvános/privát kapcsoló
- **Beállítások** — email értesítések on/off, fiók törlése

### 4. `EpisodeCard` kiegészítés
2 új ikon-gomb (csak belépve): ❤️ Kedvenc, 🔖 Meghallgatandó. Toggle, optimisztikus UI.

### 5. `PodcastCard` / `PodcastDetail` kiegészítés
🔔 "Követem" / "Követed" gomb (csak belépve).

### 6. `/p/<username>` publikus profil
- Archetípus + szöveg
- Publikus kedvencek (max 12)
- "Készítsd el a saját Podiverzumod" CTA → `/start`

---

## Adatbázis (új táblák)

### `profiles`
- `user_id` (auth.users FK, PK)
- `display_name`, `avatar_url`, `username` (unique, slug)
- `archetype_slug`, `archetype_result` (jsonb)
- `mood_preferences` (text[] max 3)
- `is_public_profile` (bool, default false)
- `email_notifications_enabled` (bool, default true)

### `user_episode_marks`
- `user_id`, `episode_id`, `mark_type` ('favorite' | 'listen_later'), `created_at`
- UNIQUE(user_id, episode_id, mark_type)

### `user_podcast_follows`
- `user_id`, `podcast_id`, `created_at`, `last_notified_at`
- UNIQUE(user_id, podcast_id)

### `user_listen_history`
- `user_id`, `episode_id`, `played_at`, `progress_seconds`
- alapja a jövőbeli ajánló-rendszernek

### RLS
- `profiles`: SELECT public ha `is_public_profile=true`, egyébként csak own; UPDATE/DELETE csak own
- `user_episode_marks`, `user_podcast_follows`, `user_listen_history`: minden csak own

### Trigger
- `handle_new_user()` → új signupkor automatikusan létrehoz `profiles` rekordot Google-adatokból

### GDPR
- `delete_my_account()` SECURITY DEFINER RPC: töröl minden user-adatot + `auth.users` rekordot

---

## Email értesítés új epizódról (B)

### Mechanizmus
- **Heti digest** (nem azonnal — spam-mentes, batching)
- Új edge function: `weekly-follow-digest` → vasárnap 10:00 cron
- Logika: minden követő user-re lekérdezi az utolsó 7 napban megjelent epizódokat a követett podcastokból → 1 email/user az összes új résszel
- Lovable Email-en keresztül (nem 3rd-party)
- "Leiratkozás" link minden emailben

### Prereq
- Email-infrastruktúra setup (`setup_email_infra`) — domain már van? Ellenőrzöm. Ha nincs, setup dialógus.

---

## Megvalósítási lépések (sorrendben)

1. **Migráció** — `profiles`, `user_episode_marks`, `user_podcast_follows`, `user_listen_history` táblák + RLS + `handle_new_user` trigger + `delete_my_account` RPC
2. **Google OAuth bekapcsolása** — `configure_social_auth(["google"])`
3. **`AuthPage.tsx`** átírása — csak Google gomb (jelenleg ami van, leegyszerűsítve)
4. **`useAuth` hook** — session state, profile fetch, mutate helpers
5. **`SiteHeader.tsx`** — User ikon + dropdown
6. **`/start` vége** — soft CTA kártya + archetípus auto-mentés ha belépve
7. **`EpisodeCard`** — ❤️/🔖 gombok
8. **`PodcastCard`/`PodcastDetail`** — 🔔 követés gomb
9. **`EnPodiverzumomPage`** — új oldal tabokkal
10. **`/p/:username`** — publikus profil oldal
11. **Email-infra check** + `weekly-follow-digest` edge function + cron
12. **GDPR — fiók törlés** flow

## Megerősítendő
- Email-értesítés **heti digest** (nem azonnal), vasárnap reggel — ez OK? Vagy inkább azonnali?
- Felhasználónév auto-generálás Google-névből (slug), vagy hagyjuk a usert beállítani később?

Ha jóváhagyod, kezdek az 1. lépéssel (migráció).
