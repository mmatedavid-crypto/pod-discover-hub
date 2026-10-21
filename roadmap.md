# Traffic-led improvements

## Visitor-first processing
- [x] Apply visitor-first priority without changing AI models or quality gates: maintenance before relevance before Astra; public and newest relationships first.
- [x] Verify configured controls and priority behavior; keep credit pause intact. Three focused tests passed; both deployed bulk runners returned higher_priority_work:seo_jobs_pending without paid AI calls. No credit recovery or complete processing run attempted.

- [x] Compare visits, Google traffic and listening across complete weeks.
- [x] Unify page/player session attribution without rewriting historical events.
- [x] Test the shared session and verify page-to-play attribution in the preview (7 focused tests passed; actual play_start matched landing ID).
- [x] Summarize measured growth, limitations and next priorities (two unrelated legacy static tests conflict with the existing trusted-HU gate; unchanged).
## Person name search (2026-10-20)
- [x] Person-first indexed name search with role/evidence ordering, ambiguity marking and homonym disambiguation; deployed `search-hybrid`; clean-text name index added.
- [x] Read-only relationship backlog audit and human review order (docs/person-search-evidence-2026-10-20.md).
- [ ] Publish the frontend so visitors see evidence labels and the same-name notice (waits on user publish).

## OpenAI Batch person review (2026-10-20)
- [x] Batch adapter, RPCs, admin dry-run page, golden labelling, tests, deploy (no paid call).
- [ ] Owner adds a NEW/rotated OPENAI_API_KEY in Secrets (blocked: owner action).
- [ ] Owner labels 100-200 goldens, then authorizes golden model comparison and a 1,000-2,000 pair pilot with daily/total caps (blocked: owner authorization).
- [ ] After pilot gates pass: scheduled polling and escalation enablement (planned).

## Clean-text + best-source repair (2026-10-20, before mass person GPT)
- [x] Harden clean-text runner: shared validator, no empty/overcut "done", keep prior good text, bounded retry/quarantine.
- [x] Best-source runner: incremental change detection for new transcripts on done episodes, bounded indexed batches, no full-table load.
- [x] Stage/dry-run + backup/rollback; 43-record canary applied 2026-10-21 (batch 5f25cffd-e041-4f91-a60f-fd8a953a2009).
- [x] Gemini AI trim off for this fix; optional OpenAI extract-only adapter stays disabled.
- [x] Tests, deploy, canary report (docs/clean-text-repair-2026-10-21.md); 15-min best-source cron (jobid 193, limit 40).
- [ ] Public episode pages do not read cleaned text (table is admin-only); exposing non-transcript clean text needs owner decision.
- [ ] Remaining ~406 canary-eligible empty records: next canary only on owner approval.
- [ ] Person GPT tick (cron 189) paused until clean-text repair is done; resume only on owner approval.

## Verified YouTube → clean text → search (2026-10-21)
- [x] Informative-gain comparison (boilerplate/CTA/sponsor/recurring blocks excluded), v5 source policy, tests.
- [x] Fix frozen best-source cursors; per-feed progress and failure telemetry.
- [x] Staged 2,790-target queue, full read-only dry run, 40-episode reviewed canary (batch 8e365da4-f9db-4bbc-90f7-4fc6506fb358), search check 24/24.
- [x] Bounded automatic backfill (20/run) and backed-up YouTube re-clean (10/run, 150/day) enabled.
- [x] Public display of cleaned YouTube/Spotify text with source link (owner decision 2026-10-21; crawler HTML live).
- [ ] Frontend publish so visitors see it (waits on user publish).
- [ ] Crawler HTML shows transcript excerpts (`get_episode_index_text`) — conflicts with the no-public-transcript rule; needs owner decision.
- [ ] Re-embed changed clean text for semantic search (blocked: paid embeddings need owner budget).

## YouTube pairing → best source fast lane (2026-10-21 12:00 UTC)
- [x] Change-only, race-safe YouTube link writes (no-op rescans write nothing; confirmed links sticky; manual links protected; episodes touched only on winner change).
- [x] View/caption refreshes tracked in `metadata_refreshed_at`, never `updated_at`.
- [x] Durable fast-lane queue for new/changed confirmed pairs (trigger, lease, change_seq ack, backoff, dead letters) ahead of archive backfill; re-clean cap reserve for fast lane.
- [x] Source-change refresh / RSS revert for automatic YouTube re-cleans (reviewed canaries protected).
- [x] 17 early automatic texts re-checked; 3 with leftover promo/hashtags corrected (batch e65d674c-158c-4871-9c82-d359392c5d41).
- [x] Best-source cron 193 moved to :07/:22/:37/:52 (off the top-of-hour peak; runs right after pairing).
- [ ] First naturally arriving youtube_better new pair through the fast lane (waits on a real new pair; verified with fast-lane runs so far only for RSS-preferred pairs).

## Spotify descriptions + internal transcript use (2026-10-21 14:00 UTC)
- [x] Spotify sync verified with real API telemetry; 25 duplicate shows recorded instead of failing every run; 11 shows removed from Spotify (404) backed off; episode sync incremental, no-op re-syncs no longer bump `updated_at`.
- [x] Informative RSS–Spotify comparison (promo/CTA/sponsor/back-catalogue removed, RSS facts preserved), full read-only run over 1,058 candidates, 45-episode manual review, 30-episode backed-up canary (batches f8d5412b-ca9b-44d3-b3df-938bdc74c35c, 6af44eed-f0e3-453e-a58f-c4d099c11a1c).
- [x] Server-only transcript word index (no text) + strict phrase lookup + read-only person-evidence check; 45 publisher-RSS transcripts indexed.
- [x] Automatic Spotify backfill/re-clean lane ON (owner OK 2026-10-21): 3 targets/run, 3 re-cleans/run, 20/day; legacy v5 selections re-checked; Spotify meta made server-only.
- [ ] Indexing ~7,081 YouTube-caption transcripts: needs owner/legal decision on caption provenance.
- [ ] Using transcript index in visitor search ranking and in person-link review: not wired; needs owner decision.

## Phase 1 — clean-text restoration (2026-10-21 15:30 UTC)
- [x] Read-only full HU audit with exclusive categories and do-not-fix markers (docs/clean-text-phase1-2026-10-21.md).
- [x] Name/timecode-preserving cleaner + RSS repair planner, dry-run/canary actions, tests, deploy.
- [x] Live dry run of all empty/overcut/missing (1,703 fixable); reviewed 38-episode canary (3 batches).
- [x] 471 missing/skipped episodes with verified Spotify/YouTube text handed to the capped lanes.
- [x] Bounded background lane for the remaining RSS-fixable rows (durable repair queue, cron 195).
- [x] Old YouTube-derived texts with RSS as best source: owner OK 2026-10-21; audited and handled by the legacy lane (see below).

## Durable clean-text repair queue (2026-10-21)
- [x] Queue table, seed/reconcile, lease/backoff/dead letter, RSS-change trigger, function + adaptive cron 195, gates, tests, deploy.
- [x] 1 388 episodes repaired with backups; empty 5 236→4 520, over-trimmed 2 763→1 379.
- [x] Expired leases explained (old CPU-killed runs, reclaimed 40/run in priority order); open 302 → 222 by 18:11 UTC.
- [x] Remaining open RSS rows finished 2026-10-21 20:30 UTC (owner lifted daily caps for the evening; caps restored 20:55 UTC).
- [x] Full read-only audit of 1 941 legacy ytdesc texts (provenance, identity, content); planner, tests, 36-episode canary (c5bc1948-00dc-464d-8e02-d38a617de86a), rollback test, automatic legacy lane (≤40/run, ≤300 writes/day) in cron 195.
- [x] Legacy lane fully evaluated 2026-10-21 20:40 UTC (0 open).
- [x] Waiting verified YouTube/Spotify re-cleans drained to the code maximums (YouTube 500/day, Spotify 300/day) on 2026-10-21.
- [ ] 9 YouTube + 38 Spotify re-cleans left; they go through on the normal daily caps (runs on its own).
- [x] Legacy review rows (499): 3-step resolution 2026-10-21 (merge 59, RSS replace 10, attribution 129, safe-internal/kept 251, protected 16, quarantine 3; one-off AI $0.41, switched off).
- [ ] 31 legacy rows still need_review (19 texts with URL fragments need a YouTube re-clean, 9 AI-uncertain, 2 unverified names, 1 low-info) + ≈150 gated RSS rows + quarantine (blocked: owner review).
