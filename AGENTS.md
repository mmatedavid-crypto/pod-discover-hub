# Project architecture rules

- Gate bulk relationship and Astra work through the shared processing-priority check before claiming or paid work, and bound request overrides by stored controls, because backlog size must not displace visitor-facing maintenance.

- Resolve person and organization chip linkability through `get_linkable_entities` in one batched request, because per-card or per-kind reads slow search result rendering.
- Background runners must re-read shared control state before persisting telemetry, because an in-flight whole-object write can undo an external pause.
- Serve episode Q&A pilot content only through `episode_answers_public` / `topic_episode_answers`, because the base table holds private transcript excerpts that must never reach the browser.
- Page and player telemetry must use `getAnalyticsSessionId` for one anonymous tab-scoped ID, because separate IDs prevent reliable landing-to-listening attribution; historical events must not be rewritten or treated as cross-session returning listeners.
- Visitor episode lists sorted newest-first must match an existing episodes index sort order (including NULLS LAST), because an unmatched sort reads the whole episodes table and times out under background load.
- Emit NewsArticle and Google News sitemap entries only for published, live Podiverzum Heti editorial articles (via `_shared/heti-editorial.ts`), never for podcast catalog pages or hubs, and never name the site publisher as publisher of third-party podcasts, because RSS show notes are not original journalism.
