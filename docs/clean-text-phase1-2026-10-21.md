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
