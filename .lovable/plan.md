
# HU Deep Archive Backfill

## Findings (PART 1 — live audit)

HU-approved universe (`is_hungarian=true AND language_decision='accept_hungarian'`):

- **691 podcasts**, **63 664 episodes** already indexed
- Tiers: S=38, A=172, B=443, C=38, D/E=0
- RSS deep-hydration: **671/691 done**, 20 pending
- PodcastIndex (PI) historical backfill: **621/691 done**, 70 pending
- Episode-count buckets: <20 ep = 283 pods, 20–100 = 250, 101–500 = 127, 500+ = 31

**Conclusion:** the existing two-pass pipeline (`deep-hydrate-runner` over live RSS + `pi-episode-backfill` over the PodcastIndex archive) has already done ~90% of the work for HU. The real gaps are:

1. **Neither runner is HU-strict.** `deep-hydrate-runner` has no language filter at all; `pi-episode-backfill` uses only `is_hungarian=true` (not the `language_decision` gate). This means non-HU shows can leak into runs.
2. **B/C-tier PI backfill is gated by a manual `pi_backfill_approved=true` flag.** For HU-approved B/C this is the right gate in general but no one has bulk-approved the HU B-tier (443 shows) — so their PI historical archives are not being pulled.
3. **No HU-specific orchestrator** that combines "fetch live RSS to exhaustion → then PI sweep" per podcast with a single budget.
4. **No admin dashboard** for archive completeness / progress.
5. **Sitemap eligibility for thin old episodes** is not explicitly gated; needs a minimum-content rule.

Because the heavy backfill is already mostly done, the plan is small and focused — not a from-scratch build.

## Plan

### Step 1 — HU-strict gating on existing runners (PART 2)

Edit `supabase/functions/deep-hydrate-runner/index.ts` candidate query: add
`.eq("is_hungarian", true).eq("language_decision", "accept_hungarian")`.
Edit `supabase/functions/pi-episode-backfill/index.ts` filter to add `.eq("language_decision", "accept_hungarian")` alongside the existing `is_hungarian=true`.

Outcome: every future run is HU-only by construction; no risk of pulling non-HU archives.

### Step 2 — Bulk-approve B-tier HU for PI backfill (PART 2)

One `supabase--insert` UPDATE:
`UPDATE podcasts SET pi_backfill_approved=true WHERE is_hungarian=true AND language_decision='accept_hungarian' AND rank_label='B' AND pi_backfill_completed_at IS NULL;`

Leaves C-tier behind a manual approval (admin can approve case-by-case from the dashboard in Step 4).

### Step 3 — `hungarian-deep-archive-backfill` orchestrator edge function (PART 3)

Thin orchestrator that, per run, picks N HU podcasts (priority order: featured → S → A → B-approved → C-approved) where either `full_backfill_completed_at IS NULL` or `pi_backfill_completed_at IS NULL`, and for each one invokes:

1. `deep-hydrate-runner` for that podcast id (RSS exhaustion) if RSS pass not done.
2. `pi-episode-backfill` for that podcast id (`podcast_ids:[...]`) if PI pass not done.

Reuses existing dedupe (`podcast_id,slug` + guid + episode_url checks already in `fetch-one.ts` and `pi-episode-backfill`). Calls `checkBackgroundJobsAllowed` (incident guard). Controls in `app_settings.hu_deep_archive_controls`:

- `max_podcasts_per_run` (default 8)
- `max_new_episodes_per_run` (default 1500)
- `max_runtime_seconds` (default 110)
- `tier_filter` (default `["S","A","B"]`)
- `dry_run` (default false)
- `force_refresh` (default false — when true, re-pulls even if `*_completed_at IS NOT NULL`)
- `per_domain_min_ms` (default 1500) — host-throttle between feeds on the same host

Logs every run into a new lightweight `hu_deep_archive_runs` row (or extends `app_settings.hu_deep_archive.last_run` like `deep_hydration` does — simpler).

Cron: **not added by default.** Triggered from the admin dashboard. Safer for soft-open week; can be cron-scheduled later.

### Step 4 — Admin dashboard `/admin/archive-backfill` (PART 6)

New page `src/pages/AdminArchiveBackfillPage.tsx`, linked from `AdminHubPage`. Read-only stats sourced from a new SQL view `v_hu_archive_completeness` (HU podcasts × counts/bucket/tier/pass-status). Controls:

- "Run dry audit" — invokes orchestrator with `dry_run=true`
- "Run backfill batch" — invokes with current controls
- Pause / Resume — flips `app_settings.hu_deep_archive_controls.enabled`
- Tier filter + max-new-episodes inputs (persist to `app_settings`)
- Approve-for-PI button per podcast row (sets `pi_backfill_approved=true`)

Lists: total HU podcasts, total HU episodes, processed-today, remaining (RSS pass, PI pass), failed feeds, dup-skipped, top-30 "biggest potential gains" (PI `episode_count` vs DB count).

### Step 5 — Enrichment + indexing policy (PARTS 4 & 5)

No new runner code needed — the existing pipeline already absorbs new episodes:

- `seo-enrich-enqueue` picks up new episodes from HU-approved S/A/B/C pods (`ai_summary IS NULL`), already drains via `seo-enrich-runner` under a $50/day cap.
- `embed-episode-runner` picks new rows under its $3/day cap.
- `entity-backfill-runner` covers entity arrays for `ai_entities_version=0` HU episodes.

Add **one sitemap-eligibility rule** in `supabase/functions/sitemap/index.ts` episode query: only include episodes where `published_at IS NOT NULL AND (length(coalesce(ai_summary,'')) > 80 OR length(coalesce(description,'')) > 200)`. Thin old episodes stay searchable internally but stay out of the sitemap until enrichment fills them out. No noindex meta change needed (episodes not in sitemap simply aren't promoted; the existing route still renders).

### Step 6 — First dry audit (PART 7)

After Steps 1–4 ship, click "Run dry audit". Returns per-podcast `pi_items_available - current_count` deltas, top-30 list, estimated AI enrichment cost (avg ~$0.0008 per episode at current model), embedding cost (~$0.0001 per episode).

### Step 7 — First real batch (PART 8)

If dry audit is sane, run with: `tier_filter=["S","A"]`, `max_podcasts_per_run=15`, `max_new_episodes_per_run=2000`. Single click from dashboard.

### Step 8 — Verification report (PART 9)

Dashboard "Last run" panel renders the full before/after diff (episode counts, failed feeds, dup-skipped, enrichment + embedding backlog deltas, spend-cap status, public-site health from the last `mv_homepage_feed` refresh timestamp).

## Technical notes

```text
deep-hydrate-runner    ── RSS exhaustion ──► episodes (live feed)
pi-episode-backfill    ── PI historical  ──► episodes (archive)
        │
        ▼
hungarian-deep-archive-backfill (NEW)
        │  HU-strict, tier-priority, budgeted, resumable
        ▼
seo-enrich-runner / embed-episode-runner / entity-backfill-runner
        │  unchanged, already HU-aware, daily-cap gated
        ▼
sitemap (NEW thin-content gate) → public
```

Files to touch:
- `supabase/functions/deep-hydrate-runner/index.ts` (HU gate)
- `supabase/functions/pi-episode-backfill/index.ts` (HU gate)
- `supabase/functions/sitemap/index.ts` (thin-episode gate)
- `supabase/functions/hungarian-deep-archive-backfill/index.ts` (NEW)
- `src/pages/AdminArchiveBackfillPage.tsx` (NEW) + route in `App.tsx` + link in `AdminHubPage.tsx`
- migration: SQL view `v_hu_archive_completeness`, `app_settings` rows for `hu_deep_archive_controls`
- one-off `supabase--insert`: bulk-approve HU B-tier for PI

No cron added in this plan — runner is dashboard-triggered. Cron can be added in a follow-up once the first 2–3 manual runs look clean.

Safety: incident guard wired in; daily AI/embedding caps unchanged ($50 / $3); per-domain throttle prevents RSS host hammering; idempotent via existing dedupe; non-HU podcasts impossible to touch (gated at SQL level).
