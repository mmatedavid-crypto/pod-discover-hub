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
