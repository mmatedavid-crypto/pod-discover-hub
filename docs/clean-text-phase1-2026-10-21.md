# Phase 1 — clean-text restoration (HU, 2026-10-21 15:30–16:00 UTC)

Scope: Podiverzum.hu only. $0 (deterministic code, no AI, no embeddings, no transcript API). `.com`, person GPT (job 189), SEO/Google untouched.

## Audit (read-only snapshot 2026-10-21 15:33:49 UTC, 148,126 HU episodes)

Exclusive categories (each episode counted once, in this order):

| # | Category | Episodes | Notes |
|---|---|---:|---|
| A1 | Empty clean text, RSS ≥500 visible chars | 336 | (raw-length ≥500: ~431) |
| A2 | Empty clean text, RSS 40–499 visible chars | 1,040 | |
| B | Clean text <20% of raw RSS (RSS ≥300) | 1,879 | only 378 when RSS is measured without HTML/links |
| C | Missing row or `skipped` | 7,424 | 7,313 have RSS <40 chars (no source) |
| D | Non-empty <100 chars | 22,769 | 22,916 of all short rows have a short RSS themselves → valid, not errors |
| E | Old `deterministic_v4+ytdesc` while best source is RSS | 1,893 | 2,003 incl. overlaps |
| – | Rest | 112,785 | |

Overlaps (non-exclusive): B∩D 379, B∩E 41, D∩E 55. Protected (active backups) 239, of which 113 in reviewed canary batches; quarantine open 0.

Do-not-fix markers: link-only RSS 1,047; RSS with no substantive content (validator) 648 of the empty ones; show-level boilerplate (same description on ≥3 episodes of a show: Taverna, Biblia egy év alatt, …) 677 candidates; prior text from YouTube/Spotify/article 67; protected backups 239; short-but-valid ~22.9k.

E (old YouTube-derived text): 1,204 still have a verified v3 YouTube link but were never re-evaluated; 657 have no verified link any more (risk of text from a wrong video); 140 were evaluated as no gain/spam/RSS-unique. Not rewritten (owner decision; reviewed canary only).

## Code (deployed)

- `_shared/clean-text-validation.ts`: half-removed links (`ly/…`, `. hu/`) are invalid; when v4 drops ≥2 names/topics/timecodes that the extract-only rescue keeps (and the rescue loses nothing), the rescue is written. Applies to new episodes in `episode-clean-text-runner` too.
- `_shared/clean-text-rss-repair.ts`: repair planner — runner-owned, backed-up and other-source rows protected; extract-only (overlap ≥0.98), link-free; a non-empty prior is replaced only if every prior name is kept, information is added and ≥2 new names/timecodes appear (promo/CTA does not count); show-level boilerplate rejected.
- `clean-text-repair`: `rss_dry_run` (paged, read-only) and `rss_canary` (explicit reviewed ids ≤50, confirm token, `apply_clean_text_repair_v1` backup + CAS). Migrations 0071/0072: `clean_text_repair_targets_v2` (kinds `empty_any`, `empty_substantive`, `overcut`, `missing_rss`; offset/id list; active backups; same-description count).
- Deployed: `clean-text-repair`, `episode-clean-text-runner`, `episode-best-text-source-runner`. Tests: 111 passed (7 files), build OK.

## Live dry run (all candidates, no writes)

| Kind | Targets | Would fix | Main reasons not fixed |
|---|---:|---:|---|
| empty_any | 1,895 | 872 | no substantive content 648, show boilerplate 351 |
| overcut | 1,879 | 794 | no added names/timecodes 670, too little gain 615, boilerplate 264, other-source prior 67 |
| missing_rss | 99 | 37 | show boilerplate 62 |

1,703 distinct fixable from RSS (no overlap between kinds).

## Canary (reviewed, 45 sampled from 45 shows, 7 excluded on review)

Excluded: English legal notice, a truncated sentence, a 60-char ad, supporter name list, bank-details-heavy and channel-promo additions.

| Batch | Kind | Episodes | Before → after (avg chars) |
|---|---|---:|---|
| `96c3a1e6-069a-4190-b163-40d556cc5fb7` | missing_rss | 5 | 0 → 1,176 |
| `7d826b25-66d5-47c9-865f-8fcbb2d39927` | empty_any | 17 | 0 → 447 |
| `8a5784ef-6a0a-4d66-a3a2-e328a9b2a83e` | overcut | 16 | 250 → 898 |

38/38 applied, 0 conflicts, hashes match, no URLs, all `done`. Rollback: `clean-text-repair` `{action:"rollback", batch_id}`.

## Alternative sources for missing/skipped episodes

471 missing/skipped episodes with a verified Spotify or YouTube description were re-selected (ids mode): 236 verified Spotify gain, 38 verified YouTube gain, 154 RSS, 15 transcript (index-only). They are now pending in the existing capped lanes (Spotify 3/run, 20/day; YouTube 10/run, 150/day). 11 previously empty episodes were filled from Spotify today (batches `16b399de-…`, `0efcf1ab-…`, `ca5fdaaf-…`, `65d9d21f-…`).

## Switches

- `episode_clean_text_controls.enabled=false` is the adaptive queue-health pause (`auto_paused_reason=queue_empty`, wake threshold 1 pending), not a manual block; 291 new episodes in 48 h got clean text. Legacy global backfill stays off; Gemini trim off.
- Best-source cron 193 unchanged (:07/:22/:37/:52), runs OK (2.4–4.8 s). Spotify 3/run, 20/day; YouTube 150/day.
- No new background lane for the 1,665 remaining RSS-fixable rows: next step is a bounded lane only after the owner reviews this canary.

## Durable repair queue (2026-10-21 16:20–16:55 UTC)

Live and autonomous. Deterministic, $0, no AI. HU backend only; `.com` untouched.

- Table `clean_text_repair_queue` (migrations 0073, 0074): one row per HU episode, repair kind + RSS md5 fingerprint, finite statuses (pending/leased/done/no_substantive_source/protected/needs_review/quarantine/retry/dead), SKIP LOCKED lease (10 min), backoff, max 5 attempts then dead letter (also for crashed runs). Admin-only read.
- Seed/reconcile `clean_text_repair_queue_seed_v1()` set-based, at most every 20 h (first run 38.8 s, 16 448 rows). Rows fixed elsewhere resolve to `done/resolved_elsewhere`.
- Trigger: a real `episodes.description` change on an existing HU episode re-queues it as `rss_changed` (priority 15); no-op updates do nothing. New episodes stay with `episode-clean-text-runner`.
- Function `clean-text-repair-queue` (cron jobid 195 `11,41 * * * *` while backlog is open, self-switches to hourly `41 * * * *` when drained): 40 per run, daily apply cap 1 500, chunks of ≤40 per backup batch, post-write verify + batch rollback, breaker (3 failures / conflict ratio 0.2), runner backstop (only auto-paused, HU-only).
- Extra unattended gate (`_shared/clean-text-repair-queue.ts`): lost chapter timecodes, mostly English, bank details, short ads, supporter lists, and (when replacing existing text) platform-label leftovers → `needs_review`. Show-level recurring sentences (taglines, paywall/subscription notes, music credits) removed using 16 sampled descriptions of the same show; host/guest credits and timecodes always kept.
- Shared cleaner fixes (also for new episodes, YouTube/Spotify lanes): hashtag walls (≥3 tags) removed, trailing link labels removed, separator rules → line breaks, Patreon/CTA lead-in before a colon no longer drops the episode content after it, removed a catastrophic-backtracking pattern that hit edge CPU limits.

### Results (16:55 UTC)

- Applied (backed up, rollback per batch): **1 388 episodes** in 84 batches; 0 conflicts, 0 invalid, 0 URLs in output. First 5 canary batches (291 rows) were rolled back and redone after rule tightening.
  - empty, RSS > 500: 229 · empty, RSS 40–500: 487 · missing/skipped: 23 · over-trimmed: 649
- HU empty clean text 5 236 → **4 520**; empty with RSS ≥ 500: 431 → **200**; over-trimmed (<20 % of RSS ≥ 300): 2 763 → **1 379**.
- Finite outcomes so far: kept prior (no RSS gain / not safer) 633; no substantive source (link-only, show boilerplate, <40 chars) 11 637; protected (other source lane / backups) 370; needs review 2 069 (1 941 legacy ytdesc, 128 gated); quarantine 9.
- Open: 102 pending + 240 leased (from two early runs killed by CPU limit; lease expiry → reclaimed). Daily cap reached ~93 %; the rest completes on the next runs (after 00:00 UTC cap reset at the latest).

Rollback any batch: `select public.rollback_clean_text_repair_v1('<batch_id>')`; batch ids in `app_settings.clean_text_repair_queue_state.batch_ids` and `clean_text_repair_queue.last_batch_id`. Pause: `clean_text_repair_queue_controls.enabled=false`.

Not done automatically (by design): 1 941 legacy ytdesc/RSS conflicts (`needs_review`), 128 gated rows, 9 quarantined.

## Open RSS rows + legacy YouTube-description texts (2026-10-21 17:43–18:45 UTC)

$0, deterministic, no AI. HU only; `.com`, SEO, person GPT untouched. Job 74 (old autopilot) and 189 (person GPT) stay off; job 193 unchanged; no new cron.

### Open RSS rows (302 at 17:33)

- The 200 "leased" rows were leases left by two early runs that hit the CPU limit (16:43–16:47). The claim function does reclaim expired leases (no bug); it takes them in priority order, 40 per run, limited by the daily cap. 17:11 and 17:41 reclaimed 80 of them (job 195 → HTTP 200 from the function both times, verified in the HTTP response log).
- 18:11 run: 40 claimed, 33 applied, 7 no source; open 262 → **222**. Unique episodes repaired by the queue: **1,493** (`total_applied` 1,734 counts attempts incl. 291 rolled back and redone).
- Daily cap 1,500 is almost reached today (UTC). The remaining 222 continue after 00:00 UTC at 40 per run (expected done by ~03:45 UTC). Nothing exceeds the cap.

### Legacy `deterministic_v4+ytdesc` texts (1,941) — full read-only audit

Provenance: the stored source hash identifies the exact YouTube description used for **1,594**; **323** more by ≥90 % token containment; **24** unknown. Identity: v3 pairing (confirmed, score ≥ 0.78, no blockers) plus own title / release date / episode number / channel checks → 1,520 verified, 396 unverified, 25 wrong video.

Planner `_shared/clean-text-legacy-ytdesc.ts` (all 1,941 planned offline and the reviewed sample re-planned live with identical results):

| Bucket | Meaning | Episodes | Write |
|---|---|---:|---|
| A | Verified video, text informative and complete → kept, attribution set to YouTube (same text, same hash, backed up) | 167 | attribution only |
| B | Stored text adds nothing over RSS, or video wrong/unverified, substantive RSS → replaced by the episode's RSS | 260 | yes (backup + CAS) |
| C | Ambiguous identity or content would be lost either way → `needs_review` | 500 | no |
| D | No alternative: kept when it matches the episode title (2), else quarantined (1) | 3 | no |
| E | Already equivalent to RSS → done, no change | 1,006 | no |
| P | Other source lane (Spotify/YouTube best source) → protected | 5 | no |

C detail: verified video but RSS has names/chapters the stored text lacks 200; RSS adds names but cannot replace safely (link-label leftovers etc.) 122; unverified, names would be lost 73; unverified but same title/day (plausible) 57; unverified with large content loss 17; verified video with little informative text and no usable RSS 14; needs re-clean 7; Spotify alternative 4; short RSS 3; rejected pairing but title-matching text 2; auto gate 1.

Review: 42 + 21 + 36 real examples across all buckets and shows were read. Rules added from the review: link-label leftovers / domain / handle fragments block RSS replacements; a rejected pairing is not "wrong" when the stored text matches the title; weak date mismatch alone is not "wrong"; person names that would be lost send unverified rows to review.

### Canary and rollback test

- Canary batch **`c5bc1948-00dc-464d-8e02-d38a617de86a`** (36 episodes, 18:04 UTC): 25 replaced by RSS (7 wrong video, 7 unverified, 10 RSS superset, 1 uninformative video), 8 attribution-only, 3 to review. 33 backups, 0 conflicts, 0 URLs, every A text byte-identical, every B now RSS-attributed. Average length of replaced texts 441 → 576.
- Search check (internal clean-text index): "Káposzta Benőről", "Horváth Bélával", "Kezdődik a 2024-es alapszakasz", "Bennszülött Bálna" now find the right episodes; phrases from the wrong videos ("Csoboth Kevin", "Gergő és Shirin") no longer match them. Site search for "Káposzta Benőről" returns the episode with its public RSS text only.
- Rollback test on one throwaway episode: batch `16281b14-b3a1-4fbc-930b-6e3228987e0a` applied → rolled back (text, method, hash restored byte-exact) → re-applied as `a2b1f998-1808-466f-b866-7c98b18f509f`.
- No public exposure: anonymous reads of clean text and the queue return nothing; the new input lookup is denied to visitors.

### Automatic lane (same queue, same cron 195)

- Migration `0075_clean_text_repair_queue_legacy_lane`: claim lanes (`regular` first, `legacy` only with leftover capacity; risky rows without a confirmed link first), explicit-id canary claim, planner inputs lookup, status with `unique_applied`, `leased_expired`, `legacy_open`, `legacy_writes_today`.
- Controls: `legacy_enabled=true`, ≤40 legacy rows per run, **≤300 legacy writes per UTC day** (separate from the 1,500 RSS cap). Each legacy row is evaluated once and gets a finite status; it is re-evaluated only when its RSS description really changes. RSS-change rows on legacy texts go through the same planner. Adaptive cadence and `archive_drained` now also wait for the legacy backlog.
- Reviewed batches (RSS 43, YouTube 40, Spotify 30, phase-1 RSS 38, promo fix 3) and every other backed-up row are never rewritten by this lane.

Rollback any legacy batch: `clean-text-repair` `{action:"rollback", batch_id}`; ids in `clean_text_repair_queue_state.legacy_batch_ids`. Pause only the legacy lane: `clean_text_repair_queue_controls.legacy_enabled=false`.

### Live state 18:41 UTC

- Cron 195 run 18:41 (HTTP 200, 4.1 s): 7 RSS repairs (daily cap 1,500 reached exactly), then 33 legacy rows evaluated automatically (1 replaced by RSS, 18 already equivalent, 14 to review).
- RSS queue: 215 open (102 pending + 113 expired leases waiting for reclaim), resumes after 00:00 UTC. Unique repaired episodes: 1,500.
- Legacy: 70 evaluated (35 writes: 27 RSS replacements, 8 attribution-only; 35 active backups), 1,871 still to evaluate by the lane.
- HU texts: empty 4,520 → 4,408; empty with RSS ≥ 500 chars 200 → 88.

## Evening drain with lifted daily caps (2026-10-21 20:27–20:55 UTC)

Owner lifted the daily quotas for the rest of the day. Only daily caps were raised; per-run sizes, every quality gate, backup + CAS and per-batch rollback stayed. No new cron, no paid AI, `.com` untouched; job 189, Gemini trim and legacy autopilot stay OFF.

- Temporary values: RSS queue 1,500 → 3,000/day, legacy writes 300 → 2,000/day, YouTube re-clean 150 → 500/day (code max), Spotify re-clean 20 → 300/day (code max), Spotify 3 → 5/run; YouTube archive backfill 20 → 5/run and fast-lane reserve 30 → 0 during the drain so each run fit the edge CPU limit. All restored at 20:55 UTC (record kept in `last_temp_quota_lift` of both control rows).
- Manual ticks of the existing functions (`clean-text-repair-queue`, `episode-best-text-source-runner`); 0 conflicts, 0 invalid writes. Some best-source runs hit the edge CPU limit or one statement timeout and were retried; writes are CAS so no partial state.
- Results: RSS queue open 0; legacy lane open 0. 1,146 episodes changed in 158 backed-up batches (316 were empty before; average length 565 → 1,078 chars; 0 texts with URLs). By source: RSS/rescue ≈ 330, legacy ≈ 150, verified YouTube 384, verified Spotify 280.
- HU empty clean texts: 4,408 → 4,357 (the rest have no substantive source).
- Left: 9 YouTube + 38 Spotify re-cleans (normal daily caps), 648 needs_review + 10 quarantine rows for human review.

## Legacy review rows resolved (2026-10-21 21:10–21:45 UTC, policy `legacy_ytdesc_resolve_v2`)

Owner-approved 3 steps on the 499 open legacy rows (498 needs_review + 1 quarantine). One-time admin actions in the existing `clean-text-repair-queue` function (`legacy_resolve_dry_run`, `legacy_resolve_apply` ≤20 ids, `legacy_ai_review` ≤50 ids); no new cron. Planner: `_shared/clean-text-legacy-resolve.ts`; log: `clean_text_legacy_resolutions` (per-part source attribution, kept RSS-only units, dropped units); AI ledger: `clean_text_legacy_ai_reviews` (migration 0077).

- Step 1 (merge, v3-confirmed video only): stored text kept first byte-identical, RSS-only sentences appended extract-only (contiguous token match in the RSS with links as barriers; no links, link lead-ins, social/CTA/support/sponsor, music credits, show boilerplate). Any RSS name or timecode that cannot be carried keeps the prior text → `safe_internal_multi_source`. Merged text: `source_type=multi_source`, method `deterministic_v4+multisrc_v1`, source hash = fingerprint of RSS + YouTube + prior + Spotify inputs.
- Step 2 (identity): title (HU-normalised exact + fuzzy), channel dominance, episode number, dates (later archive uploads not treated as wrong), RSS content overlap, verified Spotify (≥0.8 show+episode, name/date method) as corroboration only. Correct → attribution only (`source_type=youtube_corroborated`, same text); incorrect → RSS (strict or link-free filtered) or quarantine. No YouTube link was written.
- Step 3 (AI, one-off): 93 ambiguous rows, `gpt-6-sol`, store:false, strict JSON schema; every cited quote verified verbatim, "yes" needs cross-source evidence, confidence ≥0.85. Reserved atomically before calls; **actual $0.409514** (cap $2 total / $1 per day); control switched off after the run.

| Result (499) | Rows | Text write |
|---|---:|---|
| Merged RSS + verified YouTube (internal) | 59 | yes |
| Wrong video → RSS (1 deterministic, 6 AI "different episode") | 7 | yes |
| Unverified, prior ⊂ RSS → RSS | 3 | yes |
| Identity confirmed → attribution only (60 deterministic, 69 AI) | 129 | attribution |
| safe_internal_multi_source (prior kept) | 222 | no |
| RSS already covered / verified kept | 29 | no |
| Protected (other lanes / backups since) | 16 | no |
| Quarantine (no safe source) | 3 | no |
| Still needs_review (text with URL fragments 19, AI uncertain 9, unverified names 2, low info 1) | 31 | no |

Batches (all active, backup + CAS): canary `a40ac81a-f7c4-4041-b3af-047debb91681` (19 rows; rollback test on `499bffd7-86fe-4103-a998-298fb6c15a13` restored 17/17 byte-exact, re-apply OK, repeat run 19/19 unchanged); deterministic `063f85fa…`, `70993aff…`, `3d51a761…`, `8b736744…`, `1d449fa7…`, `3fa33a94…`, `c6d36637…`, `e93ee2b5…`, `be7e9c21…`, `6d82e28d…`; AI-based `a946fa13…`, `0fe9a798…`, `a78099fb…`, `ea55eeb1…`, `6f934cd7…`, `c14573bb…`, `0667280c…`, `356bcaa9…`, `d83b9845…`, `1e0fe1ad…` (full ids in `clean_text_repair_queue_state.legacy_resolve_batch_ids`).

Checks: 198 written rows, 0 URLs, 0 hash drift, prior text is the prefix in all 188 merged/attributed rows; 12/12 RSS-only names found by the clean-text phrase index; 10/10 replaced rows no longer contain the wrong video's phrases. Public gate: merged/corroborated text never public; legacy YouTube-derived text is public as "YouTube" only with v1-verified attribution (162 rows) — 2,021 unverified legacy texts that became visible at 20:54 are internal again. Anonymous reads of the new tables return nothing.
