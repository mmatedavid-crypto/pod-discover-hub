# Production Backend Deploy

The frontend can deploy while Supabase migrations and edge functions stay stale. When that happens the app falls back where possible, but admin intelligence panels and repair runners will show unavailable/404 states.

## Required GitHub Secrets

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_DB_PASSWORD`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_READONLY_DATABASE_URL`

`SUPABASE_READONLY_DATABASE_URL` is used only by the preflight and production
pipeline verifiers. It should be a read-only Postgres connection string, not a
service-role key.

## Deploy

Run GitHub Actions workflow:

- `Deploy Supabase backend`

It will:

1. Link project `yoxewklaybougzpmzvkg`.
2. Push database migrations.
3. Deploy every edge function directory that has an `index.ts`.
4. Run `npm run verify:production-backend`.
5. Run `npm run verify:production-pipeline`.

The workflow also runs on pushes to `main` when `supabase/**`, the production
verifier scripts, or the workflow itself changes. This keeps database
migrations and edge functions from silently lagging behind the frontend deploy.

## Current Critical Backend Checks

- `get_data_quality_snapshot_v1`
- `get_data_repair_plan_v1`
- `get_entity_quality_snapshot_v1`
- `get_homepage_rails_v1`
- `intelligence-reprocess-admin`
- `clean-text-autopilot`
- `episode-clean-text-candidate-runner`
- `episode-clean-text-candidate-promoter`
- `episode-clean-text-runner`
- `episode-best-text-source-runner`
- `episode-article-pairer`
- `data-repair-apply-runner`
- `entity-quality-apply-runner`
- `entity-quality-autopilot`
- `database-quality-fast-lane`

## Current Pipeline Gates

`npm run verify:production-pipeline` must pass after deploy. As of the
clean-text v4 drain work, this includes:

- `requeue_legacy_clean_text_v4_backfill(integer,text[])` exists.
- `episode_clean_text_controls.use_best_text_source=true`.
- `episode_clean_text_controls.legacy_v3_backfill_enabled=true`.
- `episode_clean_text_controls.method_version='deterministic_v4'`.
- `episode_article_candidates` exists and `episode_best_text_source` accepts
  `source_type='article'`.
- At least 50% of accepted Hungarian episodes with descriptions have
  `deterministic_v4%` clean text before the full pipeline is considered green.
