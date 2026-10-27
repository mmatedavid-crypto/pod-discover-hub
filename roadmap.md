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
- [x] Crawler HTML no longer shows transcript excerpts (2026-10-24; owner no-public-transcript rule).
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

## Pipeline repair (2026-10-24, owner "Rendbe tudod hozni?") — docs/pipeline-repair-2026-10-24.md
- [x] A: best-source CPU root cause fixed, run log/stages, isolation + finite retry, 36 dead re-queued once, 12 ok / 0 killed runs.
- [x] B: content fingerprint → per-episode derivation state, bounded dispatch in existing runners; exact provenance, serialized marking, atomic apply (review fixes).
- [x] C: original 20 + 167 mixed episodes through clean → entity/topic/SEO with hash; second runs no-op.
- [x] D: bot HTML = approved visitor description (no transcript, no dropped words).
- [x] E: Google Indexing API safe no-op; nothing marked indexed.
- [x] Health: real completions vs dispatch, freshness, intentional pauses (admin panel + snapshot).
- [x] Person extractor: unchanged inputs skipped, judged mentions protected.
- [ ] ~3 000 stale derived results drain at 300/day within existing budgets (runs on its own).
- [ ] Paid person review (cron 189) stays paused (blocked: owner decision); D/E-tier topics excluded by policy (blocked: owner decision).
- [ ] Older topic extraction errors (~8 800) not re-run (blocked: would be a broad AI backfill; owner decision).
- [x] Homonym person links: recommendations, episode person links/JSON-LD and person-page roles use only verified identities (2026-10-24 follow-up).
- [x] smart_player_discover ambiguity error fixed (player discovery no longer falls back to unrelated episodes).
- [x] Episode card person chips resolve per episode (batched); verified people no longer list same-name unreviewed episodes.
- [ ] Podcast-level chips (PodcastEntitiesCompact) and trending entities still resolve by name (aggregated, not per episode).
- [ ] Publish the frontend (recommendation, person-link and admin panel changes) (waits on user publish).
- [x] 24h catch-up mode (owner 2026-10-24): raised dispatch + verified YT/SP re-clean quotas with audited auto-restore; dispatcher set-based; topic waiting churn fixed.
- [x] Owner throughput raise 17:06 UTC (enqueue every minute, batch 30–60 adaptive, SEO/entity every 3 min, topic/source every 5 min) inside the catch-up; dispatch query fixed (0095/0096).
- [ ] Catch-up drains on its own until 2026-10-25 15:33 UTC (or earlier when nothing eligible or queued is left).


## AI-asszisztensek podcast-almanachja (2026-10-24)
- [x] (5) AI-forgalom mérése: admin analytics panel szerveroldali aggregálással (forrás, epizód/műsor-érkezés, lejátszás, heti trend, érkezési oldalak).
- [x] (1) llms.txt átírva almanach-bemutatkozásra (szekciók, ajánlási szabályok, MCP, sitemap).
- [x] (2) MCP élesben működik (6 eszköz, public read-only); find_mentions / get_episode_context névrokon-kapu a személyoldallal egyezően.
- [ ] Publikálás szükséges (llms.txt, admin panel, MCP névrokon-javítás) — tulajdonosi publish.
- [ ] Később: botoknak a /kereses oldal csak üres vázat ad; válaszra kész oldalak (3); gazdagabb háttéradatok (4); AI-crawler látogatások mérése a CF workerben.

## Owner requests 2026-10-25 20:10 UTC
- [x] Lock Astra start to scheduler/admin only.
- [x] Person-check budget +$10 (total $20.09, 240k requests, daily $10).
- [ ] Astra advisory review of the 302 waiting clean-text rows: running on its own every 3 min, no longer held by the visitor gate (owner 2026-10-25 22:10 UTC); ~$0.014/row, cap $8 total / $5 day; scheduler removes itself after drain.
- [x] Both Astra jobs exempt from the visitor-first gate (owner decision); cost caps unchanged.
- [ ] Owner list from Astra's recommendations (waits on the review above).
- [x] Publish requested 2026-10-25 20:21 UTC.

## Database status review (2026-10-27)
- [x] SEO podcast-description jobs could never finish after a final failure and retried every 30 min; fixed, stuck job closed.
- [ ] Person–episode OpenAI batch paused: OpenAI account billing hard limit reached (blocked: owner raises/tops up the OpenAI account limit); 13,920 pairs waiting.
- [ ] 47 shows labelled HU but detected English/other sit in language review (1,276 episodes held, not public) (blocked: owner language decision).
- [ ] Topic catch-up (~26.8k pending, ~8.6k/day) and search re-embed (~133k, ≤900/h) run on their own; expected done ≈ early November.

## Global search & recommendation quality (2026-10-27)
- [x] AI-graded whole-set measurement (`search-quality-eval`): 557 searches (golden + visitor + Google queries) and 288 recommendations, 30% holdout, calibration sample, $1.5 cap.
- [x] Baseline run finished (557 searches: top-1 on target 61.6%, top-1 off topic 17.8%; recommendations 13.2% empty).
- [x] Recommendations: bounded other-show fallback when the normal lookup is empty (empty 13.2% → 0%, top-3 precision +8–9 points incl. holdout).
- [ ] Search: whole-word catalog matches + show pin only on whole-word title match — after-measurement running; keep only if whole set improves with no query-type regression.
- [ ] Next classes: keyword-only matches on broad single words, natural questions matching filler words ("hogyan"), gibberish returning results.
- [x] Weekly measurement (Mon 02:40 UTC, $1.5 cap) + Telegram alert on regression; trend on the admin search test page.
- [ ] Re-measure after the old-vector rebuild finishes (~6 days).

## Intelligent search for sentence-like queries (2026-10-27)
- [x] Names / show titles / short topics keep the existing path (owner condition).
- [x] AI concepts replace the hand-written synonym list for complex searches.
- [x] Meaning-first ranking for complex searches.
- [ ] In-episode passage search: not possible yet (only one summary chunk per episode, no passage index; transcripts private) — needs owner decision on building passage chunks.
- [x] Final AI relevance check of top 24 (public metadata only), cached per query.
- [x] Honest "nothing really matches" result + search-page message (frontend needs publish).
- [ ] Full 557-search measurement vs. "After 3" baseline; keep only if holdout improves and names/shows/recency do not regress.
