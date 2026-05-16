## Cél

Magyar epizódok teljes hangos átirata Gemini preview modellel, ugyanazon a mintán mint az eddigi pipeline-ok (edge fn runner + adaptív cron + `app_settings` controls + `ai_spend_daily` budget + tier-prioritás).

## Architektúra (egy mondatban)

`stt-enqueue` → `ai_enrichment_jobs` (kind=`stt`) → `stt-runner` (drain loop) → Gemini audio in → `episode_transcripts` táblába írja. Minden gomb az `app_settings.stt_controls`-ból jön, így 0 deploy-jal váltható model / budget / batch.

## Komponensek

### 1. DB migráció — `episode_transcripts` tábla

```text
episode_id uuid PK
podcast_id uuid NOT NULL
model text NOT NULL          -- pl. google/gemini-3.1-pro-preview
language text                -- detektált, pl. 'hu'
transcript text NOT NULL     -- nyers szöveg
segments jsonb               -- opcionális: [{start, end, text}] ha a model adja
duration_seconds int
audio_bytes bigint
input_tokens int
output_tokens int
cost_usd numeric
content_hash text            -- audio_url + size hash → re-run guard
created_at, updated_at
```

RLS: admin write, public read (ugyanaz a minta mint `episode_embeddings`).
Indexek: `(podcast_id)`, `(model)`, `(created_at desc)`.

### 2. `app_settings.stt_controls` (egyetlen JSONB)

```json
{
  "enabled": true,
  "model": "google/gemini-2.5-flash",
  "daily_budget_usd": 5,
  "batch_size": 4,
  "concurrency": 2,
  "max_audio_mb": 25,
  "tiers": ["S","A"],
  "max_duration_min": 120,
  "skip_if_no_audio": true
}
```

Külön kis JSONB az A/B kísérlethez: `stt_pilot_overrides` (pl. 10 epizód `gemini-3.1-pro-preview` modellel, force enqueue).

### 3. `stt-enqueue` edge fn

- Kiválaszt tier-szűrve magyar epizódokat ahol nincs még `episode_transcripts` sor a kiválasztott `model`-re és van `audio_url`.
- Bulk insert `ai_enrichment_jobs` (`kind='stt'`, `target_type='episode'`, `input_hash = sha(audio_url|size|model)`, `priority` = tier-aware: S=100/A=80/B=60/C=40).
- Adaptív cron (`set_stt_enqueue_schedule` RPC, allowlist `*/5`,`*/30`,`0 * * * *`).

### 4. `stt-runner` edge fn (a kritikus rész)

Drain-loop egy invocation-ön belül (mint a `seo-enrich-runner`):

1. `claim_ai_jobs(kind='stt', limit=batch_size)` (meglévő RPC, ha kell, `kind` paraméteres változat).
2. Minden job-ra párhuzamosan (concurrency limit):
   - HEAD audio URL → méret check (skip ha > max_audio_mb).
   - GET audio → bytes.
   - Lovable AI Gateway hívás `generateContent`-tel, `inline_data: { mime_type, data: base64(audio) }` + system prompt:
     > "Te magyar nyelvű podcast átíró vagy. Add vissza a teljes átiratot tisztán, beszélő-tagolás nélkül, írásjelekkel. Soha ne fordíts. Soha ne foglald össze."
   - Költség kalkuláció a model token árából → `ai_spend_daily.by_kind.stt`.
   - `episode_transcripts` upsert (onConflict `episode_id,model`).
3. Daily budget guard a hurok elején (mint `seo-enrich-runner`).
4. `reap_ai_stale_locks(5min)` a futás végén.
5. Adaptív cron RPC (`set_stt_runner_schedule`, allowlist `*`,`*/2`,`*/10`,`*/30`).

### 5. Pilot mód (azonnal használható)

Admin oldal vagy egyszerű curl-rel:
```
POST /functions/v1/stt-runner?pilot=10&model=google/gemini-3.1-pro-preview
```
Beolvas 10 epizódot tier S-ből, force-run, **nem** ír cron-t, csak `episode_transcripts`-ot + logol egy összesítőt (átlagos cost, átlagos token, példa-átirat link). Így A/B-zhetsz model-ek között 1 invocation-nel.

### 6. Cron jegek

- jobid X: `podiverzum-stt-enqueue` — adaptív, default `*/30`.
- jobid Y: `podiverzum-stt-runner` — adaptív, default `*/10`.
- Mindkettő OFF-ról indul; te kapcsolod be amikor a pilot tetszik.

## Biztonsági / költség korlátok

- `incident-guard` import (fail-closed kill switch).
- `daily_budget_usd` hard stop a runnerben.
- `max_audio_mb` és `max_duration_min` filter, hogy ne futtassunk 4 órás videós feedeket.
- `tiers` allowlist — alapból csak S/A indul, B/C csak ha kifejezetten engeded.
- Re-run guard: `(episode_id, model)` unique → ugyanaz a model nem futhat újra véletlenül.
- Model váltás = új sor, nem felülírás → összehasonlítható marad.

## Technikai részletek

- Lovable AI Gateway endpoint: `https://ai.gateway.lovable.dev/v1/chat/completions`, header `Authorization: Bearer ${LOVABLE_API_KEY}`, body `messages: [{ role:'user', content:[{type:'text', text:'…'}, {type:'input_audio', input_audio:{data:base64, format:'mp3'}}] }]`. Ha a Lovable gateway nem támogatja az audio input modalitást egy adott modelre, fallback: direkt Google Generative Language REST `models/<model>:generateContent` hívás `GEMINI_API_KEY`-vel (akkor új secret kell — szólok).
- Tárolás: nem mentünk audio bytes-t, csak az átiratot.
- Sitemap / UI: ebben a körben **nem** publikáljuk a transzkriptet — csak DB-be megy, mint belső input további AI lépésekhez (summary v2, keresési highlight, key-moments).

## Mit építsek meg most

1. Migráció: `episode_transcripts` tábla + RLS + indexek + `app_settings.stt_controls` seed.
2. `stt-enqueue` edge fn (tier-szűrés, bulk upsert jobok).
3. `stt-runner` edge fn (drain loop, audio fetch, Gemini call, costing, upsert).
4. Adaptív cron RPC-k (`set_stt_enqueue_schedule`, `set_stt_runner_schedule`) — allowlistezve.
5. **Cron jobok OFF-on hagyva.** Te indítod kézzel egy 10 epizódos pilot-tal, és csak utána kapcsoljuk be.

## Mit NEM építek most (külön körben)

- Frontend admin UI (`/admin/stt`) — később, ha tetszik az eredmény.
- Post-correction réteg (entity-szótár + AI polish) — külön sprint.
- Transzkript-megjelenítés epizód oldalon — termékdöntés.
- Stripe-jellegű kvóta felhasználónként — nincs is felhasználói feature mögötte.

## Nyitott kérdések mielőtt nyomom

1. **Tárhely**: az átiratot tisztán szövegként mentem `episode_transcripts.transcript`-be (HU átlag ~6-12k karakter / epizód, ~100MB / 10k epizód — semmiség). OK?
2. **Pilot model**: első körben `gemini-2.5-flash` (olcsó baseline) **vagy** rögtön `gemini-3.1-pro-preview` (drága, csúcs minőség)? Javaslat: Flash baseline → ugyanazon az 5 epizódon Pro preview → összehasonlítás.
3. **Tier scope**: csak S/A induljon (~300 HU pod, becsült ~30-50k epizód), vagy mind S/A/B/C (~650 pod, ~528k epizód, **nagyságrendileg drágább**)?

Megerősítésed után létrehozom a migrációt, edge fn-eket, és futtathatsz egy 10 epizódos pilotot percek alatt.