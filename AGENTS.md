# Project architecture rules

- Gate bulk relationship and Astra work through the shared processing-priority check before claiming or paid work, and bound request overrides by stored controls, because backlog size must not displace visitor-facing maintenance.

- Resolve person and organization chip linkability through `get_linkable_entities` in one batched request, because per-card or per-kind reads slow search result rendering.
- Background runners must re-read shared control state before persisting telemetry, because an in-flight whole-object write can undo an external pause.
- Serve episode Q&A pilot content only through `episode_answers_public` / `topic_episode_answers`, because the base table holds private transcript excerpts that must never reach the browser.
- Page and player telemetry must use `getAnalyticsSessionId` for one anonymous tab-scoped ID, because separate IDs prevent reliable landing-to-listening attribution; historical events must not be rewritten or treated as cross-session returning listeners.
- Visitor episode lists sorted newest-first must match an existing episodes index sort order (including NULLS LAST), because an unmatched sort reads the whole episodes table and times out under background load.
- Emit NewsArticle and Google News sitemap entries only for published, live Podiverzum Heti editorial articles (via `_shared/heti-editorial.ts`), never for podcast catalog pages or hubs, and never name the site publisher as publisher of third-party podcasts, because RSS show notes are not original journalism.
- Person name search must resolve exact catalog names and indexed person links before any text scan, rank accepted participant > subject > mention > text-verified pending > text-only via `_shared/search-person-evidence.ts`, and never pin or merge an ambiguous or same-name identity, because synchronous ILIKE scans timed out and homonyms must not be asserted as one person.
- Bulk person–episode relevance review runs only through `person-relevance-openai-batch` with policy in `_shared/person-relevance-openai-batch.ts` and the `*_person_openai_batch_*` RPCs (lease, cost reservation, audited apply, rollback), because 24h async batches need durable leases, hard spend caps and reversible, protected writes.
