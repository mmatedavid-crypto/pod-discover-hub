# Production Backend Deploy

The frontend can deploy while Supabase migrations and edge functions stay stale. When that happens the app falls back where possible, but admin intelligence panels and repair runners will show unavailable/404 states.

## Required GitHub Secrets

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PUBLISHABLE_KEY`

## Deploy

Run GitHub Actions workflow:

- `Deploy Supabase backend`

It will:

1. Link project `yoxewklaybougzpmzvkg`.
2. Push database migrations.
3. Deploy the intelligence/repair edge functions.
4. Run `npm run verify:production-backend`.

## Current Critical Backend Checks

- `get_data_quality_snapshot_v1`
- `get_data_repair_plan_v1`
- `get_entity_quality_snapshot_v1`
- `get_homepage_rails_v1`
- `intelligence-reprocess-admin`
- `clean-text-autopilot`
- `episode-clean-text-candidate-runner`
- `episode-clean-text-candidate-promoter`
- `data-repair-apply-runner`
- `entity-quality-apply-runner`
- `entity-quality-autopilot`
- `database-quality-fast-lane`
