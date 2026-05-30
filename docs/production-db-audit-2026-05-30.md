# Production DB Audit - 2026-05-30

Read-only audit against the live Supabase Postgres project `yoxewklaybougzpmzvkg`.

## Executive Findings

- The live database has not received the latest GitHub backend migrations. Missing objects include `get_data_quality_snapshot_v1`, `get_data_repair_plan_v1`, `get_homepage_rails_v1`, `v_data_repair_queue`, `episode_clean_text_candidates`, and `ai_enrich_input_hashes`.
- The dedicated `readonly_codex` role can connect, but RLS still hides admin-only operational rows. Example: `episode_clean_text` has about 120k live rows in `pg_stat_user_tables`, but direct `SELECT` returns zero rows until an audit policy is deployed.
- Vector data exists at meaningful scale, but chunk-level vector search appears underused: `episode_chunks_embedding_hnsw` is 531 MB with only 19 scans.
- Topic extraction is incomplete: 57k episodes are still pending and 29k are skipped as short.
- Entity enrichment needs a coordinated refresh: every episode is below the current target `ai_entities_version >= 4` in the live database snapshot.
- There are redundant or low-value large indexes worth reviewing after query logs are checked.

## Live Counts

| Area | Count / Size |
| --- | ---: |
| podcasts | 1,550 |
| episodes | 138,384 |
| episode_embeddings | 133,952 |
| episode_chunks | 135,857 |
| people | 3,571 |
| organizations | 25,884 |
| person_episode_mentions | 40,227 |
| episode_organization_map | 115,578 |

## Largest Tables

| Table | Total size | Notes |
| --- | ---: | --- |
| episodes | 1.4 GB | Main content table. |
| episode_embeddings | 1.3 GB | Episode-level vectors. |
| episode_chunks | 1.1 GB | Chunk vectors/content. |
| ai_call_audit | 577 MB | 1.14M rows, important for spend audit. |
| episode_ai_classifications | 386 MB | Topic/classification output. |
| ai_enrichment_jobs | 302 MB | AI job queue/cache history. |
| people | 177 MB | High dead/live ratio at audit time. |
| episode_clean_text | 156 MB | Hidden from `readonly_codex` by RLS before audit policy. |

## Data Quality Signals

| Signal | Count |
| --- | ---: |
| missing published_at | 199 |
| missing audio_url | 218 |
| missing description | 5,565 |
| missing ai_summary | 9,257 |
| clean_text_status = done | 120,728 |
| clean_text_status = skipped | 17,656 |
| topic_extraction_status = done | 26,919 |
| topic_extraction_status = pending | 57,384 |
| topic_extraction_status = skipped_short | 29,365 |

Notes:

- `episodes.summary` is effectively unused/empty in the live snapshot.
- `episode_clean_text` needs a follow-up audit after RLS audit access is deployed.
- Duplicate GUIDs exist. Some GUIDs appear 4 times, especially older `bazska.hu/alleyoop` items. RSS dedupe should be reviewed by `(podcast_id, guid)` and source URL variants.

## Vector And Search Findings

- `idx_episode_embeddings_hnsw_cos`: 644 MB, 2,515 scans. This appears useful.
- `episode_chunks_embedding_hnsw`: 531 MB, 19 scans. Large and currently underused.
- `idx_episodes_search_text_trgm`: 212 MB, 13 scans. Low usage compared to size.
- `idx_episodes_ai_summary_trgm`: 175 MB, 45 scans.
- `idx_episodes_search_tsv`: 72 MB, 849 scans. FTS appears more used than trigram search.

Do not drop these blindly. First collect query patterns and decide whether product code should use them more, especially chunk search.

## Redundant / Suspicious Indexes

- `ai_call_audit` appears to have overlapping job-created indexes:
  - `idx_ai_call_audit_job_type_created`
  - `idx_ai_call_audit_job_created`
- `ai_enrichment_jobs` appears to have duplicate unique cache indexes:
  - `ai_jobs_unique_cache`
  - `uq_ai_jobs_kind_target_hash`
- `episode_clean_text_source_hash_idx` had 0 scans in the current stats but may become useful after candidate/hash dedupe rollout.
- Several `people` partial indexes have near-zero scans and should be reviewed once entity hub flows stabilize.

## RLS / Exposure Findings

Public read policies exist on several heavy intelligence tables:

- `episodes`
- `episode_embeddings`
- `episode_chunks`
- `podcast_embeddings`
- `episode_organization_map`
- `person_episode_mentions`

This may be intentional for current frontend/RPC behavior, but it should be revisited before B2B monitoring launches. Raw chunk text and embeddings are strategic data assets.

The `readonly_codex` audit role also needs RLS policies for operational tables. Added migration:

- `20260530161000_readonly_codex_audit_access.sql`

## Missing Backend Deployment

The live DB does not yet include the latest backend objects from GitHub:

- `20260530120000_ai_enrich_input_hashes.sql`
- `20260530133000_homepage_rails_rpc_and_autopilot_watchdog.sql`
- `20260530140000_data_quality_observability.sql`
- `20260530142000_episode_quality_indicator_audit.sql`
- `20260530144000_data_repair_planner.sql`
- `20260530150000_data_repair_apply_runner.sql`
- `20260530152000_repair_queue_clean_text_refresh.sql`
- `20260530161000_readonly_codex_audit_access.sql`

Until these are deployed, the admin quality snapshot, repair plan, no-AI repair runner, clean-text autopilot, and homepage rails RPC are not live.

## Recommended Order

1. Deploy the missing Supabase migrations and edge functions.
2. Re-run production backend verification.
3. Re-run DB audit after `readonly_codex` can see operational tables through RLS.
4. Audit `episode_clean_text` quality directly: dirty links, overcleaning, short/empty rows, source hash coverage.
5. Run no-AI repair plan first: legacy rank neutralization, stale status cleanup, duplicate GUID report.
6. Only then spend AI budget on changed clean-text inputs using hash dedupe.
