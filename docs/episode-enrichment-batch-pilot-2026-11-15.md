# Rich-source episode pilot

Owner request: process 10,000 distinct episodes once through the existing OpenAI
Batch worker, and connect useful results to the site. No Lovable AI calls.

## Current prepared cohort

- Production project: `e6c7bc4d-8a57-443d-a16e-7f06fe12ee5f`.
- Backend: `yoxewklaybougzpmzvkg`.
- 10,000 distinct episodes from 1,283 shows, covering 21,819 pending source pairs.
- Cohort audit: `89731937-6557-4487-8e00-b2c7e1b36537`.
- Selection is not submission, processing, or a resolved person–episode pair.
- Schema and selected worklist are installed; execution/public projection stay
  disabled until the changed worker and frontend are deployed and verified.

## One request per episode

Input includes the title/date, original RSS episode description, available clean
text and transcript, matched Spotify description, confirmed YouTube description,
cached publisher episode text, candidate identities with accepted aliases and
disambiguation context, and the existing public topic taxonomy. Show descriptions
are explicitly marked context, never episode proof. Identical sources are
deduplicated. Existing source length limits remain visible in the SQL builder;
oversized packages are refused rather than silently shortened again.

| Returned field | Actual consumer |
|---|---|
| Short, sourced Hungarian summary | Missing `episodes.ai_summary`, through `apply_episode_seo_result_v1`; existing episode UI |
| Up to four topics | Missing `episode_extracted_topics` through `apply_episode_topics_v1`; valid existing topic IDs also enter `episode_topic_map` |
| Up to three questions discussed | `get_episode_enrichment_public_v1` → `EpisodeSourceInsights` on the episode page; no fabricated answers |
| Up to five organizations/books/products/places | Same public projection; named search links on the episode page |
| Supported format | Same public projection on the episode page |
| Candidate person roles | Existing deterministic role parser and `apply_person_role_label_v1` only; AI-only roles remain private proposals |

Every usable output includes a source ID and literal evidence. Public projections
exclude evidence quotations, raw source text, transcripts, identity proposals,
and internal errors. Source fingerprints prevent stale output application.
Existing summaries and extracted topics are preserved. No biographies or new
person identities are published. No absence-based rejection is introduced.

## Execution and accounting

- Existing `person-relevance-openai-batch` tick invokes this optional lane after
  polling its older jobs. The cron schedule is unchanged.
- Model: `gpt-6-luna`, Responses Batch, `completion_window=24h`, reasoning `none`.
- Official prices checked 2026-11-15: Batch input $0.05, cached input $0.005,
  output $0.25 per million tokens. This is a trial choice, not a quality claim.
- Same `external_ai_budget_job_sync` / `external_ai_budget_charge_v1`, lane
  `evidence_pilot`; no new paid channel or grant. The existing $5 pilot and $10
  daily limits remain unchanged. Prepared cohort does not guarantee that all
  10,000 can fit the remaining allowance.
- At most 500 requests per job / 12 open jobs; conservative UTF-8-byte input
  token bound, full output reservation, no assumed cache savings. Job sizes
  shrink near the cap after earlier reservations settle.
- Paid outputs resume in chunks of at most 40 items or 60 seconds. A crash does
  not repay the same inputs. Ambiguous batch submission is reconciled from
  OpenAI job metadata before any further submission.
- Invalid/stale/uncertain outcomes are visible in counts; they are not called
  resolved. New source or a separate authorization is needed for a paid retry.
- Per-episode repair audits/backups and compare-before-write rollback exist.
  `undo_episode_enrichment_item_v1` requires the owned backlog lease and refuses
  to overwrite a newer independent edit.

## Deployment and verification

1. Sync this commit into the specified Lovable project. Publish the frontend and
   redeploy the existing `person-relevance-openai-batch` function with both new
   shared modules. GitHub commit presence alone is not deployment evidence.
2. The SQL migration was directly applied with the owner's authorization. It is
   idempotent; do not assume that Supabase migration history was also updated.
3. Check the deployed worker's `episode_pilot_status` action (admin) or an
   authenticated cron tick while the pilot remains disabled. Only then enable
   `episode_enrichment_pilot_controls.enabled` and `public_enabled` using a
   guarded JSON patch under the owned backlog lease. Do not change spending or
   person quality gates.
4. Verify an actual OpenAI batch ID, ledger reservation, and submitted item count.
   After return, verify applied fields/public projection and record genuine
   person closures separately from enriched episodes.

Local validation:

```sh
node scripts/run-vitest.mjs run src/test/episodeEnrichmentBatch.test.ts src/test/personRoleLabel.test.ts src/test/EpisodeSourceInsights.test.tsx
node scripts/run-vite.mjs build
```

`supabase/tests/episode_enrichment_batch_pilot.sql` creates a temporary test
function; call it with the owned lease token. It tests real writeback,
idempotence, source mismatch, stale input, privacy, and undo inside a rolled-back
subtransaction. It never creates a human reference label or incurs API cost.

Official model and Batch references:
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/guides/batch
- https://developers.openai.com/api/docs/pricing
