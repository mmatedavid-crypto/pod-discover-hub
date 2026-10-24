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
- 626 tracked episodes have no topic extraction yet (in the normal topic queue, or outside the S/A/B/C tier policy); D/E tiers stay excluded unless the owner widens the policy.
- Paid person relevance review (cron 189) paused by the owner: extracted evidence is recorded, the identity review is `blocked`; ambiguous/homonym links stay pending/needs_review.
- 8 800 older topic extraction errors were not re-run (would be a broad AI backfill).
- `count_pipeline_pending('entity_backfill')` (queue-health controller) counts differently from the runner's own selection, so the controller sometimes pauses/resumes the entity runner; a paused tick writes no run row.
- `get_pipeline_health_snapshot_v1` (verifier) still runs ~15–20 s because of catalog-wide counts; the browser uses the light read.
- Not supported in this pass: web enrichment, new paid services, re-embedding changed clean text, transcript use in public pages.
- Frontend (admin panel, earlier visitor description changes) needs a publish.

## Follow-up 2026-10-24 15:15–15:35: homonym person links in recommendations

Bug (verified live): the Aranyklinika urologist episode recommended a Hermann Zeneiskola
music-director episode and a chamber-music episode with "Kapcsolódó személy: Király István".
Person `kiraly-istvan`: accepted reviewed link only on the urology episode; the namesake
links are `pending` (no review).

Root causes: raw `people[]`/`mentioned[]` display names bridged, scored and explained
recommendations in `similar_episodes`, `get_related_episodes_by_embedding`, the
RelatedEpisodes fallback (name `overlaps` probe + reason), SimilarEpisodes and
`recommendationGuards`; episode pages (SPA + crawler) linked/emitted Person JSON-LD by name
match or any mention row (incl. rejected); person pages showed unreviewed rows as
participants (crawler page also showed rejected rows); "A Podiverzum szerint" person chips
linked by guessed slug. Separately `smart_player_discover` always failed ("episode_id is
ambiguous"), so the player fell back to unrelated recent episodes.

Fix (migrations `0083`, `0084`, prerender `a2de5367…`, frontend):
- `person_link_trusted_v1` / `verified_episode_person_ids_v1` / `verified_person_overlap_v1`:
  a shared person = same canonical id with accepted + reviewed (`validation_source`) links on
  both episodes, trusted identity (not merged/split, not ambiguous unless manual, not hidden).
- Recommendation RPCs use only verified overlap for bridge/score/reason; topics/companies/
  category unchanged. `smart_player_discover` person hits require the same trust; ambiguity fixed.
- `get_shared_verified_people_v1` feeds fallback probes/reasons and the client guard;
  `recommendationGuards` ignores raw names (bridge, score and grouping).
- `get_episode_person_links_v1`: episode person links never rejected/needs_review; an
  unreviewed namesake is never attached to a person who has verified links elsewhere;
  Person JSON-LD / `about` only for verified links; unlinked person names are plain text.
- Person pages (`_shared/person-link-trust.ts`): rejected/needs_review hidden; unreviewed rows
  only under "Említések", never participant/subject.
- Health: `runner_pause_reason_v1` reports kill switch, controls pause (incl. queue-health
  auto pause), quota cooldown and daily budget as `paused`; derivation freshness is `paused`
  when the daily dispatch cap is reached with nothing queued; red stays for queued work not
  completing or dispatch stopping below the cap (checked in a rolled-back transaction).

Evidence: urology episode (preview) box now shows only shared-topic urology episodes, no
person reason; music-director episode: 0 links to `/szemelyek/kiraly-istvan`, no Person
JSON-LD (live crawler HTML too); person page: urology episode under participants, namesakes
only under "Említések"; verified same-person case (Magyar Péter) still returns
"Kapcsolódó személyek alapján." (RPCs 20–30 ms; discover 360 ms). No person split/merge and
no review decision was changed.

Follow-up (`0087`, prerender `26f611ba…`): a review record = non-blank trimmed
`validation_source` in SQL and TS; episode-card person chips resolve per episode in one
batched `get_linkable_episode_people_v1` call; a person verified anywhere
(`person_has_verified_link_v1`) no longer lists same-name unreviewed episodes at all (visitor
and crawler page; DB review rows unchanged). Live: `/szemelyek/kiraly-istvan` crawler HTML has
0 Hermann/Kamarazene/IoT episodes, urology episode kept as participant. People without any
verified link still list unreviewed rows as mentions only.

## Catch-up mode 2026-10-24 15:32 UTC (owner-approved, max 24 h)

Started with `start_pipeline_catchup_v1(24)`; state, old/new values and restores in
`app_settings.pipeline_catchup_state`; health item `catch_up` on `/admin/queue-health`.

| Setting | Normal | Catch-up |
|---|---|---|
| derivation dispatch daily cap | 300 | 5000 (SQL hard max 5000) |
| derivation dispatch per run | 20 | 60 (SQL hard max 60; caller default now 60, stored value decides) |
| SEO enqueue cron (job 5) | */15 | */5 |
| YouTube re-clean daily / per run | 150 / 10 | 1000 / 15 (code max 1000 / 25) |
| Spotify re-clean daily / per run | 20 / 3 | 500 / 10 (code max 500 / 20) |

Unchanged: money budgets (SEO $40, entity $40, topic $30), AI concurrency, source batch 40 +
CPU budget/isolation, clean-text repair caps, topic tier S/A/B/C, quality/identity/protected
gates, cron 189/74 off, runner crons (still tuned by queue-health-controller).

Expiry/restore: one-shot cron `pipeline-catchup-expiry` (2026-10-25 15:33 UTC) and every
dispatch call run `pipeline_catchup_tick_v1`; the derivation group restores as soon as nothing
is eligible, everything at expiry. A value changed after start is kept (`kept_changed_value`);
`end_pipeline_catchup_v1()` ends it early. Rehearsed in a rolled-back transaction (restore +
kept owner change + expiry job removed).

Fixes found while running it: the dispatcher's row-by-row writes took 6.8 s for 60 episodes and
hit the API statement timeout → set-based (2.9 s incl. selection, `0086`), serialized with an
advisory lock; the topic runner re-queued ~140 promoted-but-empty clean texts every run
(waiting ↔ pending) → empty/short promoted text is final `not_applicable`.

Measured 15:32 → 15:39 (2 manual rounds + cron): eligible stale 2 962 → 2 883 (re-cleans add
new stale rows); entity current 203 → 343, SEO current 186 → 323, topic current 115 → 237;
dispatched today 240 → 420; SEO run 141 processed (137 ok, 4 failed on the HU language guard),
entity run 140/140, topic runs 122 + 64 written, 0 errors; best-source run: YouTube re-clean 12
applied (15 planned, cap 1000), Spotify 10 applied (cap 500), backed up + CAS. Spend today:
entity $0.22, SEO $0.11, topic $0.06. Throughput afterwards follows the controller's cadence
(SEO/entity crons speed up as their queues grow); no completion time is promised.

Catch-up progress 15:47: eligible 2 763, entity current 343, SEO current 323 (121 SEO jobs
queued), topic current 304; one 15:45 cron dispatch did not land (pg_net DNS timeout on the
cron call), the next call dispatched 60 normally.

Security fix 15:50 (`0088`, `0089`): `start_/end_pipeline_catchup_v1` had checked `current_user`,
which inside SECURITY DEFINER is always the owner, and were executable by `authenticated` —
any signed-in user could have changed the global catch-up. Now EXECUTE is service-role only
(also revoked from `readonly_codex`) and `pipeline_catchup_caller_allowed_v1` identifies the
caller from the request JWT (service_role / admin) or a JWT-less postgres session (pg_cron).
Rolled-back tests: non-admin and admin API callers denied (no EXECUTE), guard false for
non-admin/anon, true for admin/service/cron; service end allowed. The live catch-up state was
unchanged (started 15:32:42, never ended). Restore semantics: the derivation part ends only when
nothing is dispatch-eligible AND nothing dispatched is still queued in a runner; the
YouTube/Spotify part ends only at expiry (no complete count of remaining verified gains).

Terminal SEO failures (15:55, `0090`, seo-enrich-runner `2f0a6b71…`): an exhausted job
(attempts ≥ max) left the stage `queued`. Now the runner marks the stage `blocked`
(`seo_job_failed:<error>`) for exactly the job's clean-text version via
`mark_episode_derivation_v1` (newer version untouched, never current); the rejected candidate
title/description is kept on the internal job row (`result.rejected_output`) for diagnosis;
retry only by a clean-text change or `retry_failed_seo_derivations_v1` (service-only, ≤50).
Existing case: Tears of Jordan #217 (job 19705d29…) marked blocked; its rejected title was not
retained, so whether it was a bad title or a proper-name false positive is unknown. Counts at
15:56: SEO blocked 42 (41 empty/short clean text + 1 job failure), topic blocked 39, entity
blocked 41; failed SEO jobs in 24 h: 17 (all `hu_language_guard_failed:seo_title`; 1
stale-derivation job, 16 normal jobs of which 6 are tracked episodes still `awaiting_initial`).

Dispatch throughput (16:00–16:10, `0091`, seo-enrich-enqueue `0ef178c0…`): scheduled dispatches
at 15:45/15:50/15:55 timed out (8 s API limit; nothing half-written — the dispatch is one
transaction) because the selection hashed the full clean text of all ~2 700 stale candidates
each call (10 s for 60 under runner load). Now only the newest 2×limit locked candidates are
hash-verified (3.5 s for 60 under the same load). The caller keeps an adaptive effective batch
in `app_settings.derivation_dispatch_tuning` (10..60; halve + one retry on timeout, +10 when
< 3 s, −10 when > 5 s), bounded by the stored per_run/daily cap; no timeout was raised.


SEO failure bookkeeping (16:20, `0092`/`0093`): terminal SEO failures go through the service-only
`fail_seo_job_terminal_v1`, which sets job=failed and marks the exact clean-text version blocked
(via the version-guarded `mark_episode_derivation_v1`) in one transaction. Rolled-back live fault
injection: a raising stage write left the job `pending` and the stage `queued`; the normal path
gave job `failed` + stage `blocked`. Retryable failures must update exactly one job row. Any
bookkeeping failure counts in `failure_bookkeeping_errors` and logs the runner run as `error`.

ACL correction (16:25, `0094`): EXECUTE revoked from `readonly_codex` on every SECURITY DEFINER
job/derivation mutator added in this repair (`fail_seo_job_terminal_v1`,
`retry_failed_seo_derivations_v1`, `mark_episode_derivation_v1`, `dispatch_stale_derivations_v1`,
`derivation_lock_decide_v1`, `derivation_apply_outcome_v1`, `apply_episode_{seo_result,entities,topics}_v1`);
`has_function_privilege` is false for anon / authenticated / readonly_codex on all of them and on
the catch-up start/end/tick/restore RPCs; service_role true. `fail_seo_job_terminal_v1` now also
has the catch-up caller guard (`retry_failed_seo_derivations_v1` already had it); rolled-back
check: service_role JWT passes the guard, a non-admin authenticated JWT gets 42501. Read-only
helpers `pipeline_catchup_plan_v1` / `pipeline_catchup_caller_allowed_v1` stay executable.
Open: `readonly_codex` inherits EXECUTE on new public functions by default privileges, so every
future mutator needs an explicit revoke. Note: the best-effort `markDerivation` export still
exists for its other callers; only the terminal SEO path stopped using it.
