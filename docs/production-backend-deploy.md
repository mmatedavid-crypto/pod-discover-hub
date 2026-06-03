# Production Backend Deploy

This project uses Lovable Cloud for the production backend. Do not deploy the
backend from GitHub Actions and do not run `supabase link`, `supabase db push`,
or Supabase CLI deploy commands from CI.

## Deploy flow

- Frontend code is handled by Lovable preview / publish.
- Edge functions are deployed by the Lovable agent / Lovable Cloud sync.
- Database migrations are applied only by the Lovable agent with the internal
  migration tool.

GitHub/Codex can edit `supabase/functions/**` and add SQL files under
`supabase/migrations/**`, but it must stop there. If a migration needs to run,
leave it for the Lovable agent to apply.

See `CODEX_INSTRUCTIONS.md` before changing backend-related files.

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
