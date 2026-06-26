---
name: Google Indexing API integration
description: Daily cron pings Google Indexing API with up to 200 fresh HU URLs (new episodes, not-indexed-yet, new hubs) to cut indexing time from days to hours
type: feature
---
# Google Indexing API — LIVE 2026-06-26

## What
Edge function `google-indexing-submit` directly pings `indexing.googleapis.com/v3/urlNotifications:publish` with up to 200 URLs/day (Google's per-property hard cap).

## Auth
- Service account: `podiverzum@copper-diorama-496119-t3.iam.gserviceaccount.com`
- Project: `copper-diorama-496119-t3` (Google Cloud)
- Secret: `GOOGLE_INDEXING_SA_JSON` (full service account JSON)
- RS256 JWT signed natively in Deno via `crypto.subtle` (no external deps), exchanged for OAuth access token at `oauth2.googleapis.com/token`, scope `https://www.googleapis.com/auth/indexing`
- **Manual prerequisite (user step):** add the service account email as **Owner** (not Full) in GSC → Settings → Users and permissions, and enable **Indexing API** in Google Cloud Console for the project. Without Owner, all submissions return 403.

## URL selection priority
1. New HU episodes ≤24h (any tier — long-tail welcome)
2. ≤7d HU episodes with 0 GSC impressions (joined via `gsc_query_daily.page`), higher tier first
3. New podcasts ≤7d (`/podcast/:slug`)
4. New indexable people ≤7d (`/szemelyek/:slug`)
Daily cap 200, dedup, batch 10 parallel calls. State in `app_settings.indexing_api_state` (daily counts last 30d, last 30 runs, quota_exceeded_until on 429).

## Cron
- Job 99 `google-indexing-submit-daily` `0 5 * * *` (05:00 UTC daily)

## Admin
- `/admin/indexing-api` — runs dry-run/real, shows daily history + last 30 runs

## Why
GSC coverage 2026-06-12: 26 408 indexed / 126 017 discovered-not-indexed out of 152 425. New URLs sat 5-14 days before indexing. Direct ping = hours.

## Companion
- News-sitemap (cron 67/68) — sitemap-level
- IndexNow (cron 91) — Bing/Yandex
- Google Indexing API (cron 99) — Google direct
- Homepage `MostFelfedezve` rail — internal link juice to long-tail episodes (≤48h, any tier)

## Rollback
`UPDATE cron.job SET active=false WHERE jobid=99;` and `UPDATE app_settings SET value=value||'{"enabled":false}' WHERE key='indexing_api_state';`
