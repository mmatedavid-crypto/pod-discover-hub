# Person–episode relevance: OpenAI Batch adapter (2026-10-20)

HU project only. No paid OpenAI request has been sent. The adapter is deployed but fails closed.

## Implemented
- `supabase/functions/_shared/person-relevance-openai-batch.ts` — pure policy: disabled zero-cap defaults, idempotent
  `custom_id` (`prompt_version:tier|person|episode|source_hash|attempt`), Responses API request lines (strict JSON schema,
  `store:false`, minimized input), upper-bound and actual cost, Batch output parsing (partial/error lines), decision policy,
  submission gates, golden metrics, pilot design.
- `supabase/functions/person-relevance-openai-batch/index.ts` — admin-only (`user_roles.admin`) actions:
  `status`, `preview` (dry run, no OpenAI call, no writes), `label_golden`, `submit`, `poll`, `cancel`, `release`, `rollback`.
  `OPENAI_API_KEY` is read server-side only. No cron.
- `drizzle/migrations/0063_person_relevance_openai_batch.sql` — job/item/audit/golden tables; bounded candidate RPC that
  excludes pairs with any accepted/rejected/manual row or an active lease; 26 h leases; cost reservation against
  authorized pilot + daily + total caps; audited apply (only pending rows, source hash and lease re-checked); rollback that
  skips rows changed after the batch.
- `drizzle/migrations/0064_person_judge_source_with_hash.sql` — DB-side source hash, identical to the claim hash.
- `src/pages/AdminPersonRelevanceBatchPage.tsx` at `/admin/person-relevance-batch` — blockers, caps, dry-run samples with
  cost estimates, golden labelling buttons, job table.
- Tests: `src/test/personRelevanceOpenAIBatch.test.ts` (9) and isolated SQL `scripts/test-person-openai-batch-sql.mjs`.

## Safety rules enforced in code
- Accept only `same_person`, score ≥ 0.85, and an evidence phrase that occurs in the source text.
- Identity-ambiguous / same-name persons are never auto-accepted; no merges.
- AI rejection becomes `needs_review` (`allow_ai_rejection=false`); no hiding or deletion.
- Accepted, rejected and manually validated links are never overwritten.
- Old Gemini `person_relevance_judge_controls` stays `enabled=false`.

## Dry-run measurements (2026-10-20, 75 sampled pairs)
- ~725–880 input tokens per pair; 88–96 % of deep-backlog samples eligible; the newest pairs mostly wait for clean text.
- Upper bound (full 1,500 output tokens, Batch 50 %): gpt-6-luna ≈ $0.00042/pair, ≈ $0.63 per 1,500-pair pilot,
  ≈ $96 for the 227,552-pair backlog. gpt-6-sol ≈ 20×, gpt-6-astra ≈ 100× that. Real output is far smaller, so actual cost
  should be well below the upper bound.

## Activation gates (owner actions, in order)
1. Add a NEW/rotated `OPENAI_API_KEY` in Project Settings → Secrets; set `key_rotation_confirmed=true`.
2. Label 100–200 goldens on the admin page (target strata: participant 60, mention 40, subject 20, identity risk 20, short text 10).
3. Authorize a golden comparison (`golden_eval`, Luna vs Sol) with a cap, then a 1,000–2,000 pair pilot:
   set `enabled=true`, `authorized_pilot={max_requests,total_cap_usd,daily_cap_usd}`, `daily_cap_usd`, `total_cap_usd`.
4. Review pilot precision; only then consider escalation and scheduled polling.

## First paid run (2026-10-20, owner-authorized)
- Owner confirmed a new key and authorized $10 total / $10 daily; `authorized_pilot.max_requests` = full backlog so the
  dollar cap is binding. `max_requests_per_job` must be stored in controls (the claim RPC reads it from the row).
- `tick` action (cron `person-relevance-openai-batch-tick`, every 10 min): polls/ingests, then submits the next primary
  batch sized from the remaining budget, only when all gates pass (incl. processing priority). Cron-triggered calls can run
  only `tick`. Controls pause with `authorized_budget_exhausted` at the cap; the cron unschedules itself once controls are
  disabled and no submitted job is left to ingest.

## Planned, not implemented
- Automatic stratified golden sampler (labelling uses dry-run samples + role filter).
