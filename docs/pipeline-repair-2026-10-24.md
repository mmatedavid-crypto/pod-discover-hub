# Pipeline repair 2026-10-24 (HU only)

Owner request: "Rendbe tudod hozni?" — new/changed RSS + verified YouTube/Spotify → clean
text → evidence-backed people/orgs/topics → current SEO + matching public page → real
indexability. `.com` untouched. No budget, cap or paid-service change. Cron 189 (paid person
review), 74 (legacy autopilot), Gemini paid trim and the one-off legacy AI review stay OFF.

All numbers below were measured on production on 2026-10-24 (UTC).

## Root causes found

| # | Problem | Cause |
|---|---------|-------|
| A | Best-source runner: 24× HTTP 546 `WORKER_RESOURCE_LIMIT`, 0 completions since 10-22 15:07; cron showed "succeeded" | `stripSentenceFooterTail` re-joined and re-scanned the tail for every cut point (O(n²)) on long newline-less transcript previews; a killed worker never reached ack/state, so 36 source-change items expired to dead. Cron success = dispatch only. |
| B | Clean-text changes never refreshed SEO/topics/entities | No link from `episode_clean_text` content to derived results; SEO enqueue only picked `ai_summary IS NULL`. |
| B2 | (review) SEO could be marked current for a newer text | First patch inferred the version from the first 200 chars of an old prompt. |
| B3 | (review) Races / failed writes | Marking read the live hash without a lock; SEO/entity writes ignored DB errors then marked current; topic insert failure still marked "done". |
| B4 | Every SEO run wiped evidence-based (v5) entities | SEO runner overwrote `people/mentioned/...` with unverified model output and reset `ai_entities_version` to 2/3 → a paid entity re-run each time. |
| B5 | Trailing newline counted as a content change | Fingerprint used `btrim` (spaces only) before whitespace normalization. |
| C | Topics "waiting" although clean text existed | Repair-queue writes never re-opened `waiting_clean_text`; D/E tier is outside the topic tier policy (stays blocked by policy, not hidden). |
| C2 | Person extractor rewrote ~600 episodes / ~800 people every 5 min with no change; overwrote role/evidence of already judged mentions; read an arbitrary 1 000 of 2 000+ topic aliases | No input change detection; unordered unpaged alias read. |
| D | Crawler HTML showed a 16k transcript excerpt; also dropped short fragments (e.g. a leading "Dr.") from the approved description | `get_episode_index_text` in prerender; sentence split + `length >= 30` filter. |
| E | Daily Google Indexing API submissions of episode/hub URLs; "0 impressions" treated as not indexed | Unsupported use (API is JobPosting/BroadcastEvent only). |
| H | Health snapshot falsely green/yellow and too slow for the browser | Read `episode_best_text_source_progress` (runner writes `_state`), exact `cleaner_method='deterministic_v4'`, cron dispatch as success, full sort of `cron.job_run_details`. |

## What changed

- `_shared/episode-text-cleaner.ts`: linear-time footer cut (identical decisions, regression test vs the old implementation).
- Best-source runner: durable run log (`pipeline_runner_runs`), stage timings, CPU-metered selection, kill detection → batch shrink → single-item isolation (`pipeline_item_blocks`), finite retry; 36 dead items re-queued once after the fix.
- Migrations `0078`–`0082`:
  - `episode_derivation_state` + trigger on real clean-text content change (attribution/whitespace-only = no work), bounded dispatch into the existing runners (`derivation_dispatch_controls`: 20/run, 300/day), policy blocks kept across changes.
  - `0080`: whitespace-safe fingerprint (stored hashes re-keyed, 0 mismatches after); `derivation_lock_decide_v1` (clean row FOR SHARE + state row FOR UPDATE); `apply_episode_seo_result_v1` / `apply_episode_entities_v1` / `apply_episode_topics_v1` (write + state in one transaction; older version never current, never overwrites a newer result; failure = no "done"); manual topic rows (`model IS NULL`) and `reclassified_from_person` org links kept; entity stage always queued in its own runner; person-extractor fingerprint table; runner-run health items.
  - `0081`/`0082`: fast cron lookup; light admin read `get_pipeline_runner_health_v1`.
- SEO: enqueue records `input_provenance` (text + hash from one DB read); runner uses a pre-built prompt only when its recorded version is still live, otherwise rebuilds; legacy prompts keep unknown freshness; no paid call when the live version is already current (superseded / same version).
- Person extractor: per-episode input fingerprint skip; judged mentions (`validation_source` set) never rewritten; all topic aliases read, ordered.
- Prerender: no transcript; body = approved public description (YouTube/Spotify via `get_episode_public_clean_description_v2` with source link) else RSS, every word kept.
- `google-indexing-submit`: safe no-op for old callers (cron 99, fetch-one, bible/zarándok pollers); `indexing_api_state.enabled=false`.
- Admin `/admin/queue-health`: "Feldolgozási lánc – valós futások" panel (real completions vs dispatch, 24h ok/error/killed, freshness by stage, intentional pauses).

## Evidence

- Best-source: 12 ok / 0 error / 0 killed tracked runs 12:50–15:07; `last_success_at` advancing (15:07); source-change queue 0 (36 dead recovered); 0 active item blocks.
- Original 20-episode sample (first `derivation:clean:*` batch): 20/20 live hash = state hash; SEO 20/20 current; topics 14 current + 6 not_applicable (clean text below topic minimum); entities 20/20 current with `entity_extraction_evidence.clean_hash` = live hash; 32 person and 26 organization evidence items. Person review: 20/20 `blocked` (paid tick paused). Mentions on these episodes: 23 pending (no review), 9 needs_review, 9 accepted from earlier reviews (ai/openai batch/direct), 1 rejected — nothing auto-accepted by this work.
- All 167 episodes dispatched today (RSS 48, Spotify 48, YouTube 71): entities 167/167 current at the live hash; SEO 156 current, 11 jobs pending in the normal queue; topics 89 current, 50 not_applicable/blocked by policy.
- Second runs: entity runner second call `processed 0, $0`; person extractor same window re-run `scanned 600, changed 0, skipped_unchanged 590` (10 not HU); dispatch second pass 0 rows (SQL test).
- Reviewed mentions kept by the extractor in the first new runs: 229 + 257 + 196 + 187.
- Race/failure tests (`scripts/test-derivation-state-sql.mjs`, real two-session PostgreSQL 16): clean-text update waits for an in-flight mark and then invalidates; a mark waiting on an uncommitted update is not current; failed write (guard) leaves the stage queued; empty topic result never "done"; manual topics + reclassified org links kept; same-200-char-prefix/different-end case never current.
- Crawler HTML (Googlebot UA, 3 live episodes): approved YouTube description present in full with source link, no transcript; RSS-only episode shows RSS text.
- Google Indexing: endpoint returns `submitted 0, skipped true`; sitemaps 200.
- Cost of this pass (normal runner budgets): entity $0.12, SEO $0.052, topic $0.018 for the whole day so far. No budget or cap changed.

## Remaining / blocked (not done)

- ~3 000 tracked episodes have stale derived results; they drain at the existing dispatch cap (300/day) and runner budgets. No completion date is promised.
- 626 topic rows awaiting first extraction and D/E-tier topics: blocked by the current tier policy (S/A/B/C); widening is an owner decision.
- Paid person relevance review (cron 189) paused by the owner: extracted evidence is recorded, the identity review is `blocked`; ambiguous/homonym links stay pending/needs_review.
- 8 800 older topic extraction errors were not re-run (would be a broad AI backfill).
- `count_pipeline_pending('entity_backfill')` (queue-health controller) counts differently from the runner's own selection, so the controller sometimes pauses/resumes the entity runner; a paused tick writes no run row.
- `get_pipeline_health_snapshot_v1` (verifier) still runs ~15–20 s because of catalog-wide counts; the browser uses the light read.
- Not supported in this pass: web enrichment, new paid services, re-embedding changed clean text, transcript use in public pages.
- Frontend (admin panel, earlier visitor description changes) needs a publish.
