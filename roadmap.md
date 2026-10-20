# Traffic-led improvements

## Visitor-first processing
- [x] Apply visitor-first priority without changing AI models or quality gates: maintenance before relevance before Astra; public and newest relationships first.
- [x] Verify configured controls and priority behavior; keep credit pause intact. Three focused tests passed; both deployed bulk runners returned higher_priority_work:seo_jobs_pending without paid AI calls. No credit recovery or complete processing run attempted.

- [x] Compare visits, Google traffic and listening across complete weeks.
- [x] Unify page/player session attribution without rewriting historical events.
- [x] Test the shared session and verify page-to-play attribution in the preview (7 focused tests passed; actual play_start matched landing ID).
- [x] Summarize measured growth, limitations and next priorities (two unrelated legacy static tests conflict with the existing trusted-HU gate; unchanged).
## Person name search (2026-10-20)
- [x] Person-first indexed name search with role/evidence ordering, ambiguity marking and homonym disambiguation; deployed `search-hybrid`; clean-text name index added.
- [x] Read-only relationship backlog audit and human review order (docs/person-search-evidence-2026-10-20.md).
- [ ] Publish the frontend so visitors see evidence labels and the same-name notice (waits on user publish).

## OpenAI Batch person review (2026-10-20)
- [x] Batch adapter, RPCs, admin dry-run page, golden labelling, tests, deploy (no paid call).
- [ ] Owner adds a NEW/rotated OPENAI_API_KEY in Secrets (blocked: owner action).
- [ ] Owner labels 100-200 goldens, then authorizes golden model comparison and a 1,000-2,000 pair pilot with daily/total caps (blocked: owner authorization).
- [ ] After pilot gates pass: scheduled polling and escalation enablement (planned).

## Clean-text + best-source repair (2026-10-20, before mass person GPT)
- [ ] Harden clean-text runner: shared validator, no empty/overcut "done", keep prior good text, bounded retry/quarantine.
- [ ] Best-source runner: incremental change detection for new transcripts on done episodes, bounded indexed batches, no full-table load.
- [ ] Stage/dry-run + backup/rollback; 20-100 canary only after gates pass.
- [ ] Gemini AI trim off for this fix; optional OpenAI extract-only adapter stays disabled.
- [ ] Tests, deploy, canary report with before/after metrics.
