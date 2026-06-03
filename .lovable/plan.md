# Reddit bot: reaktív Podiverzum linker

## Mit csinál

Figyeli a r/hungary, r/Magyarorszag és r/podcasts új kommentjeit + posztjait. Ha valaki név szerint említ egy magyar **podcastot, személyt, vagy szervezetet/műsort**, amit a Podiverzum katalógusa ismer, a bot egy rövid, **egyszeri** kommentet ír a megfelelő profil linkjével. Nem posztol új threadet, nem promóz agresszíven, nem válaszol kétszer ugyanott.

## Mit kell tőled (egyszeri setup)

1. **Reddit account létrehozása** — menj a reddit.com-ra, regisztrálj egy új accountot (pl. `u/podiverzum_bot`). Várj vele 1–2 napot mielőtt élesítjük, hogy ne nézzen friss spam-accountnak.
2. **Reddit script app regisztrálása** — `reddit.com/prefs/apps` → "create another app" → válaszd a **"script"** típust → name: `podiverzum-linker` → redirect URI: `http://localhost:8080` (nem használjuk, csak kötelező mező).
3. A kapott `client_id` (app neve alatti rövid string) + `client_secret` + az új account `username` + `password` — ezeket a végén Lovable secretként beadod.
4. **Mod-engedély subonként** — a r/hungary és r/Magyarorszag modjainak modmail: kérünk engedélyt a bot futtatására, leírjuk hogy reaktív + csak releváns + egyszeri komment + opt-out parancs van. Ezt te küldöd el; sablon-szöveget adok.

## Hogyan működik

**Adatforrás (Podiverzum oldalon):**
- `podcasts` (HU, `is_indexable=true`) → `/podcast/{slug}`
- `people` (`is_indexable=true`) → `/szemelyek/{slug}`
- `organizations` (`is_indexable=true`) → `/ceg/{slug}`
- `episodes` (top-tier S/A, friss) → `/podcast/{ps}/{ep}` — opcionális, csak ha epizód-cím is egyezik

**Matching logika:**
- Új `name_alias` materialized view: minden név + ismert aliasok (pl. „Partizán" = „Partizán Podcast"), normalizálva (kisbetű, ékezet-fold, határoló-szóhatár).
- Reddit szöveg → token-szintű word-boundary regex match. Nincs fuzzy, nincs embedding — **csak pontos név**.
- Minimum 4 karakter, és nem-szótári név (kiszűrjük a „Index", „Hír", „Hét" stb. típusú zaj-egyezéseket egy stoplistával).
- Egy szövegben max 2 találat → max 2 link/komment.

**Posztolási szabályok:**
- 1 komment / Reddit-thread (`submission_id` deduplikálva DB-ben).
- 1 komment / 90 másodperc globálisan (Reddit rate limit + spam-prevenció).
- Max 30 komment/nap (állítható).
- Nem válaszol: deleted/removed kommentre, bot-accountra, saját posztra, 7 napnál régebbi szálra.
- Ha valaki válaszol "!podiverzum stop"-pal, az adott user-t kitiltjuk (`opt_out` tábla).
- Komment-sablon:
  > A [{name}]({url}) erről beszélt — a Podiverzumon megtalálod az epizódjait.
  >
  > ^(automatikus link, opt-out: válaszolj „!podiverzum stop")

**Architektúra:**
- **Edge function `reddit-link-bot`** — egyetlen runner. OAuth password-flow tokent kér, lekér 25 új commentet + 25 új submissiont subonként, matchel, posztol, logol.
- **Cron jobid X**, `*/5 * * * *` (5 percenként). Ha 0 új találat, marad — ha sokat tilt a rate limit, a queue-health controller mintára auto-pause.
- **DB:**
  - `reddit_bot_state` (app_settings JSON: `enabled`, `daily_cap`, `comment_cooldown_s`, `subs`, `last_seen_ids`).
  - `reddit_bot_log` (mit, mikor, hová posztolt, vagy miért nem — match miss / cooldown / cap / opt_out).
  - `reddit_bot_opt_out` (user, reason, ts).
  - `reddit_name_index` matview a katalógusból, naponta frissül.
- **Admin oldal `/admin/reddit-bot`** — kapcsoló, daily cap slider, utolsó 100 log, opt-out lista, "dry run" mód (matchel + logol, **nem** posztol — első napokban kötelező).

## Mit építek (sorrendben)

1. Migration: `reddit_bot_state`, `reddit_bot_log`, `reddit_bot_opt_out`, `reddit_name_index` matview + refresh függvény.
2. Edge function `reddit-link-bot` — Reddit OAuth, polling, match, post, log. Default `dry_run=true`.
3. Admin oldal a beállításokhoz + log-nézethez.
4. Secret-prompt: `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_USERNAME`, `REDDIT_PASSWORD`, `REDDIT_USER_AGENT` (formátum: `podiverzum-linker/0.1 by u/podiverzum_bot`).
5. Cron felvétel `*/5 * * * *`, **dry_run=true** marad amíg te a logok alapján rábólintasz.
6. Modmail-sablon (HU) a r/hungary és r/Magyarorszag modjainak.

## Mi van a scope-on KÍVÜL (most)

- Új submission posztolás (heti összefoglaló stb.).
- Téma/embedding alapú match.
- Globális r/podcasts angol nyelvű threadek.
- DM válaszok, livechat.
- Fizetett promóció / sponsored post.

## Kockázat

- **Subreddit ban a legnagyobb veszély**, ha a modok spam-nek látják. Ezért: dry_run első, modmail-engedély kötelező, opt-out parancs, alacsony daily cap (30), és minden link relevancia-magyarázattal.
- A Reddit script app password-flow régóta megy, de 2FA-s accounton extra setup kell — ezért a bot-account NE legyen 2FA-s, vagy app-jelszót kell generálni.

## Technikai részletek (developereknek)

- Reddit endpoints: `POST https://www.reddit.com/api/v1/access_token` (Basic auth client_id:client_secret, body `grant_type=password&username=...&password=...`), majd `GET https://oauth.reddit.com/r/{sub}/comments?limit=25&sort=new` és `/r/{sub}/new?limit=25`. Posztolás: `POST https://oauth.reddit.com/api/comment` body `thing_id=t1_xxx&text=...`.
- `User-Agent` header KÖTELEZŐ minden hívásnál, különben 429.
- Token TTL ~1 óra, in-memory cache a function memóriájában nem elég (új cold start) → tárold `reddit_bot_state.access_token` + `access_token_expires_at`-be.
- Match normalizálás: `unaccent(lower(text))` + `\b{name}\b` regex; aliasok `people.aliases` + `podcasts.alt_titles` (létezik már).
