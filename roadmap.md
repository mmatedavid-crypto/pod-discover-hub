# Traffic-led improvements

## Visitor-first processing
- [x] Apply visitor-first priority without changing AI models or quality gates: maintenance before relevance before Astra; public and newest relationships first.
- [x] Verify configured controls and priority behavior; keep credit pause intact. Three focused tests passed; both deployed bulk runners returned higher_priority_work:seo_jobs_pending without paid AI calls. No credit recovery or complete processing run attempted.

- [x] Compare visits, Google traffic and listening across complete weeks.
- [x] Unify page/player session attribution without rewriting historical events.
- [x] Test the shared session and verify page-to-play attribution in the preview (7 focused tests passed; actual play_start matched landing ID).
- [x] Summarize measured growth, limitations and next priorities (two unrelated legacy static tests conflict with the existing trusted-HU gate; unchanged).