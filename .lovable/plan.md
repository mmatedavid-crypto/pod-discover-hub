## Cél

External transcript ingest PoC RSS-audio ASR-rel. **Nincs yt-dlp, nincs YouTube caption scrape, nincs Spotify content ingest.** YT/Spotify max metadata-matching és public RSS link feloldására.

## Architektúra (változatlan elv)

```text
Python worker (laptop / VPS)
  │ Authorization: Bearer EXTERNAL_TRANSCRIPT_TOKEN
  │
  ▼
edge function: external-transcript-ingest
  ├─ GET  /?claim=N          → következő RSS-audio jobok
  ├─ POST /                   → transcript + segments upload
  └─ audit row (source, model, latency_ms, cost_usd, status)
  │
  ▼
public.episode_transcripts  +  public.external_transcript_audit
```

## Hard stops (kódba égetve)

- Worker csak `audio_url` (RSS) forrást fogadhat. `youtube_video_id` mező a job válaszból kihagyva.
- Worker `User-Agent: PodiverzumTranscriptWorker/0.1 (research; contact: hello@podiverzum.hu)`.
- Edge function elutasít minden POST-ot ahol `source != 'rss_audio_asr'`.
- `public_display` mindig `false` a PoC alatt.
- Nincs cron, nincs `auto_loop` default, batch hard-limit 20.

## Schema változás (egy migráció)

1. `episode_transcripts` új oszlopok:
   - `source text` (`rss_audio_asr` | `rss_native` | `manual`)
   - `rights_status text` default `'rss_public_index_only'`
   - `public_display boolean` default `false`
   - `latency_ms integer`
   - `status text` default `'ok'` (`ok` | `failed` | `skipped`)
   - `error_reason text`
2. Új tábla `public.external_transcript_audit`:
   - `id`, `episode_id`, `model`, `source`, `status`, `error_reason`, `latency_ms`, `cost_usd`, `audio_bytes`, `duration_seconds`, `worker_id`, `created_at`
   - GRANT service_role only; RLS deny all auth.
3. Index: `episode_transcripts(episode_id)` ahol `status='ok'`.

## Edge function (`supabase/functions/external-transcript-ingest/index.ts`)

Átírás (a meglévő file lecserélődik):

- Auth: `Authorization: Bearer <EXTERNAL_TRANSCRIPT_TOKEN>` (a régi `x-ingest-token` megszűnik, csak Bearer).
- `GET ?claim=N` (max 20): HU, tier ∈ {S,A}, `audio_url IS NOT NULL`, nincs `episode_transcripts.status='ok'` sor. Válasz: `episode_id, podcast_id, title, audio_url, duration_seconds`. **YT mezők nincsenek.**
- `POST`:
  - body: `{ episode_id, transcript, segments?, model, language, duration_seconds, audio_bytes, latency_ms, cost_usd, source, status, error_reason? }`
  - whitelist: `source ∈ {rss_audio_asr}`, különben 422
  - `status='ok'` esetén upsert `episode_transcripts` `(episode_id,model)`-re, `public_display=false`, `rights_status='rss_public_index_only'`
  - mindig insert `external_transcript_audit`
- `OPTIONS` CORS, minden hiba JSON.

## Python worker (`scripts/rss-asr-worker.py`)

- Régi `yt-asr-worker.py` **törlés** (`rm`).
- `requests` + `faster-whisper` + `ffmpeg`. **`yt-dlp` import tiltva.**
- Folyamat per job:
  1. `audio_url`-t HEAD/GET-tel letölti `requests.stream`-mel temp fájlba (max 500 MB, timeout 600s).
  2. ffmpeg-gel mono 16 kHz wav (subprocess).
  3. `faster-whisper large-v3-turbo` HU, VAD-filter, segmentek megőrizve.
  4. POST transcript + segments + latency_ms + audio_bytes + `source='rss_audio_asr'`.
  5. Hiba esetén POST `status='failed'` + `error_reason`.
- ENV: `PODIVERZUM_URL`, `INGEST_TOKEN`, `WHISPER_DEVICE`, `WHISPER_COMPUTE`, `BATCH=20` (hard cap), `WORKER_ID`.
- Nincs `LOOP`, egyetlen batch fut, aztán exit. (Cron explicit jóváhagyás után.)

## PoC scope

- 20 ep, HU, tier S/A, `audio_url IS NOT NULL`.
- Lokálisan (laptop CPU int8) vagy egyszerű Hetzner CX22.
- Riport: hit rate, átlag audio hossz, ASR sebesség (RTF), karakter/ep, becsült cost/ep (csak áram).

## Setup parancsok (worker gépen, egyszer)

```bash
python -m venv .venv && source .venv/bin/activate
python -m pip install -U requests faster-whisper
# ffmpeg: brew install ffmpeg  |  apt-get install -y ffmpeg
export PODIVERZUM_URL='https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/external-transcript-ingest'
export INGEST_TOKEN='<paste from Lovable Cloud secret form>'
export WORKER_ID="$(hostname)-poc"
python scripts/rss-asr-worker.py
```

## Várható eredmény (sample table — kitöltjük futás után)

| metrika | érték |
|---|---|
| jobs claimed | 20 |
| ok | ? |
| failed (404 / timeout / non-audio) | ? |
| avg audio min | ? |
| ASR RTF (CPU int8) | ~0.3–0.6× |
| avg chars/ep | ? |
| cost/ep (áram) | ~$0.01 |

## Költség/idő becslés (RSS audio ASR, faster-whisper large-v3-turbo)

CPU (Hetzner CX22, int8, ~0.5× realtime, átlag 45 perc/ep):

| scope | gép-óra | költség (€4/hó VPS arányosítva + áram) |
|---|---|---|
| 1k ep | ~375 h | ~€2 VPS + ~€8 áram = ~€10 |
| 10k ep | ~3750 h (5 hét 1 gépen vagy 1 hét 5 gépen) | ~€20 VPS + ~€80 áram = ~€100 |
| 50k ep | ~18750 h (10 gép × ~11 nap) | ~€500 |

GPU (RunPod A10G ~5× realtime, $0.39/h):

| scope | GPU-óra | költség |
|---|---|---|
| 1k ep | ~150 h | ~$60 |
| 10k ep | ~1500 h | ~$585 |
| 50k ep | ~7500 h | ~$2 925 |

Cloud Whisper API (Groq distil-whisper $0.02/h) — összehasonlításra:

| scope | költség |
|---|---|
| 1k ep | ~$15 |
| 10k ep | ~$150 |
| 50k ep | ~$750 |

PoC után döntés: lokális CPU drain vs Groq API.

## Files

- **módosítás**: `supabase/functions/external-transcript-ingest/index.ts` (Bearer auth, RSS-only, audit insert, no YT fields)
- **új**: `scripts/rss-asr-worker.py`
- **törlés**: `scripts/yt-asr-worker.py`
- **migration**: `episode_transcripts` új oszlopok + `external_transcript_audit` tábla + index

## Required secret

- `EXTERNAL_TRANSCRIPT_TOKEN` (backend only) — generálom én vagy `openssl rand -hex 32`, te bemásolod a Lovable Cloud secret űrlapba.

## Riport (futás után küldöm)

- files changed (lista)
- schema diff (migráció SQL)
- env vars (lásd fent)
- setup parancsok (lásd fent)
- 20-ep sample table feltöltött metrikákkal
- frissített 1k/10k/50k költségbecslés a mért RTF alapján

## Mi marad ki tudatosan

- yt-dlp, YouTube caption fetch, Spotify audio/preview ingest, Spotify private endpoint — egyik sem kerül be.
- Cron, autopilot, public display, full-transcript SEO — csak explicit külön jóváhagyással később.
