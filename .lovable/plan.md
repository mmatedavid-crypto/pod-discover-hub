# AI model policy + clean_text + person-name search precision

Cél: a hátralévő backlog Lovable AI Gemini-n menjen explicit modellválasztással, a külső Google API path változatlan FREE_ONLY marad. Clean_text deterministic indul, chunk embed lassít. Person-name search szigorú exact-match lesz.

## Scope

NEM nyúlunk hozzá:
- `GEMINI_API_KEY`, `GEMINI_API_KEY_FREE` (külső direct Google API path változatlan)
- `person-relevance-judge` belső free→paid logika (most marad)
- bármi, ami közvetlenül a `googleapis.com` / `generativelanguage` URL-t hívja

Hozzányúlunk:
- `seo-enrich-runner` (episode SEO + entity backfill) → Lovable AI Gateway, model lock
- `categorize-podcast-runner` → Lovable AI Gateway, model lock
- `search-answer`, `search-suggest` → Lovable AI Gateway, model lock
- ÚJ: `episode-clean-text-runner` (deterministic, NO AI)
- `search-hybrid` / search RPC → person-name exact-match gate

## Modell-mátrix (kötelező, fallback TILOS Pro-ra)

| Job | Provider | Model | Retry (conf<0.75) |
|---|---|---|---|
| person-relevance-judge | KÜLSŐ Google direct (marad) | gemini-2.5-flash-lite | gemini-2.5-flash (1x) |
| categorize-podcast | Lovable AI | google/gemini-2.5-flash-lite | google/gemini-2.5-flash (1x) |
| seo-enrich (episode + entity) | Lovable AI | google/gemini-2.5-flash | — (Pro csak manual flagship) |
| search-answer | Lovable AI | google/gemini-2.5-flash | — |
| search-suggest | Lovable AI | google/gemini-2.5-flash-lite | — |

Hard rule: ha a kért modell nem elérhető (4xx/unsupported), STOP + log, NE menjen Pro-ra.

## 1. Edge function modell-lock

Mindegyik érintett edge function-ban:
- Konstans `MODEL_PRIMARY` és `MODEL_RETRY` a fenti táblából
- Eltávolítjuk a `google/gemini-3-flash-preview` és bármilyen `*-pro*` default-ot a batch ágon
- `app_settings.<runner>_controls.model` felülírja, de `MODEL_BLOCKLIST = ['*pro*','gemini-3*']` guard
- Max output tokens szigorú cap: classify=512, suggest=256, answer=900, seo=1200
- Retry csak ha `confidence<0.75` VAGY parse-error, csak 1x, csak a fenti retry modellre

## 2. Audit log

Új tábla `ai_call_audit`:
- job_type, provider ('lovable_ai' | 'google_direct'), model_used
- input_tokens, output_tokens, estimated_cost_usd
- prompt_version, source_hash, confidence
- status ('ok'|'error'|'low_conf_retry'), error_message
- created_at, target_type, target_id

Minden Lovable AI hívás után 1 insert (fire-and-forget). Google direct path kapja ugyanezt opcionálisan, de most nem kötelező.

`ai_spend_daily.by_kind` továbbra is frissül.

## 3. Clean text — deterministic v1

Új edge function `episode-clean-text-runner` + cron `*/10`:
- Bemenet: `episodes.description` (eredeti RSS, NEM nyúlunk hozzá)
- Szabályok:
  - reklám blokkok (Patreon/Buymeacoffee/Adverty/„Támogasd a csatornát" stb.) regex
  - ismétlődő subscription CTA-k (utolsó N karakterben sorismétlés detektálás)
  - social linkek (`facebook.com`, `instagram.com`, `tiktok.com`, `youtube.com/@`, `x.com/`, `twitter.com/`)
  - platform boilerplate („Hallgasd meg Spotify-on/Apple Podcasts-on…")
  - HTML strip, whitespace collapse
- Output: `episode_clean_text` táblába (létezik) → `cleaned_text`, `removed_categories[]`, `cleaner_method='deterministic_v1'`, `source_hash`
- Új oszlop `episodes.clean_text_status` (`pending|done|error|skipped`) + index
- NINCS AI hívás. AI cleanup később, ha minőség nem elég.

## 4. Chunk embed lassít

- `embed-episode-chunks` cron `*` → `*/15` amíg `clean_text_status='done'` < 50% epizódokon
- `controls.gate_on_clean_text=true`: csak akkor chunk-ol, ha clean_text kész
- Helyes sorrend: clean_text → chunk → embed

## 5. Person-name search precision

Probléma: „Burján Szilárd" → Pap Szilárd / Demeter Szilárd / „szilárdult" találatok.

Megoldás `search-hybrid` edge function-ben **person-name detector + strict gate**:
- Detektor: ha query 2+ token és mindkettő title-case (vagy egyezik `people.name` regex-szel), `is_person_query=true`
- Strict mód:
  - normalize(query) phrase keresés a következő mezőkben EXAKT, határos:
    - `episodes.people[]`, `episodes.mentioned[]`
    - `people.name` + `person_aliases.alias` (joined `person_episode_mentions`-ön át)
  - NINCS single-token fallback, NINCS FTS stemmer (`simple` config), NINCS vector fallback
  - Ha 0 találat → üres lista + `no_exact_person_match=true` flag a válaszban
- UI változatlan, csak más result set

Tesztek (manual):
1. „Burján Szilárd" → csak olyan epizódok, ahol a normalizált "burjan szilard" szerepel mentioned/people-ben vagy alias-on át
2. „Pap Szilárd" → ne keveredjen Burjánnal
3. „szilárdult" mint közönséges szó → NEM person query (csak 1 token + lowercase), normál hibrid keresés megy

## 6. Crons és cadence

- `seo-enrich-runner` marad adaptive, de modell lock
- `categorize-podcast-runner` marad adaptive, modell lock
- ÚJ: `episode-clean-text-runner` `*/10`
- `embed-episode-chunks` `*` → `*/15` (clean_text gate)
- `person-relevance-judge` változatlan free-first

## 7. Migrations

1. `ALTER TABLE episodes ADD COLUMN clean_text_status text DEFAULT 'pending'` + index
2. `CREATE TABLE ai_call_audit (...)` + RLS (admin write, public read)
3. `app_settings.episode_clean_text_controls` insert
4. `app_settings.lovable_ai_model_policy` insert (model-mátrix single source of truth)

## 8. Mit NEM csinálunk most

- Nem írunk Lovable AI clean_text-et
- Nem agresszívebb chunk-embed
- Nem nyúlunk person-relevance-judge belső modelljéhez (külső Google path)
- Nem teszünk Pro modellt batch ágba

## Technikai részletek

- `_shared/lovable-ai.ts` helper: `callLovableAI({ model, messages, maxTokens, jsonOnly, retryModel?, confidenceThreshold? })`, audit insert beépítve
- Minden runner ezen keresztül hív, hogy egy ponton érvényesüljön a blocklist + audit
- Modell-policy snapshot `app_settings.lovable_ai_model_policy.version` → audit `prompt_version` része

## Sorrend

1. Migrations (audit tábla, clean_text_status, settings)
2. `_shared/lovable-ai.ts` helper + blocklist
3. seo-enrich-runner, categorize-podcast-runner, search-answer, search-suggest átállítás + model lock
4. episode-clean-text-runner új + cron
5. embed-episode-chunks gate + cadence
6. search-hybrid person-name strict gate
7. QA: 3 person-name regression query + 1 batch run mindegyik runner-ből, audit ellenőrzés

Jóváhagyod? Ha igen, indítom a migration-okkel.
