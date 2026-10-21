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

## YouTube pairing → best source fast lane (2026-10-21, 11:45–12:40 UTC)

Live on the HU backend only. AI cost of the changes: $0 (deterministic).

What changed
- Migration `0068_youtube_link_noop_source_change_queue`: `episode_youtube_links.updated_at` now moves only on real content/match changes; view/caption observations use `metadata_refreshed_at`. Link writes go through `upsert_episode_youtube_links_v1` (row-locked, change-only, confirmed links sticky, manual/human links never overwritten, `episodes.youtube_paired_at` touched only when the winner really changes). A trigger fills `episode_source_change_queue` (HU podcasts only) on new/promoted/demoted/content-changed confirmed links; `claim_episode_source_changes_v1` (SKIP LOCKED, lease) and `ack_episode_source_change_v1` (change_seq CAS, backoff, dead letter after 5).
- `youtube-episode-pairer`: RPC writes, reuses earlier AI yes/no decisions for unchanged candidates, reports `write_stats`.
- `episode-best-text-source-runner`: fast lane first (≤20), archive backfill (20), feeds (≥8), default 40, hard max 60; re-clean cap 150/day with 30 reserved for the fast lane, 10/run; automatic YouTube re-cleans refresh or revert to RSS when the source changes; reviewed canaries (`5f25cffd…`, `8e365da4…`) and manual edits are protected; failures report their stage.
- `youtube-views-backfill`: writes `metadata_refreshed_at`.
- Cron 193 moved from `*/15` to `7,22,37,52 * * * *` (still every 15 min, off the top-of-hour peak where the 12:00 run hit a statement timeout, and 7 min after each pairer run).

Measured
- Pairer 12:30 run: 378 candidate evaluations → 338 no-op, 15 content, 25 metadata-only, 0 episode updates (before: every evaluation rewrote `updated_at`; 4,472 link timestamp bumps in 6 h, 1,708 episodes re-touched in 24 h). Wopcast rescan: 288/288 no-op, 0 AI calls.
- Fast lane: 11 promoted pairs enqueued 12:30:32, claimed and acked by the 12:37 run (max lag 389 s); earlier test 6/6 (360 s). Queue pending 0, dead 0. All 17 so far chose RSS on content grounds; a new `youtube_better` pair through the fast lane has not occurred yet.
- Cron 193 at 12:22 and 12:37: HTTP 200, `ok:true`, 4.3–4.8 s, 40 episodes; 8 + 5 archive re-cleans applied (batches `7e51dd41-976b-447e-bd6d-8745fa9bacf7`, `850e7688-e68f-420e-9d90-f10761da6092`), 0 conflicts/invalid.
- Re-cleans today 70/150; YouTube best sources 1,083, automatic YouTube re-cleans applied 105. Staged 2,790 backfill: 2,610 left (~130 runs ≈ 33 h). Archive YouTube feed: 11,508 rows after the cursor, 10/run (≈12 days; these are old pairs mostly already covered by the staged backfill).
- 17 early automatic re-cleans: 14 already clean, 3 corrected (batch `e65d674c-158c-4871-9c82-d359392c5d41`), now all idempotent. One (SodaStream football episode) still names the sponsor in a credit line; left as is pending a decision.

Open / not done
- 2,002 clean texts made by an older pipeline from YouTube descriptions (`deterministic_v4+ytdesc`) while the selected source is RSS; not rewritten (would be a mass change; needs owner decision and a reviewed canary).
- Public display of YouTube-derived clean text and re-embedding stay off (owner decisions).

## Spotify descriptions and internal transcript use (2026-10-21 ~14:30 UTC)

Live changes (HU backend only; `.com` untouched; new paid AI $0; job 189 off, Gemini trim off, `chunk_aug_enabled=false`):
- Migration `0069_spotify_source_transcript_lexical_index`: Spotify meta `updated_at` moves only on content/match change; staged Spotify target table (1,058 rows); server-only `episode_transcript_lexical_chunks` (token vectors + char offsets, no text, no anon/authenticated grants) with `index_transcript_lexical_v1` (≤50 eps/call, class + rights gate, idempotent by content hash), `transcript_lexical_index_targets_v1`, `search_transcript_lexical_v1` (exact phrase, optional suffix-tolerant last word), `transcript_person_evidence_dry_run_v1` (read-only).
- `spotify-show-enricher`: unique-conflict → `duplicate_show` (25), 404 → backoff (11, removed from Spotify), merged telemetry in `spotify_enricher_state.last_show_run`.
- `spotify-episode-matcher`: stops after two already-paired pages, counts duplicate Spotify ids, telemetry `last_episode_run`. Test run: 10 shows, 21 API pages all HTTP 200, 763 re-synced, 9 genuinely new rows changed `updated_at`.
- Best-source policy v6: Spotify only with episode+show match ≥0.8 and an informative superset of RSS (or empty RSS); below article/YouTube. Automatic Spotify backfill and re-clean lanes exist but are OFF (`spotify_backfill_enabled`, `spotify_reclean_enabled` unset).

Spotify dry run (all 1,058): 564 `spotify_better`, 406 no gain, 64 RSS-unique, 12 language mismatch, 6 spam-only; planner 544 apply / 18 reject. 45-episode balanced review (44 shows sampled) found leftover listening CTAs, back-catalogue lists, sponsor thanks and registration promos; rules fixed (incl. JS ASCII-only `\b` bug on accented words), re-review clean. Canary: 30 episodes / 19 shows, batches `f8d5412b-ca9b-44d3-b3df-938bdc74c35c` + `6af44eed-f0e3-453e-a58f-c4d099c11a1c`, 30/30 applied, 0 conflicts; 10 were empty before; average clean text 1,043 → 2,700 chars; no URLs. Search: "Matthias Rust", "Bollobás Béla" now rank 1 (not in RSS), "Kiss Norbival" rank 3.

Transcripts: 7,250 HU transcripts ≥900 chars — 151 publisher RSS transcripts, 7,081 YouTube captions, 17 other. Indexed 45 publisher-RSS episodes (1,009 chunks); YouTube captions not indexed (provenance decision). Phrase lookups return only episode ids. Person evidence dry run on those 45 episodes: 35 pending links (17 full name spoken), 23 accepted (11), 4 rejected (1, stays rejected), nothing written.

Rollback: Spotify canary via the existing backed-up CAS rollback for the two batch ids; transcript index is additive (truncate the table).
