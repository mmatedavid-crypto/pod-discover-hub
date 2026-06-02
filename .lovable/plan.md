# Heti editorial: kevésbé magyartalan, valódi szerkesztői hang

## Mi a baj a mostani szöveggel

> „Mintha tudatosan reflektálnánk a közelgő uniós választásokra… annak is a legsürgetőbb kérdéseiről: mezőgazdaságáról, a demokrácia alappilléréről, az egészségügyéről… az „egyszeri" magyar hallgatóként ülő magunkhoz köt. Négy politikai, egy sport, egy történelmi adás – jól jellemzi, hogy jelenleg mi foglalkoztatja a podcast-hallgatókat 🇭🇺."

Konkrét hibák:
- **„Mintha tudatosan reflektálnánk"** – tükörfordítás-érzet, üres meta-keret
- **birtokos halmozás** („jövőről szólnak, annak is a legsürgetőbb kérdéseiről: mezőgazdaságáról, … alappilléréről, … egészségügyéről") – nyelvileg sántít
- **„az „egyszeri" magyar hallgatóként ülő magunkhoz köt"** – körmondat, magyartalan szerkezet
- **műfajösszesítés** („Négy politikai, egy sport, egy történelmi adás") – metaadat, nem szerkesztői gondolat
- **zászló emoji** a végén – kerülendő
- nincs egyetlen konkrét név, szám vagy állítás sem az introban

A máj.17-i intro ezzel szemben éles és konkrét volt („A vászontáska itt már kevés, a brit ügyintézésnél pedig a romantikus külföldre költözés is hamar Excel-táblává változik.") – ugyanaz a pipeline, ugyanaz a modell. A különbség: a `gemini-2.5-flash` nem konzisztens magyar stiláris érzékben, és a jelenlegi prompt nem tilt elég klisét.

## A terv

Három réteg, együtt hozza a kívánt minőséget. Egy edge function érintett: `supabase/functions/weekly-editorial-post/index.ts`.

### 1) Modell-upgrade Pro-ra

Az AI-hívás modellje `google/gemini-2.5-flash` → **`google/gemini-2.5-pro`**, `app_settings.weekly_editorial_controls.model`-en keresztül felüldefiniálhatóan. A function már most olvas `controls.model`-t, csak a default kell hogy Pro legyen.

- Heti 1 hívás → költség elhanyagolható (~néhány cent/hét)
- Pro modell magyar prozódiája lényegesen jobb (kevesebb tükörfordítás, kevesebb körmondat)
- Fallback: ha `payment_required` vagy `rate_limited`, automatikus retry `gemini-2.5-flash`-sel

### 2) Szigorúbb system prompt + tiltólista + 1 jó few-shot

A jelenlegi prompt jó alap, de hiányzik belőle:

**Tiltott fordulatok** (szó szerint listázva a promptban, „NE használd" felirattal):
- „Mintha…", „Ezen a héten…", „A hét adásai…"
- „jelenleg mi foglalkoztatja", „jól jellemzi", „közös szál"
- „izgalmas", „érdekes", „lebilincselő", „magával ragadó"
- „kiderül, hogyan", „szó esik arról", „beszélgetés arról"
- „az egyszeri magyar hallgató", „mindannyiunk", „magunkhoz köt"
- bármely országzászló-emoji (🇭🇺 🇪🇺 stb.)
- birtoklánc 3+ tagú felsorolásban („A jövőről, annak is a kérdéseiről, azoknak is a részleteiről")

**Kötelező elemek az introban:**
- max 3 mondat, max 70 szó
- legalább 1 konkrét név, szám, intézmény, vagy konkrét állítás az epizódokból
- nem műfajösszegzés, hanem egy gondolati ív vagy egy konkrét megfigyelés

**Few-shot példa**: a máj.17-i intro szó szerint beágyazva a system promptba „JÓ PÉLDA" felirattal, és egy szintetikus „ROSSZ PÉLDA" (a mostani máj.26-i), magyarázattal hogy miért rossz.

### 3) Több forrásanyag a modellnek

Jelenleg epizódonként 1400 karakter clean_text megy a promptba → **3500-ra emelve**. Ezzel a Pro modellnek van valódi anyaga, amiből konkrét állítást idézhet az introba, nem általánosságokba menekül. Token-költség ~2.5×, de heti 1 hívás → továbbra is elhanyagolható.

### 4) Post-validáció + 1 retry

A modell válasza után egyszerű string-check:
- tartalmaz-e tiltott frázist → ha igen, 1 javító kör ugyanazzal a prompttal + „a következő rész klisés: <részlet>, írd át konkrétabbra"
- van-e legalább 1 nagybetűs tulajdonnév vagy szám az introban → ha nincs, 1 javító kör
- max 1 retry, utána elfogadjuk amit kapunk (nem akadhat el a heti poszt)

### 5) Regeneráljuk a máj.26-i posztot az új pipeline-nal

A jelenlegi `published` posztot átírjuk a `weekly-editorial-post` függvénnyel `{ post_id: "...", regenerate: true }` body-val (a function már támogatja a regenerate-et). Így azonnal látod az új minőséget.

## Mit NEM csinálunk most

- Nem nyúlunk a teaser/quote sémához – azok jók
- Nem változtatjuk az epizód-válogatást (`pickEpisodes`) – a tartalmi keret jó, csak a hang gyenge
- Nem írunk át más cron/runner logikát

## Érintett fájlok

- `supabase/functions/weekly-editorial-post/index.ts` — `MODEL` default, `buildPrompt()` system+user, `pickEpisodes` source slice 1400→3500, új `validateAndRetry()` lépés a `callAI` után
- (opcionális) `app_settings.weekly_editorial_controls` rekord frissítés `model: "google/gemini-2.5-pro"` értékkel — admin override

## Várt eredmény

- intro: 2-3 mondat, konkrét névvel/számmal, klisé nélkül, magyar mondatszerkezet
- nincs zászló-emoji, nincs „mintha", nincs „jelenleg mi foglalkoztatja"
- a teaserek minősége marad (eddig is rendben volt), csak a keret-szöveg lesz éles
