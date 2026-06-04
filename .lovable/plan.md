## Spotify auto-transcript scraping — ez a "jól gondolkodás"

### Mit néztél te a Telex Afterben?
A **Spotify app saját auto-generált felirata** — nem RSS-ből jön, nem az Anchor-ból, hanem maga a Spotify generálja **2024 eleje óta minden Spotify Podcasters/Anchor-hosztolt show-ra automatikusan**. Ezt a Supadata, RSS audit, YT-caption pipeline **mind nem látja**, mert a Spotify saját zárt rendszerében van.

### Miért érdekes
- **45 908 HU epizódnak már megvan a `spotify_episode_id`** (`episode_spotify_meta` táblában, a 2026-05-28-i Spotify-drain óta)
- 771 / 1446 HU podcastunk Anchor/Spotify/Megaphone-hosztolt → ezek **mindegyikére várhatóan generál transcript-et a Spotify**
- A Spotify Web Player **dokumentálatlan, de stabil** privát endpointján keresztül ezek lekérhetők: `spclient.wg.spotify.com/transcript-read-along/v2/episode/{id}`
- Anonymous access token: `open.spotify.com/get_access_token` → 1 órás Bearer token, IP-alapú
- **0 Ft, 0 Supadata credit**
- Konzervatív tipp hit-rate-re: **30-50% (~14k-22k transcript)** — minden Anchor-hosztolton hit, RSS-only kiadóknál (Libsyn/Buzzsprout/Omny stb.) nincs

### Kockázatok
| Kockázat | Súly | Mitigáció |
|---|---|---|
| Spotify ToS sértés (unauthorized API) | Közepes | Per-show throttle (1 req/sec), User-Agent rotáció, kis volumen indulásnál |
| IP-ban / 429 / 403 | Közepes | Cloudflare worker proxy front (már van!), exponential backoff, runner auto-pause |
| Endpoint változás (a reverse-engineered URL meghal) | Alacsony | Pipeline-watchdog észreveszi (error rate ↑), versionezett URL string egy helyen, könnyen javítható |
| Geo-block | Alacsony | Supabase edge functions EU-ban futnak, ami Spotify-nak OK |

### A terv

#### Fázis 1 — PoC (1-2h build, 0 Ft)
1. Új edge function `spotify-transcript-poc`:
   - Spotify anon access token grab
   - 20 véletlen Telex After / Telex Podcast / Partizán Anchor-hosztolt ep-en kipróbál
   - Visszaadja: per-episode `{has_transcript, status_code, language, char_count, sample_segments[3]}`
   - **Nem ír semmit DB-be**, csak diagnosztika
2. Egyszeri manuális futtatás → kiderül a hit-rate és a formátum
3. Döntés: ha hit-rate ≥20%, megy Fázis 2; ha alacsonyabb, dobjuk

#### Fázis 2 — Production runner (ha PoC jó, +3-4h build)
4. `spotify-transcript-runner` edge function:
   - Tier-prioritást követi (S=100, A=80, B=60)
   - Per-run: 25 ep, 1 req/sec rate-limit, batch token refresh
   - Sikeres fetch → `episode_transcripts(model='spotify-native', language, transcript, segments)` insert
   - 404 → `app_settings.spotify_transcript_skip` listára (don't retry)
   - 429/403 → exponential backoff + auto-pause via pipeline-watchdog
5. Új cron job `*/5 * * * *`, indulás `enabled=false`, manuális kapcsoló admin felületen
6. Új `app_settings.spotify_transcript_controls`: `{enabled, batch, delay_ms, daily_cap, paused_at, paused_reason}`
7. Pipeline-watchdog registry-be felvenni (cost=0, csak error-rate és liveness alapján auto-pause)
8. Queue-health-controller-be felvenni (auto-pause/resume pending alapján)

#### Fázis 3 — Downstream beillesztés (ingyen, automatikus)
9. `episode-clean-text-runner` updateje: ha van `spotify-native` transcript ÉS hossza > yt_desc/rss → előnyben részesít (`cleaner_method='spotify_native'`)
10. `embed-episode-chunks-runner` automatikusan újrachunkol minden új transcript-tel rendelkező ep-et
11. `entity-backfill-runner` újrafutása ezeken az ep-eken (~13-22k drain ~6-12h, $3-5)

### Mit nyerünk
- **Search-pool drasztikus növelés**: 135k chunk → várható +200k-400k chunk
- **Entity precision**: jelenleg sok ep-nél csak címből/leírásból van entity → transcript-ből 10-50x annyi mention
- **Topic discovery**: bottom-up extractor (cron 54) sokkal pontosabb mintát kap
- **Person mentionek**: Magyar Péter, Karácsony, Orbán stb. nem-cím epizódokban is felbukkannak

### Sorrend (jóváhagyás után)
1. **Most:** `spotify-transcript-poc` edge function build + futtatás 20 ep-en (15 perc)
2. **Eredmény alapján:** Fázis 2 build (ha hit≥20%)
3. **Külön döntés:** RSS importer (a 173 ingyen transcripthez) és YT chapter-extractor megy-e párhuzamosan vagy később

Megyek a PoC-val?