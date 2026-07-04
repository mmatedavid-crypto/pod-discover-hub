# Person bio bővítés — Fázis 1 (Trusted Source)

Cél: **~2 300 személy hiányzó/gyenge életrajzát** kibővíteni Wikipedia + episode summary mellett **hivatalos külső forrásokból** (podcast website, epizód-leírásokban linkelt személyes site, RSS host-bio), hallucináció-védetten.

## Mit tudunk már most (mérés)

- 1 469 HU podcast, ebből **1 103-nak van saját `website_url`** (nem Spotify/Apple/feeds-aggregátor)
- **141 368 HU epizód**, ebből **36 106-ban van .hu/.com/… domain URL** a description mezőben
- **83 host / 93** kap podcast-website-ot ingyen (host oldalak azonnal bővíthetők)
- 258 személy 0 bio-val, 470 gyenge bio-val → ez a merítés

Firecrawl connector már él (ai-feed-scout használja). `person-bio-generator` már audit-lépéssel dolgozik (Wikipedia + epizód-summary → HU bio → külön AI hallucináció-check). Ehhez adunk hozzá.

## Új adatforrások — prioritási sorrend

1. **Podcast website** (host esetén) — `podcasts.website_url` root vagy `/about` scrape
2. **Episode description URL-ek** (guest esetén) — extract → filter → scrape a vendéghez tartozó domaint
3. **RSS host-bio** — `pi_feed_staging.raw_channel_json` `<itunes:author>` / `<itunes:owner>` / `<itunes:summary>`
4. **YouTube channel `about`** — ha van `podcasts.youtube_url`, a `podcast_youtube_candidates.channel_id`-ből
5. **Podcast description** — `podcasts.description` első bekezdés (host bemutatkozó szokott lenni)

## Architektúra

```text
┌────────────────────────────────────────────────────────────────┐
│ person-source-harvester (ÚJ edge, cron */10)                   │
│  → person_external_sources tábla (ÚJ)                          │
│    person_id, source_type, url, domain, raw_text, scraped_at,  │
│    trust_score, name_match_score, status                       │
└────────────────────────────────────────────────────────────────┘
            ↓
┌────────────────────────────────────────────────────────────────┐
│ person-bio-generator (MEGLÉVŐ, kibővítve)                      │
│  input: wiki + episodes + [ÚJ] external_sources                │
│  audit: hallucináció-check most már 3 forráscsoport ellen      │
│  overview_sources: hozzáfűzve az új URL-ek + trust             │
└────────────────────────────────────────────────────────────────┘
            ↓
       PersonDetailPage
       „Ki ő?" + „Külső források" chip-ek (már él)
```

## Merítés-logika

**Host bio (biztonságos, kollízió-mentes)**
```text
SELECT p, po
FROM people p
JOIN person_podcast_map pm ON pm.person_id = p.id
JOIN podcasts po ON po.id = pm.podcast_id
WHERE p.is_public AND host_count > 0
  AND po.website_url IS NOT NULL
  AND po.website_url !~ '^https?://(open\.spotify|podcasts\.apple|feeds\.|apple\.co|pod\.link|anchor\.fm)'
  AND (p.overview_text IS NULL OR length(p.overview_text) < 200)
```
Miért safe: a host neve ismert, a saját podcast-website-ja szinte biztosan róla szól. Kollízió minimális.

**Guest bio — URL az epizód-leírásban**
```text
regex ki a description-ből: https?://[^\s)]+
kizár: spotify/apple/youtube/podbean/social (fb/insta/tiktok)
maradó: „own site" jelölt
name-match gate: 
  - a domain root scrape után az AI kap:
     „a scraped tartalom biztosan XY nevű személyről szól-e?
      confidence 0..1, indoklás"
  - ha confidence >= 0.8 → forrásként használjuk
  - ha 0.5–0.8 → draft (admin review)
  - < 0.5 → dobjuk, `status='name_mismatch'`
```
Ez oldja meg a névkollíziót — nem a nevet matchel-ünk, hanem a **kontextust**.

**RSS/YouTube** — analóg, de channel-owner mint host feltételezés.

## Új tábla — `person_external_sources`

```text
person_id          uuid
source_type        text  -- podcast_website | episode_desc_url | rss_owner | youtube_about | podcast_desc
source_url         text
source_domain      text
podcast_id         uuid null  -- honnan jött
episode_id         uuid null
scraped_at         timestamptz
scraped_text       text    -- max 8 KB
name_match_score   numeric -- AI confidence
name_match_reason  text
trust_score        numeric -- source_type súlyozás
status             text    -- pending | verified | draft | rejected | name_mismatch | scrape_failed
firecrawl_cost     numeric
created_at, updated_at
```
Unique: `(person_id, source_url)`. RLS: admin only olvasás/írás; edge service_role.

## Költség-védelem

- Firecrawl scrape ≈ $0.001–0.005 / URL → cap: **napi 500 scrape / $2** kill-switch az `app_settings.person_source_harvester_controls`-ban
- AI name-match gate: `google/gemini-2.5-flash-lite`, ~500 token/URL → $0.0002/URL → ~$0.1/nap
- Cache: `source_url` unique → **ugyanaz az URL soha nem scrape-elődik kétszer**
- Első teljes drain: ~1 500 host-website + ~10 000 guest-URL = **~$10–20 egyszeri**, azután steady state ~$0.5/nap

## Watchdog & controls

`app_settings.person_source_harvester_controls`:
```text
enabled          bool
budget_usd_daily 2.0
batch_size       25
concurrency      3
require_name_match_min 0.5
publish_confidence_min 0.8
```
`pipeline-watchdog` már figyeli az AI költséget — ide plusz runner enroll (napi $2 × 1.1 cap → auto-pause).

## Blackout lista — sose scrape-elünk

- Politikus, orvos, ügyvéd, kiskorú (`occupation_labels` alapján)
- `persona = 'historical'` vagy `is_deceased = true`
- Bűnügyi hírben említett (már meglévő `editorial_notes` hard block)
- `identity_ambiguous = true` ÉS `manual_approved = false`
- `common_surname` a `person_common_surname_watchlist`-en

## Kimenet a PersonDetailPage-en

Már megvan az „**Ki ő?**" + „**Külső források**" szekció. A harvester új URL-eket fűz az `overview_sources` jsonb-hez `{type, url, label, confidence}` formában — automatikusan megjelennek chipként.

## Lépések

1. **DB migráció** — `person_external_sources` tábla + `app_settings.person_source_harvester_controls` seed
2. **Új edge: `person-source-harvester`** — merítő + Firecrawl scrape + AI name-match gate → `person_external_sources` insert
3. **Cron** (kikapcsolva először, dry_run=true)
4. **Kiterjeszti a `person-bio-generator`-t** — ha `person_external_sources` verified rekord van, azt is beadja evidence-nek + audit-ellenőrzi
5. **Admin oldal** `/admin/person-sources` — draft-review UI (chip zöld/sárga/piros, „elfogadom" / „elutasítom" gomb)
6. **Test futtatás**: 10 host + 10 guest kézzel triggerelve, review, majd cron enable
7. **Batch drain** ~2–4 nap alatt, watchdog + budget cap-pel
8. **Post-drain**: `recompute_person_gated_counts` + `overview_text` újragenerálás azoknál akiknek új forrása lett

## Kockázatok & mit NE

- **Ne** cache-eljünk határidő nélkül — 90 nap után rescrape, mert az „About" oldalak változnak
- **Ne** publikáljunk `confidence < 0.8` bio-t, csak draft
- **Ne** scrape-eljünk aggregátor domaint (facebook, insta, tiktok, x, linkedin) — külön follow-up feature
- Robots.txt tiszteletben tartás — Firecrawl default alapból megteszi
- GDPR: forrás-URL mindig cite-olva (nem magunktól „állítjuk" a tényt, hanem „a legzogyakorlatok.com szerint")

## Metrikák (7 nap múlva review)

- Új `verified` external_sources rekordok száma
- Új `overview_text` bővítés (chars átlagos delta)
- 0-bio személyek darabszáma
- Költség (Firecrawl + AI)
- Draft/reject arány (ha < 20% draft → gate szigor csökkenthető)

---

Mondd, hogy **indítsam a build-et**, és először a DB migrációval + harvester edge-dzsel kezdem, dry_run módban tesztfuttatással 10 hoston és 10 guesten. A cron csak azután élesedik, hogy megnézed a `/admin/person-sources` draft oldalt.
