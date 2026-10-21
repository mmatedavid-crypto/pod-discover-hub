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
- [ ] Public display of YouTube-derived clean text (blocked: owner decision on YouTube terms + frontend publish).
- [ ] Re-embed changed clean text for semantic search (blocked: paid embeddings need owner budget).

## YouTube pairing → best source fast lane (2026-10-21 12:00 UTC)
- [x] Change-only, race-safe YouTube link writes (no-op rescans write nothing; confirmed links sticky; manual links protected; episodes touched only on winner change).
- [x] View/caption refreshes tracked in `metadata_refreshed_at`, never `updated_at`.
- [x] Durable fast-lane queue for new/changed confirmed pairs (trigger, lease, change_seq ack, backoff, dead letters) ahead of archive backfill; re-clean cap reserve for fast lane.
- [x] Source-change refresh / RSS revert for automatic YouTube re-cleans (reviewed canaries protected).
- [x] 17 early automatic texts re-checked; 3 with leftover promo/hashtags corrected (batch e65d674c-158c-4871-9c82-d359392c5d41).
- [x] Best-source cron 193 moved to :07/:22/:37/:52 (off the top-of-hour peak; runs right after pairing).
- [ ] First naturally arriving youtube_better new pair through the fast lane (waits on a real new pair; verified with fast-lane runs so far only for RSS-preferred pairs).
