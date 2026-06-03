# Instructions for Codex (and any agent working via GitHub)

> **Read this first** before touching anything backend-related in this repo.

## TL;DR

- **Do NOT try to `supabase link`, `supabase db push`, or run any `supabase` CLI command against an external Supabase project.**
- **Do NOT add or rely on GitHub Actions workflows for migrations or edge function deploys.** They will fail.
- **Do NOT ask the user for `SUPABASE_ACCESS_TOKEN` or `SUPABASE_DB_PASSWORD`.** The user does not have them and does not need them.
- This project's backend is **Lovable Cloud** — a managed Supabase instance that **only the Lovable agent can write to** via internal tools.

## Why

The Supabase project behind this repo is provisioned and owned by **Lovable Cloud**. The user has no dashboard access, no DB password, and no service-role key for it. The `supabase/` folder in the repo is a **source-of-truth mirror**, not a deploy target you can push to from CI.

If you (Codex) try to `supabase link` against the project ref `yoxewklaybougzpmzvkg`, you will:
1. Fail at the link step (no valid access token / DB password exists in CI).
2. Leave the user thinking something is broken when nothing is.
3. Waste a deploy cycle.

The previously-existing `.github/workflows/deploy-supabase.yml` workflow has been retired for exactly this reason. **Do not recreate it.**

## What you CAN do as Codex

Your job is to **edit files in the repo**. That's it. Deploy happens elsewhere.

✅ **Edit edge functions** under `supabase/functions/<name>/index.ts`
   → They auto-deploy when the Lovable agent next syncs the repo (or immediately, via the Lovable UI).

✅ **Add new migrations** under `supabase/migrations/<timestamp>_<slug>.sql`
   → These are queued for the Lovable agent to apply. **Do not try to apply them yourself.**
   → File naming: `YYYYMMDDHHMMSS_short_description.sql` (UTC timestamp).
   → Every `CREATE TABLE public.<x>` must be followed by `GRANT` statements before `ENABLE ROW LEVEL SECURITY` / `CREATE POLICY`. See `mem://` core rules.

✅ **Edit frontend code** (`src/`, `index.html`, Tailwind config, etc.) — these are picked up by Vite automatically.

✅ **Edit shared edge function code** under `supabase/functions/_shared/`.

✅ **Edit `supabase/config.toml`** ONLY for per-function blocks (e.g. `verify_jwt = false`). Never touch the top-level `project_id`.

## What you CANNOT do

❌ Run `supabase` CLI commands expecting them to reach the live backend.
❌ Create or modify `.github/workflows/*` that try to deploy backend.
❌ Create or modify GitHub Actions secrets (`SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `LOVABLE_API_KEY`, etc.).
❌ Modify auto-generated files:
   - `src/integrations/supabase/client.ts`
   - `src/integrations/supabase/types.ts`
   - `.env`
❌ Apply migrations directly to the DB.
❌ Insert rows into `supabase_migrations.schema_migrations` manually.

## How deploys actually happen

| Change type | Who deploys | When |
|---|---|---|
| Frontend (`src/**`) | Lovable preview / publish | Instantly on save |
| Edge functions (`supabase/functions/**`) | Lovable agent | Next agent run, or manual via Lovable UI |
| Migrations (`supabase/migrations/**`) | Lovable agent only | When the agent explicitly runs `supabase--migration` for each file |
| Secrets | User (via Lovable UI) | Manual |
| Cron jobs / RLS / RPCs | Lovable agent (via migration tool) | Same as migrations |

## If you think a migration needs to run

1. Write the SQL file under `supabase/migrations/`.
2. **Stop.** Leave a clear note in your PR / commit message: `Migration pending: needs Lovable agent to apply via supabase--migration`.
3. Do not write fallback scripts, workflows, or "deploy helpers".

## If you think an edge function needs a secret

1. Reference it in code with `Deno.env.get('SECRET_NAME')`.
2. Add a note in the PR description: `Requires secret SECRET_NAME — user must add via Lovable Cloud → Secrets`.
3. Do not add `.env.example` entries with placeholder values for secrets that must come from the user.

## The two Supabase projects — don't confuse them

- **`yoxewklaybougzpmzvkg`** = the real backend (Lovable Cloud managed, ~135k episodes, ~1500 podcasts). Connected via `src/integrations/supabase/client.ts`. You cannot reach it from CI.
- **Any other Supabase project the user mentions** = a personal/empty project they created by accident while trying to debug. **Ignore it.** It has no data and no relevance to this repo.

## Domain note

- `podiverzum.hu` and `www.podiverzum.hu` → this project (HU, the one this repo backs).
- `podiverzum.com` and `www.podiverzum.com` → a **separate English project** with its own DB. Do not add any `.com → .hu` redirects in the Cloudflare worker (`.lovable/cloudflare-worker.js` / `infra/`). That would break the .com site.

## Summary

> You are a code editor, not a deploy pipeline. Edit files, commit them, describe what needs to happen next in plain English, and let the Lovable agent do the actual database/edge-function work.
