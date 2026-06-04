## Háromrészes terv

### 1) YouTube pair drain — miért áll? (DIAGNÓZIS + JAVÍTÁS)

**Találat:** A pairer **nem** akadt el — szabályosan fut, csak **nincs mit párosítania**. Az igazi szűk keresztmetszet **két szinttel feljebb** van:

| Réteg | Állapot | Akció |
|---|---|---|
| **Channel-scout** (cron 19) | 1446 HU podcastból csak **362-nek (25%) van `youtube_channel_id`** | **Bump:** `15 */2` → `*/30 * * * *`, `channel_batch` 20 → 50, daily YT API quota 9000 → 9500 |
| **Episode-pairer** (cron 65, deep mode) | `no_candidates: true` — a meglévő 362 channelben nincs friss/újraindexelendő ep, `rescan_after_days=7` | **Lazítás:** `rescan_after_days` 7 → 3, hogy a deep-history backfill (14 822 ep `none` státusszal a paired podcastokban) tényleg újrafutását kapja |
| **Caption-backfill** (cron 66) | `youtube_transcript_controls.native_only=true` → 353 candidate van a view-ban, jobid 64 lassan fogyasztja (~38/6h) | Ez OK ahogy van — havi 30k credit limit, várjuk meg míg felépül a candidate pool |

**Vélelem:** a `none` (124 923 HU ep) többségénél a podcastnak nincs YT-csatornája és **soha nem is lesz** (csak RSS/Spotify-only kiadó). Reálisan a scout bump után **+200-400 új paired channel** várható, ami **+5-8k új paired ep**-t hoz → ebből ~2-3% (~150-250) lesz native-caption.

### 2) RSS `<podcast:transcript>` tag audit (azonnal indítható build feladat)

**Cél:** kideríteni hány HU epizódhoz van **ingyen transcript URL beépítve a feedbe** (Podcasting 2.0 szabvány, SRT/VTT/JSON). Ez 0 Supadata creditet fogyaszt — ha találunk akár 500-1500 ep-et, az **színtiszta nyereség**.

**Lépések:**
1. Új edge function `rss-transcript-tag-audit`:
   - Top 200 HU podcast (S+A tier) feed URL-jeit lekéri
   - XML-t parseolja, keres `<podcast:transcript url="..." type="application/srt|text/vtt|application/json">` tag-eket
   - Eredmény: `app_settings.rss_transcript_audit` jsonb (`{podcast_id, episodes_with_tag, sample_urls[3], transcript_format}`)
2. Egyszeri manuális futtatás (~5 perc, ingyen)
3. Audit-tábla a `/admin/queue-health` mellé: melyik podcast ad transcript URL-t
4. **HA van értelmes találat (≥100 ep):**
   - Új cron + runner `rss-transcript-importer`: letölti az SRT/VTT-t, beírja `episode_transcripts`-be `model='rss-native'`
   - Beleköt a `episode-clean-text-runner`-be és a `embed-episode-chunks`-ba
5. **HA közel 0:** lezárjuk, megyünk tovább a (3) irányba

**Becsült érték:** ismeretlen, 0-tól 2000 transcriptig terjedhet. Konzervatív tipp: 200-500 (főleg Acast/Buzzsprout-hosztolt podcastoknál).

### 3) "Nem jól gondolkodunk" — alternatív szövegforrás-stratégia

Igazad van, túl szűken néztem. Reframing — **nem mind kell hogy szó-szerinti transcript legyen**, csak olyan szöveg ami:
- (a) magas-jelű (a podcast tényleges tartalmáról szól, nem promo),
- (b) ingyen vagy nagyon olcsó,
- (c) chunkolható → vektorba megy → keresés/entity/topic.

**Négy új ér, prioritás szerint:**

**A) Podcast-saját weboldal scraping (Firecrawl)** ⭐ legnagyobb potenciál
- Sok HU kiadónak **van dedikált epizód-oldala leírással/idézetekkel/fejezetekkel** amit az RSS leírás nem tartalmaz: `partizan.hu/episode/...`, `telex.hu/podcasts/...`, `444.hu/podcast/...`, `index.hu/podcast/...`, `mandiner.hu/podcast/...`, `hvg.hu/360/...`, `klubradio.hu/musor/...`, `tilos.hu/episodes/...`
- Whitelist publisher-onként + URL-pattern, Firecrawl scrape markdown, mentés `episode_chunks` táblába `source='publisher_page'` címkével
- Költség: Firecrawl per page ~$0.0015 → 5000 ep ≈ $7.50 → **kb. 27 Supadata-credit ára egy 5000 epizódra szóló bővítés**

**B) YouTube videó-leírás *fejezetekkel* (chapters)** — már félig megvan
- Az 13 282 paired YT videó leírása már elérhető (clean_text v4+ytdesc óta), de a **chapter timestamp-eket nem külön extrahaljuk**
- Ezek pont a beszélgetés "miről szól mikor" jelei — embed-chunkba "Chapter @ 12:34 — Magyar Péter Tisza-pártról" formában
- Költség: **0** (lokális regex/parser), érték: chunk-search precíziós ugrás
- 1 SQL-job extracrol mindent, ETA 2 óra

**C) Apple Podcasts undocumented transcript endpoint**
- 2024 óta Apple generál auto-transcript-et (saját Whisperjével), megjeleníti a Podcasts.app-ban
- A `https://podcasts.apple.com/.../id<podcast_id>?...` HTML néha tartalmazza a transcript-tokent, vagy létezik a `transcript.apple.com` host
- **NEM dokumentált**, de a community már reverse-engineerelte: létezik `https://podcasts.apple.com/api/transcript/v1/...`
- Kockázat: ToS sértés / IP-ban / unstable
- **Javaslat:** próba-PoC 10 epizódon, ha működik és bírja a load-ot → ingyen tömeges transcript-forrás. Ha nem, dobjuk.

**D) Article ↔ Episode pairer kibővítése publisher-oldalakra**
- A jelenleg futó 5-outlet (Telex/444/HVG/Portfolio/Hold) pairer **csak a hír-cikk-podcast összerendelést csinálja**
- De a Telex-nek saját podcast-oldala is van **fent A) pontban** — más logikai pipeline, ugyanaz a Firecrawl-infra
- Egy generikus `publisher-page-scraper` runner mindkettőt kiszolgálja

---

## Javasolt sorrend (build módban)

1. **Most:** `rss-transcript-tag-audit` edge function + 1× futtatás (≤1 óra build idő, 0 költség)
2. **Most:** YT scout bump + pairer rescan_after_days lazítás (10 perc, 1 SQL)
3. **Eredmény-függő:** ha a (2) audit ad ≥100 transcriptet → `rss-transcript-importer` runner
4. **Külön kör:** Firecrawl publisher-page scraper PoC (telex.hu + partizan.hu, 100 ep, $0.15)
5. **Külön kör:** YT chapter-extractor (lokális parser, 0 költség)
6. **Opcionális PoC:** Apple Podcasts transcript reverse-engineering (high risk, high reward)

## Mit szeretnél most?

Plan-jóváhagyás után automatikusan elindítom az **1+2+5** lépést (alacsony kockázat, ingyen), majd külön döntünk a Firecrawl + Apple PoC-ról az audit eredmény láttán.