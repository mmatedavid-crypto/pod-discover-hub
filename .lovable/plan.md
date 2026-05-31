
# Cél
A teljes HU katalógusra (136 646 epizód) tudjuk:
1. van-e YouTube-párja,
2. van-e ott erősebb description, mint az RSS-ben,
3. van-e natív (felirat-alapú) YouTube transcript,
4. és a natív transcripteket olcsón beszívjuk (Supadata 30k credit/hó keret).

# Jelenlegi állapot (élő DB lekérés)

| Mutató | Érték |
|---|---|
| HU epizód összesen | 136 646 |
| Van YT-link sor (bármilyen) | 25 267 (18%) |
| **Soha nem volt YT-keresés** | **111 001** (180 napon belüli: 12 716, 365 napon belüli: 22 958) |
| Confirmed YT-pár | 8 067 |
| ↳ caption ellenőrizve, van | 75 |
| ↳ caption ellenőrizve, nincs | 5 286 |
| ↳ caption még ismeretlen | 2 706 (drain folyamatban) |
| episode_transcripts összesen | 230 (213 supadata + 17 STT) |
| YT-desc érdemben hosszabb mint RSS-desc | 1 614 / 8 021 (20%) |

# A négy fázis

## Fázis 1 — Pairing-coverage: a 111 001 „még sosem nézett" HU epizód

A `youtube-episode-pairer` ma csak az újonnan érkező / hiányzó párokat dolgozza fel. Ki kell terjeszteni teljes back-catalog drainre.

- Új `yt_pair_backlog_cursor` (app_settings) cursor: `published_at DESC`-sorrendben halad végig a HU epizódokon, amelyekre nincs `episode_youtube_links` sor.
- A meglévő pairer logikát (RSS-podcast → YouTube-csatorna match → fuzzy episode match) hívja, batch 50/run, cron `*/10`.
- Új epizódokra a meglévő `incremental` ág fut tovább változatlanul.
- Becslés: 111k ep / 50 = ~2 220 run ≈ 15 nap drain. **YouTube Data API quota: ~0** (csak `search.list` 100 unit/keresés — ezért podcast-szintű csatorna-cache kell, hogy ne keressünk csatornát újra → egy podcastnál egy `search.list`, utána olcsó `playlistItems.list` 1 unit). Napi 10 000 quota bőven elég.
- Whitelisting: csak olyan podcastokat húzunk be, ahol legalább 1 confirmed pár már létezik, vagy van YouTube-csatorna a podcasts.rss-ben — különben sok zaj.

## Fázis 2 — Caption-check minden új és meglévő párra

- A folyamatban lévő `youtube-caption-backfill` lezavarja a maradék 2 706 unchecked sort (~2 órán belül kész).
- A `youtube-episode-pairer` minden új pároláskor azonnal írja a `youtube_caption_available`-t (már megvan a memóriában rögzítve).
- Egységes adaptív cron: amíg `caption_unchecked > 200` → caption-backfill `*/5`, alatta `0 */6`.
- Quota: `videos.list?part=contentDetails` 1 unit / 50 video → elhanyagolható.

## Fázis 3 — Erősebb YouTube description felhasználása

Új `episode_clean_text` input-prioritás (a clean-text-runner-ben):
1. ha van `episode_transcripts.transcript` → az nyer,
2. különben ha `length(yt_description) > 1.5 × length(rss_description) + 200` ÉS `length(yt_description) ≥ 400` → YT desc nyer,
3. különben RSS desc.

Csak a clean-text-runner inputját módosítjuk; az `episodes.description` (RSS forrás) érintetlen marad. Becslés: ~1 600 epizódnak azonnal jobb clean_text-je lesz, később (pairing drain után) várhatóan 8–12 000.

## Fázis 4 — Natív transcriptek költséghatékony feldolgozása

Supadata = 1 credit / transcript, 30 000 credit / hó keret, ~$0.0005 / credit.

Várható volumen a teljes pipeline futása után:
- Pair coverage 18% → 60–70%: confirmed_links ~8k → **~50 000**.
- Ebből caption_available historikus arány 15–20%: **~8–10 000** új natív transcript.
- One-off költség: **~$5**.
- Folyamatos havi delta (új HU epizódok): ~3 000 ep/hó × 60% pair × 18% caption = ~325 transcript/hó → ~$0.20/hó.

**Olcsóság-szabályok a transcript-runner-ben (már megvannak, megerősítjük):**
- csak `youtube_caption_available=true` rekordokra fut (`require_youtube_caption_available=true`),
- per-podcast napi limit: max 100 transcript (egy zajos podcast ne falja fel a keretet),
- napi globális limit: 1 200 transcript/nap (= havi ~36k, de szándékosan a 30k credit alatt = ~1000/nap),
- ha `youtube_transcript_attempts` 7 napon belül `no_captions` vagy `error` → skip,
- adaptív cron: `pending>500` → `*/10`, `100–500` → `*/30`, `<100` → `0 * * * *`,
- pipeline-watchdog auto-pause budget túllépésnél (már él).

# Mit építünk ebben a körben

1. **Pair-backlog mód a `youtube-episode-pairer`-ben** — új `mode=backlog` ág + cursor + cron jobid 20 mellé új jobid `*/10` HU backlogra (vagy a meglévő ütemezést bővítjük).
2. **Caption-check beépítése a pairerbe** — már megvan, csak megerősítjük log-szinten hogy minden új sornál fut.
3. **Clean-text-runner desc-prioritás patch** (Fázis 3).
4. **Adaptív cron RPC** a caption-backfillre és transcript-runnerre (`set_youtube_caption_backfill_schedule`, `set_yt_transcript_runner_schedule`).
5. **Admin felület bővítése** a `/admin/youtube-pairing`-en: új mutatók (pair coverage %, caption coverage %, transcript coverage %, várható havi költség).

# Memória és kockázat

- YouTube Data API napi 10 000 quota — backlog batchet úgy méretezzük, hogy alatta maradjunk.
- Supadata 30k credit/hó — drain alatt is ~1 000/nap cap → soha nem fut ki.
- Pipeline-watchdog (`yt_transcript_runner_controls`) automatikusan pause-olja, ha napi budget × 1.1 átlépés van.
- Backlog drain közben SEO / homepage MV-eket nem érinti, csak a clean-text input minőségét javítja.

# Egy mondatos összegzés
~111k HU epizód maradt érintetlen YT-keresés szempontjából; ha végigfut a pairing- és caption-check drain, ~8–10k natív transcriptet kapunk egyszeri ~$5-ért, utána havi ~$0.20-ért tartjuk karban — közben a 20%-nyi erősebb YT description automatikusan beépül a clean_text-be.
