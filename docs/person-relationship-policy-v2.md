# Person relationship assessment, v2

Owner request, 2026-11-17: repair the principle after the blinded diagnostic,
rather than repeat the same source-constrained requests at larger scale.

The original diagnostic returned 2 participant matches among 8 historical
accepted pairs, 13 abstentions among 16 new pairs, and no false acceptance among
8 rejected references. This is an end-to-end diagnostic of that input/policy,
not an estimate of general model intelligence. The 31 historical labels include
show-host and authorship ambiguities and are not a representative quality gate.

## Changed question

Ask which relationships exist and what each claim rests on. Keep multiple roles
per person: episode host/guest/speaker/narrator, show host, author/editor/producer/
musician, subject and mention. A name missing from an episode description is
unknown participation, never an absence-based rejection.

| Claim basis | Stored result | Next consumer |
| --- | --- | --- |
| Explicit episode evidence | Exact supplied quote plus role | Existing episode-credit/role-label review; source hash and identity anchor still required |
| Explicit show evidence | Show role, separate from spoken appearance | Narrow publisher-backed `person_host_rules` review; `resolved_show_host` semantics |
| Contextual inference | Reasoning and supplied supporting context | Source research queue proposal; never silently discarded as unknown |
| Model background knowledge | Clearly labeled hypothesis, no fabricated quotation | Source research queue proposal; not human reference or verified public link |

The shadow result stores `route` for each claim. This is a persisted routing
proposal, not an automatically created research job. Public application is
always false in v2 until a separately validated, matching-policy application
path exists. Existing production policies, paid submission pauses, costs and
quality gates are not switched by this change.

Every candidate receives an assessment, including missing model responses.
The request explicitly whitelists person ID/name/approved aliases and episode
sources. Human labels, repair notes, identity-risk flags and reference targets
are withheld; identity blockers are enforced after the model's response.

## Source eligibility

The existing rich-content request now accepts short named credits and named
interview titles. Eligibility is not a relationship decision. Wrong names,
partial names, future-episode announcements, link-only and empty short texts
remain ineligible. Existing application protections are unchanged.

The relationship-only shadow request may also assess a named candidate given
an identified show and episode, even without a useful description. It must
distinguish a hypothesis from supplied evidence. Thus the absence of a long
description is measured instead of being hidden by preflight exclusion.

Offline replay of the 19 original inputs: content-eligible episodes 11 -> 14;
relationship-assessable contexts 11 -> 19. These are eligibility counts, not
model answers, accepted pairs, or backlog closures.

## Same transport, versioned request

Only `person-relevance-openai-batch` invokes the helper. Set
`input.relationship_policy = 'person-relations-v2'` on a new, explicitly prepared
shadow item. Existing items without this field still build/ingest rich-v1 output
with their original custom IDs. Unknown or mixed policies fail before spending.
The same audited `person_blind_benchmark_step_v1` RPC, lease, reservation, ledger,
submission reconciliation and raw/validated result storage are used. No new
provider client, key, paid channel, cron or grant is introduced.

Before preparing a v2 job, verify the deployed tick advertises
`benchmark.supported_policies` containing `person-relations-v2`. An old worker
does not understand the new input marker, so do not enqueue v2 merely because
the commit exists. Re-read jobs and ledger after network failures; never send a
duplicate. Existing production submissions remain owner-paused.

The next proposed cohort is only the 8 previously preflight-blocked episodes
(13 pairs), never sent to the model. Conservative reservation computed with the
current request: $0.00804615, subject to the live ledger and unchanged caps.
Do not repay the 16 evaluated pairs or the 2 cached pairs without new evidence
or a separate explicit paid experiment authorization. No job is implied by
this document; record an actual job/batch ID before calling it submitted.

## Evaluation

Report raw proposed positives, source-supported positives, inference-only
positives, false acceptances against compatible negative references, abstention,
source eligibility and validation separately. `assessReference` compares only
the requested relationship target. Show-host, credit and episode-participant
targets are distinct. Legacy target-unspecified labels are diagnostic only;
their labels remain unchanged. No programmatic `passed` quality gate is minted.

These examples are the development diagnostic, not an untouched holdout. A
future rollout needs an independent set of existing human decisions, matched
to the correct target. The user need not label the entire backlog. AI answers,
including this assistant's classifications, must not become human goldens.

Validation: focused relationship-policy, benchmark-worker, episode-content,
episode-worker and role-label tests; TypeScript check of changed modules/tests.
Deploy the existing edge function after sync. A code push or web-hosting publish
alone is not proof that the edge worker has changed.
