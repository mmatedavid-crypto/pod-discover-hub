
## A) Jelenlegi AI-fogyasztók audit-táblázata (mai állapot)

Forrás: `app_settings`, runner import-graph, `ai_call_audit` 7 napos aggregáció.

| Cron / Function | Akt. | Provider ma | Model ma | Pending | Calls/nap | Becs. $/nap | Tier1-re? | Új model | Típus | Budget | Audit OK |
|---|---|---|---|---|---|---|---|---|---|---|---|
| seo-enrich-runner | ✅ | **direct (T1)** | gemini-2.5-flash-lite | 137 | ~200 ¹ | <$0.10 | — | flash-lite | incremental | $50 | ⚠ NULL cost |
| categorize-podcast-runner | ✅ | **direct (T1)** | gemini-2.5-flash-lite | 0 | ~50 | <$0.05 | — | flash-lite | batch | $20 | ⚠ NULL cost |
| person-relevance-judge | ✅ | **direct (T1)** | gemini-2.5-flash-lite | 0 | ~6k | ~$0.55 | — | flash-lite | incremental | $20 | ⚠ 7573 NULL/40k |
| entity-backfill-runner | ✅ | Gateway | google/gemini-3.1-flash-lite-preview ⚠ | 0 | incoming only | <$0.50 | **igen** | flash-lite | incremental | $5 | csak Gateway audit |
| entity-profile-runner | ✅ | Gateway | google/gemini-3.1-flash-lite-preview ⚠ | ~hub people | ≤15/run | <$0.20 | **igen** | flash-lite | batch | $3 | csak Gateway audit |
| episode-classifier-runner | ✅ | Gateway | (kódban) | ~ép. | ?? | ?? | **igen** | flash-lite | incremental | nincs ⚠ | nem ír T1 auditot |
| topic-candidates-runner | ✅ | Gateway | (kódban) | ?? | ?? | ?? | **igen** | flash-lite | batch | nincs ⚠ | nem ír T1 auditot |
| topic-judge-runner | ✅ | Gateway | (kódban) | ?? | ?? | ?? | **igen** | flash-lite | batch | nincs ⚠ | nem ír T1 auditot |
| embed-podcast-runner | ✅ | direct (Google fetch) | gemini-embedding-001 | ?? | ?? | <$0.10 | — | embedding-001 | batch | $2 | ⚠ saját audit, ellenőrzendő |
| embed-episode-runner | ✅ | direct (Google fetch) | gemini-embedding-001 | ?? | ?? | <$1 | — | embedding-001 | batch | $8 | ⚠ saját audit |
| embed-episode-chunks-runner | ❌ paused | direct | gemini-embedding-001 | gated | — | — | — | — | batch | $3 | clean_text gate |
| episode-clean-text-runner | ✅ | **nincs AI** (deterministic_v1) | — | 124k | — | $0 | nem | — | batch | n/a | n/a |
| stt-runner | ✅ pilot | direct fetch (Gemini audio) | google/gemini-2.5-flash | 4 batch | <$5 | <$5 | marad | flash | batch | $5 | ⚠ ellenőrzendő |
| ai-feed-scout | ✅ 4h | Gateway | (kódban) | n/a | 6/nap | <$0.05 | **igen** | flash-lite | batch | nincs | nem |
| ai-language-verifier / -queue | (idle) | Gateway | (kódban) | ?? | ritka | <$0.01 | **igen** | flash-lite | batch | nincs | nem |
| pi-language-recheck | (idle) | Gateway | (kódban) | ?? | ritka | <$0.01 | **igen** | flash-lite | batch | nincs | nem |
| person-ai-reviewer | (idle, hold) | Gateway | (kódban) | ?? | — | — | **igen** | flash-lite | batch | nincs | nem |
| person-bio-generator | ❌ hold | Gateway | (kódban) | — | — | — | nem indul | flash-lite (ha kérnek) | batch | nincs | nem |
| generate-category-seo | manuális | Gateway | (kódban) | — | manuál | <$0.01 | **igen** | flash-lite | user-trig | nincs | nem |
| generate-search-suggestions | manuális | Gateway | (kódban) | — | manuál | — | **igen** | flash-lite | batch | nincs | nem |
| daily-social-post | ✅ napi | Gateway | google/gemini-2.5-flash | n/a | 1/nap | <$0.01 | **igen** | flash | scheduled | nincs | nem |
| search-suggest | ✅ user-facing | Gateway | (kódban) | n/a | live | változó | **igen** | flash-lite, max 256 tok | **user-facing** | nincs ⚠ | nem |
| search-answer | ✅ user-facing | Gateway | (kódban, streaming) | n/a | live | változó | **részben** ² | flash, max 900 tok | **user-facing** | nincs ⚠ | nem |
| search-hyde (_shared) | ✅ search-időben | Gateway | (kódban) | n/a | live | változó | **igen** | flash-lite | user-facing | nincs | nem |
| search-understand (_shared) | ✅ search-időben | Gateway | (kódban) | n/a | live | változó | **igen** | flash-lite | user-facing | nincs | nem |
| youtube-channel-scout | ✅ 2h | Gateway | (kódban) | ?? | 12/nap | <$0.02 | **igen** | flash-lite | batch | nincs | nem |
| youtube-episode-pairer | ✅ 30min | Gateway | (kódban) | ?? | változó | <$0.10 | **igen** | flash-lite | batch | nincs | nem |
| ai-enrich (legacy) | (idle) | Gateway | (kódban) | — | — | — | leváltva seo-enrich-runner-rel | n/a | n/a | n/a |
| mood-collections-seed | manuális | direct (Google) | (kódban) | — | manuál | — | marad direct | flash-lite | one-off | nincs | nem |

¹ Aktuális `pending=137` egyszerre lemegy, utána új incoming epizódonkénti.
² Streaming + tool-call kombinációt érdemes mérni — első körben fázis-1 ellenőrzés direct API-val, **production lépés külön taskban**.

**Globális hiányosságok**
- `ai_call_audit.latency_ms` oszlop **hiányzik** — user kéri.
- Sok runner `estimated_cost_usd = NULL`-t ír (`google-gemini-direct.ts` nem hív `costFn`-t a 3 batch runner-ből, és a Gateway-runnerek többsége egyáltalán nem ír auditot).
- Nincs globális `ai_budget` settings rekord (`daily_cap_usd`, `pro_block`, `gemini3_block`, `audit_required`).
- Helyenként rossz model van bedrótozva: `entity_backfill_controls`, `entity_profile_controls`, `seo_enrich_controls` mind `gemini-3.1-flash-lite-preview` — politika szerint **csak 2.5** szabad.

---

## B) Mit viszünk Tier 1 direct Gemini-re

Háttér / incremental / batch (nem-felhasználói):
- entity-backfill-runner, entity-profile-runner
- episode-classifier-runner
- topic-candidates-runner, topic-judge-runner
- ai-feed-scout, ai-language-verifier(-queue), pi-language-recheck
- youtube-channel-scout, youtube-episode-pairer
- daily-social-post
- generate-category-seo, generate-search-suggestions, person-ai-reviewer, person-bio-generator (akkor is, ha most idle — refaktor most, hogy szabályos legyen)

Search (user-facing):
- search-suggest → Tier 1 direct, **`gemini-2.5-flash-lite`, max_tokens 256**
- `_shared/search-hyde.ts`, `_shared/search-understand.ts` → Tier 1 direct, flash-lite
- search-answer → **Phase 1 most**: Tier 1 direct non-streaming `gemini-2.5-flash`, **max_tokens 900**. Streaming visszaállítása későbbi fázisban, mérés után.

Embedding pipeline-ok már direct Google fetch-en mennek — **csak audit-bővítés** kell (per-call `ai_call_audit` row, `latency_ms`, `estimated_cost_usd` minden sorra).

---

## C) Mi marad a Gateway-en és miért

- **STT runner** (`stt-runner`): audio input + `gemini-2.5-flash`. A Gateway egységes audio billingje és kvótája miatt **marad** addig, amíg külön nem tesztelünk audio Tier 1-en. (Költség alacsony, pilot.)
- **mood-collections-seed**: one-off, manuális — érintetlen.
- **ai-enrich (legacy)**: nem hívja semmi cron — csak megjelölés "deprecated", új munkát nem küldünk rá.

Minden más Gateway-hívás megszűnik.

---

## D) Tervezett model-mátrix futás után

```text
Job                           Provider     Model                     Max tok
seo-enrich-runner             T1 direct    gemini-2.5-flash-lite     800
entity-backfill-runner        T1 direct    gemini-2.5-flash-lite     500
entity-profile-runner         T1 direct    gemini-2.5-flash-lite     800
episode-classifier-runner     T1 direct    gemini-2.5-flash-lite     400
categorize-podcast-runner     T1 direct    gemini-2.5-flash-lite     200
topic-candidates-runner       T1 direct    gemini-2.5-flash-lite     600
topic-judge-runner            T1 direct    gemini-2.5-flash-lite     400
person-relevance-judge        T1 direct    gemini-2.5-flash-lite     300
  - low-conf retry            T1 direct    gemini-2.5-flash          400
ai-feed-scout                 T1 direct    gemini-2.5-flash-lite     800
ai-language-verifier(-queue)  T1 direct    gemini-2.5-flash-lite     200
pi-language-recheck           T1 direct    gemini-2.5-flash-lite     200
youtube-channel-scout         T1 direct    gemini-2.5-flash-lite     500
youtube-episode-pairer        T1 direct    gemini-2.5-flash-lite     200
daily-social-post             T1 direct    gemini-2.5-flash          500
generate-category-seo         T1 direct    gemini-2.5-flash-lite     400
generate-search-suggestions   T1 direct    gemini-2.5-flash-lite     400
person-ai-reviewer            T1 direct    gemini-2.5-flash-lite     400
search-suggest                T1 direct    gemini-2.5-flash-lite     256
search-understand (_shared)   T1 direct    gemini-2.5-flash-lite     256
search-hyde (_shared)         T1 direct    gemini-2.5-flash-lite     256
search-answer                 T1 direct    gemini-2.5-flash          900
embed-podcast-runner          T1 direct    gemini-embedding-001      n/a
embed-episode-runner          T1 direct    gemini-embedding-001      n/a
embed-episode-chunks-runner   T1 direct    gemini-embedding-001      n/a (clean_text gate!)
stt-runner                    Gateway      gemini-2.5-flash          (audio)
```

---

## E) Becsült $/nap az átállás után (steady state, új epizód flow)

- Background incremental összesen (seo + entity + classifier + judge + topic + categorize + youtube + scout + language): **~$2–4/nap** (T1 olcsóbb, flash-lite mindenhol).
- Embeddings (új epizódok): **~$0.5–1/nap**.
- Search AI live (suggest + understand + hyde + answer): forgalom-függő, várhatóan **<$2/nap** korai forgalmon.
- STT pilot (S/A tier kis batch): **<$1/nap**.
- **Total target**: ~$5–8/nap, hard cap **$15/nap globális**.

Nem backlog futás. Ha valamelyik `pending`-szám felugrik, runner-szinten saját napi büdzsé limitál.

---

## F) ai_call_audit minta-séma + `latency_ms` mező

```sql
-- migráció: latency_ms hozzáadása
ALTER TABLE public.ai_call_audit ADD COLUMN IF NOT EXISTS latency_ms int;
CREATE INDEX IF NOT EXISTS idx_ai_call_audit_created_status
  ON public.ai_call_audit (created_at DESC, status);
```

Minden hívás kötelező sorai:
```
job_type, provider, key_source (meta.key_source), model_used,
input_tokens, output_tokens, estimated_cost_usd, prompt_version,
source_hash, confidence, status, error_message, latency_ms
```

A `google-gemini-direct.ts` `auditOnce()`-át kiegészítjük: minden esetben hív `costFn`-t (alapértelmezett: `ai-pricing.ts` `chatTokenCostUsd` vagy `embeddingTokenCostUsd`), és minden esetben mér `latency_ms`-t (`performance.now()` delta).

---

## G) Költségőrök (`app_settings.ai_budget`)

Új rekord:
```json
{
  "daily_cap_usd": 15,
  "per_job_caps_usd": {
    "seo_episode": 5,
    "entity_backfill": 2,
    "entity_profile": 1,
    "episode_classifier": 2,
    "categorize_podcast": 2,
    "topic_candidates": 1,
    "topic_judge": 2,
    "person_relevance_judge": 3,
    "search_suggest": 1,
    "search_answer": 2,
    "embed_episode": 3,
    "embed_podcast": 1,
    "stt": 2
  },
  "per_run_call_caps": {
    "default": 200,
    "search_suggest": 1,
    "search_answer": 1
  },
  "block_pro": true,
  "block_gemini3": true,
  "audit_required": true,
  "on_audit_missing": "throw",
  "max_error_rate_pct": 25,
  "on_error_burst": "pause_runner_and_notify"
}
```

Runner-szabály:
- Indulás előtt minden runner lekéri `app_settings.ai_budget`-et és a saját `*_controls.daily_budget_usd`-t, ÉS a `ai_spend_daily.by_kind`-ot a mai napra. Ha bármelyik túllépve → kilép `paused_budget` statussal.
- Ha utolsó 50 hívás hibaaránya > `max_error_rate_pct` → runner kilép, és a `*_controls.enabled = false`-t **nem** állítja, csak `last_run_status='error_burst_paused'`-t ír (admin dönt).
- A `google-gemini-direct.ts` `assertModelAllowed` már blokkolja a Pro/Gemini 3 mintázatot — **bővítjük** a Gateway helper-t ugyanezzel (jelenleg engedi a `gemini-3.1-flash-lite-preview`-t, mert csak `-pro`-t és `gemini-3-pro`-t tilt).

---

## H) Search AI szabályok (újrabekapcsolás)

- **Exact, multi-token személynév** keresésnél a deterministic match-elés első (élő RPC: `match_person_exact` / hasonló) — AI sem javasolja, sem nem rakja át. (Már implementálva — verifikáljuk, nem módosítjuk.)
- AI csak **magyarázni** és **újrarendezni** szabad, soha **újat találni**.
- `search-suggest`: short flash-lite hívás (max 256 token), kemény 800 ms timeout, hiba esetén UI csendben üres suggestion-t mutat.
- `search-answer`: flash, max 900 token, kemény 5 s timeout. Csak a már kiválasztott találatokról ír összegzést, **nem hív vissza új keresést**.
- Query understanding `_shared/search-understand`: flash-lite, használhat `entity_profiles` + `people` táblát, de Wikidata külső hívást nem indít.
- Role semantics: prompt sablon hozzáférhet a `role_type` (participant/subject/mention) értékhez, és a magyarázatban így fogalmaz: „Orbán Viktor megszólalása", „Trump-ról szóló epizód", „Musk említése" — a `_shared/search-explain.ts`-be központosítva.

---

## I) Mi NEM indul el ebben a sprintben

- `clean_text` AI változat — marad `deterministic_v1`
- `embed-episode-chunks-runner` — clean_text gate alatt (~7% / 50% kell)
- Person bios (Wikipedia/Wikidata) — külön jóváhagyás
- VG/news-site ingestion
- Bármilyen teljes historikus reprocess
- `ai-enrich` legacy ébresztése
- `person-bio-generator` automatizálás

---

## J) Munkafázisok (ebben a sorrendben hajtom végre, jóváhagyás után)

1. **DB migráció**:
   - `ai_call_audit.latency_ms` hozzáadása + index
   - `app_settings.ai_budget` insert
   - `app_settings` rossz model értékek javítása: entity_backfill / entity_profile / seo_enrich → `gemini-2.5-flash-lite`
2. **`_shared/google-gemini-direct.ts` bővítése**:
   - Mindenkit `latency_ms`-szal auditál
   - Mindig hív `costFn`-t (default = ai-pricing)
   - Új `runWithBudget()` wrapper: spend gate + error-rate gate
3. **`_shared/lovable-ai.ts` blokklist-bővítés**: tilt `gemini-3.*` is, ne csak `-pro`
4. **`_shared/gemini-batch.ts` portoló helper** új közös tool-call wrapper (a Gateway tool-call sémát Google native generateContent-re fordítja). Egyszer írom meg, runnerek hívják.
5. **Runner migráció** (külön commit / runner):
   - entity-backfill-runner
   - entity-profile-runner
   - episode-classifier-runner
   - topic-candidates-runner, topic-judge-runner
   - ai-feed-scout
   - ai-language-verifier(-queue), pi-language-recheck
   - youtube-channel-scout, youtube-episode-pairer
   - daily-social-post
   - generate-category-seo, generate-search-suggestions
   - person-ai-reviewer, person-bio-generator (marad idle, de Tier 1-re átírva)
6. **Search runner-ek**: search-suggest, search-hyde, search-understand → Tier 1 direct. search-answer Phase 1 (non-streaming Tier 1).
7. **Embedding runner-ek**: hozzáadunk `ai_call_audit` írást per batch (most nem mind ír).
8. **Verifikáció**:
   - `ai_call_audit` SELECT: minden új sornak van `estimated_cost_usd` ÉS `latency_ms`
   - search-suggest, search-answer curl: válasz < timeout, audit sor megjelenik
   - `ai_spend_daily.by_kind` darabszáma az új job_type-okkal nő

---

## K) Final report szállítás

Lépés végén küldök:
- A. AI consumer audit tábla (előtte / utána)
- B. T1-re átállított függvények listája
- C. Gateway-en maradt függvények és indok
- D. Model mátrix
- E. Becsült napi költség (steady state)
- F. `ai_call_audit` minta 10–20 sor a 12 főbb job_type-ra
- G. Search AI verifikációk (3 query: ténykeresés, személy, magyarázat)
- H. Tiltott / fagyasztott job-ok listája

---

## L) Mit kérek tőled jóváhagyásra mielőtt elindítom

1. Egyetértünk-e az **$15/nap globális hard cap**-pel?
2. **search-answer**: Phase 1 most **non-streaming** Tier 1-re menjen, vagy hagyjuk a Gateway-en streaming-gel, és csak a többi felé fókuszáljunk?
3. Indítsam-e azonnal a **Step 1 (migráció)** + **Step 2-3 (közös helper-ek)** azonnal és utána egyeztessünk a runner-migráció pontos sorrendjéről, vagy az egész J fázist hajtsam végig egy menetben?
