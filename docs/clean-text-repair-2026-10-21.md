# Clean-text repair – live rollout 2026-10-21 (HU only)

Scope: steps 1–4 approved by the owner. $0 deterministic; no paid AI, no mass reprocessing, no .com changes.

## 1. Deployed edge functions
- `episode-clean-text-runner` (quality gate, keep-prior, quarantine)
- `episode-best-text-source-runner` (incremental change feeds; redeployed after two fixes below)
- `clean-text-repair` (admin-only audit / stage / canary apply / rollback)

Fixes during rollout (`_shared/best-text-source-policy.ts`, runner):
- runner no longer loads `episode_transcripts.segments` (~62 kB/row); limit=100 hit "CPU Time exceeded", 60 passes (~2.7 s), cron uses 40;
- a confirmed article replaces a short RSS only if it adds text (an equal 75-char article was being selected).
Tests: `src/test/cleanTextValidation.test.ts` (+2), `episodeTextCleaner.test.ts` pass; one pre-existing unrelated failure in `productionPolicyStatic.test.ts` (person evidence `is_hungarian` guard).

## 2. Write-free test of the 474 empty records
Same shared code, offline over all 474 (all accept_hungarian): 254 written by v4, 203 by rescue, 16 no substantive content (skip), 1 quarantine. Canary-eligible (valid, ≥80 chars, overlap ≥0.98, no links): 449. Live `stage` dry run on the newest 200: 198 staged / 198 eligible, nothing written.

## 3. Canary (backed up, reversible)
- Manual review of the 50 newest eligible: 7 excluded because a removed sentence carried episode content (5cbb8d32, f531b86b, b23e4121, 4e7135c7, 0af095f4, 34d653da, 4c3606cb).
- Applied 43: batch `5f25cffd-e041-4f91-a60f-fd8a953a2009`, 43 applied / 0 conflicts / 0 invalid; 43 backups; all rows valid, non-empty, `done`.
- Rollback: `clean-text-repair` `{ "action": "rollback", "batch_id": "5f25cffd-e041-4f91-a60f-fd8a953a2009" }` (admin).
- Downstream: chunks/embeddings/entities were NOT re-triggered (38 of 43 already have chunks).

Public pages: all 43 return HTTP 200 for Googlebot before and after; HTML unchanged. Reason: `prerender` reads `episode_clean_text` with the anon key, but the table is admin-only (RLS), so crawler/visitor pages show the RSS description. Cleaned text currently feeds only server-side search/processing. Exposing it publicly (excluding transcript-derived rows) is a separate owner decision.

Audit after: empty-with-long-description 474 → 431.

## 4. Best-source cron
`podiverzum-best-text-source-incremental-15min` (jobid 193, `*/15`, body `{"limit":40}`), 96 runs/day ≈ 3 s each. Writes only `episode_best_text_source`; `auto_requeue_clean_text=false`, so no clean text is rewritten. First live run: 22 rows upserted (8 transcript, 3 YouTube, 1 Spotify, 10 RSS), requeued 0; all transcript rows `rights_status=rss_public_index_only`, `public_display=false`. Disable: `SELECT cron.alter_job(193, active := false);`.

## Person–episode GPT pilot (status only, nothing started)
Two batches ingested (953 + 1 requests, 954 items applied), actual cost ≈ $0.084 of the $10 cap. Controls still `enabled=true`; the 10-min tick (jobid 189) would submit the next batch within the cap, but is currently blocked by the priority gate (`priority_check_failed` / `higher_priority_work:seo_jobs_pending`).

## Person GPT tick paused (2026-10-21 09:18 UTC, owner request)
`person-relevance-openai-batch-tick` (jobid 189, `*/10`) set `active=false` until clean-text repair is finished (431 long empty descriptions remain). Unchanged: two ingested batches (954 items), controls (`enabled=true`, $10 daily/total cap), best-source cron 193. No open jobs.
Resume: `SELECT cron.alter_job(189, active := true);`

## Verified YouTube → best source → clean text → search (2026-10-21, owner-approved)
Deterministic, $0 AI. Gemini trim OFF, legacy global autopilot OFF, person GPT cron 189 OFF (unchanged). Earlier 43-row canary untouched (rows with existing backups are protected by the planner).

**Code**
- `_shared/youtube-source-gain.ts` (`youtube_gain_v1`): compares informative content only — links, handles, hashtag walls, CTA/like/subscribe lines, giveaway/promo and sponsor sections, hosting/ad boilerplate (AdsWizz, Acast, Megaphone …) and blocks recurring across ≥2 other YouTube descriptions of the same podcast are not information. Decisions: `youtube_better` / `youtube_no_gain` / `youtube_spam_only` / `rss_has_unique_content` / `youtube_language_mismatch`; logged in `episode_best_text_source.evidence.youtube_gain`.
- `_shared/best-text-source-policy.ts` → `best_text_source_v5_youtube_informative_gain`: only v3-confirmed links with score ≥0.78 are compared; a `youtube_better` source beats RSS and thin-RSS transcripts.
- `_shared/best-text-source-core.ts`: shared loader/selection; `cleanYoutubeDescription` (v4, or extract-only rescue when v4 drops chapter topics; dangling labels trimmed); `planYoutubeReclean` (gate: valid, extract-only ≥0.97, no URL, ≥100 more informative chars, prior content not lost; skips `pending`/`error` episodes and rows with earlier repair backups); `applyYoutubeReclean` (one `apply_clean_text_repair_v1` batch, CAS on clean text and on the best-source fingerprint).
- Runner fix: explicit ids were aliased to the feed list, so every cron run looked like an "ids" run and never saved cursors (same 39 episodes every 15 min). Fixed; per-feed quotas (YouTube 50 %), progress/caught-up per feed, `runs_ok`/`runs_failed`/`consecutive_errors`/`last_error` persisted even on failure.
- Clean-text runner: new YouTube-sourced episodes use the same `cleanYoutubeDescription` (same method name and source hash, so re-clean is idempotent).
- Migrations 0066/0067: `episode_best_source_youtube_queue` (2,790 staged targets, admin read only), `best_source_youtube_gain_targets_v1`, `youtube_source_quality_metrics_v1`, and `get_episode_public_clean_description_v1` (public reader, returns nothing unless an owner allowlists sources in `app_settings.public_clean_text_display.allowed_sources`; transcript and AI-trimmed text never returned; no table grants).
- Admin actions in `clean-text-repair`: `youtube_metrics`, `youtube_dry_run` (paged, read-only, optional `episode_ids`/`full_text`), `youtube_canary` (≤50, `confirm=apply_youtube_canary`); rollback via existing `rollback` action with the batch id.

**Dry run (all 2,790 targets, read-only)**: youtube_better 1,076 · no_gain 1,335 · spam_only 198 · rss_has_unique_content 126 · language_mismatch 32 (23 not evaluable). Re-clean plan for the 1,076: 865 pass the gate, 211 rejected (169 insufficient gain, 60 would lose prior content, 5 quarantine). Max page time 2.8 s at 30/page.

**Canary**: 40 episodes / 29 podcasts (incl. Della–László Csaba `a16809ca`), each reviewed in full before apply. Batch `8e365da4-f9db-4bbc-90f7-4fc6506fb358`: 40 applied, 0 conflicts, 0 invalid; all valid, done, no URL; average clean length 700 → 1,324 chars. Exact-phrase search: 24/24 search-visible canary episodes now found by a YouTube-only phrase that was absent from their RSS and old clean text (~130–600 ms). 12 canary episodes belong to podcasts with `rss_status=failed`, which search intentionally hides.

**Enabled (controls `episode_best_text_source_controls`)**: `youtube_backfill_enabled` (20/run over the staged queue), `youtube_reclean_enabled` (10/run, 150/day), `auto_requeue_clean_text=false`. Cron 193 unchanged (`*/15`). Each automatic batch id is listed in `episode_best_text_source_state.youtube_reclean.batches`.
Stop: set `youtube_reclean_enabled=false` (and/or `youtube_backfill_enabled=false`). Rollback: `clean-text-repair {"action":"rollback","batch_id":"<id>"}`.

**Not done / owner decisions**
- Public episode pages still show RSS. YouTube description reuse on public pages depends on YouTube API terms (attribution, refresh); `get_episode_public_clean_description_v1` stays off until the owner allowlists sources and the frontend is wired and published.
- Chunk embeddings for changed clean text are not re-run (paid embeddings); backups carry `downstream_invalidation='pending'`.
- Rows switching YouTube → RSS (link no longer verified/useful) are marked `reclean_status=pending` but not rewritten (prior text kept).
