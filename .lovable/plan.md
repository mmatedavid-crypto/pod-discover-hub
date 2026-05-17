# HU-Only Language Gate & Cleanup

Critical fix: podiverzum.hu currently shows Arabic/English podcasts. Need durable language classification at ingestion + DB cleanup + public query guards. Big scope — done in 5 phases, each shippable.

## Phase 0 — Stop the bleeding (5 min)

1. Flip `app_settings.background_jobs.incident_mode = true` immediately (already supported by `_shared/incident-guard.ts`). This stops: rss-hunter, rss-self-healing, incremental-refresh, deep-hydrate, queue-drainer, ai-enrich, seo-enrich-*, embed-*, daily-social-post, entity-backfill, categorize-podcast-runner, pi-dump-process, ai-feed-scout, stt-runner, youtube-* — all already gated.
2. Public site stays up (incident-guard only used by background jobs).

## Phase 1 — DB schema (1 migration)

Add to `podcasts`:
- `language_decision text` (`accept_hungarian` | `reject_foreign` | `review_uncertain` | NULL)
- `hungarian_score int`, `foreign_score int`
- `detected_language text`
- `language_checked_at timestamptz`
- `language_evidence jsonb default '{}'`
- `language_rejection_reason text`
- `is_hungarian bool default false`

Add to `episodes`:
- `detected_language text`, `hungarian_score int`, `foreign_score int`
- `language_checked_at timestamptz`, `language_evidence jsonb default '{}'`

New tables:
- `podcast_language_review_queue` (id, podcast_id, title, rss_url, website_url, detected_language, hungarian_score, foreign_score, reason, evidence jsonb, status, created_at, reviewed_at)
- `podcast_language_cleanup_log` (id, podcast_id, title, rss_url, detected_language, hungarian_score, foreign_score, deletion_reason, deleted_related_episode_count, deleted_embedding_count, deleted_ai_job_count, deleted_at, evidence jsonb)

Indexes on `podcasts(is_hungarian, language_decision)`, `podcasts(language_checked_at)`.

Bootstrap: backfill `is_hungarian=true, language_decision='accept_hungarian'` for podcasts where `language ILIKE 'hu%'` AS A STARTING POINT — Phase 3 audit will re-classify and demote foreign ones.

## Phase 2 — Classifier (shared lib)

`supabase/functions/_shared/hu-language-classifier.ts`:

```ts
classifyHungarianPodcastCandidate({
  title, description, author, rss_language, rss_url, website_url,
  episode_titles[], episode_descriptions[], categories[]
}) => {
  language_decision, hungarian_score (0-100), foreign_score (0-100),
  detected_language, rejection_reason, evidence
}
```

Heuristic scoring (no AI call — fast, free, deterministic):
- **Script detection**: count chars in Arabic/Cyrillic/CJK/Hebrew unicode ranges. >5% non-Latin in combined corpus → immediate reject.
- **HU markers**: `őűáéíóúöü` accent chars, common HU words (`és, hogy, nem, van, csak, már, így, mert, lehet, magyar, podcast, beszélgetés, epizód, vendég, élet, világ, történet, ...`), HU bigrams (`gy, ny, ty, sz, cs, zs`).
- **EN markers**: stop words (`the, and, with, this, that, from, what, your, about, episode, show, podcast, host, guest`), no HU accents anywhere.
- **DE/FR/ES/IT markers**: smaller wordlists for tagging detected_language.
- **RSS language**: explicit `en/ar/de/...` + EN/foreign text evidence → reject. `hu/hu-HU` → +30 HU score. Empty → neutral.
- **Domain hints**: `.hu`, `podkaszt.hu`, `hallod.hu`, `telex.hu`, `444.hu`, `index.hu`, `partizan`, `mandiner`, `g7.hu` → +20 HU. Known foreign: `npr.org, bbc.co.uk, theringer.com, sans.org, cisa.gov` → +30 foreign.
- **Decision thresholds**: `hungarian_score >= 60 && foreign_score < 30` → accept. `foreign_score >= 60 && hungarian_score < 20` → reject. else → review_uncertain.
- **Hard rules override**: dominant non-Latin script → reject regardless. RSS `hu*` + zero foreign evidence → accept.

Evidence object: `{hu_words: [...], en_words: [...], scripts: {arabic: 12, latin: 800}, domain_hint, rss_lang, decision_path: [...]}`.

Deno unit tests with fixtures: HU podcasts (empty lang), Cybersecurity Headlines, SANS, Big Picture, Arabic-script feed, bilingual edge cases.

## Phase 3 — DB-wide audit & cleanup

New edge function `language-audit-runner`:
- Query: podcast + latest 8 episodes (title/description). Score in batches of 100.
- Write decision to `podcasts.*` fields.
- For `reject_foreign` + high confidence (foreign_score >= 75): collect into cleanup batch.
- For `review_uncertain`: set `is_hungarian=false`, insert into review queue (skip duplicates).
- For `accept_hungarian`: set `is_hungarian=true`.

Dry-run first (`?dry_run=1`): returns counts only. User approves → real run.

Deletion (`language-cleanup-runner`):
- For each rejected podcast: snapshot to `podcast_language_cleanup_log` with counts BEFORE deletion.
- Cascade delete: `episode_chunks`, `episode_embeddings`, `episode_clean_text`, `episode_transcripts`, `episode_youtube_links`, `episodes`, `podcast_embeddings`, `podcast_youtube_candidates`, `podcast_boilerplate_blocks`, `ai_enrichment_jobs` (where target=this podcast/its episodes), `discovery_queue` rows referencing it, `social_posts` referencing only this podcast, finally `podcasts` row.
- Batch of 50 per invocation, time-budgeted.

## Phase 4 — Ingestion gates

Add gate call in:
- `pi-dump-process` (most important — main funnel)
- `queue-import` & `queue-drainer` & `queue-import-runner`
- `rss-hunter` (when promoting candidate)
- `ai-feed-scout` (after Firecrawl+Gemini, before staging)
- `pi-recent-ingest`, `pi-topic-ingest`, `pi-hu-bulk-pull`, `itunes-hu-enumerate` — gate at staging entry
- `deep-hydrate-runner` — skip if `is_hungarian=false`
- `seo-enrich-enqueue`, `embed-podcast-runner`, `embed-episode-runner`, `embed-episode-chunks-runner`, `entity-backfill-runner`, `categorize-podcast-runner`, `daily-social-post` — all filter `is_hungarian=true`

Gate flow in ingestion:
1. Fetch minimal RSS (already done) → extract title/desc/lang + first 5-10 episode titles.
2. Call classifier.
3. accept → insert with `is_hungarian=true, language_decision='accept_hungarian'`.
4. reject → log to cleanup_log with `deletion_reason='gate_at_ingestion'`, do NOT insert.
5. review → insert with `is_hungarian=false, language_decision='review_uncertain'`, add to review queue.

## Phase 5 — Public query guards

Update everywhere that reads podcasts/episodes for public surfaces:
- `mv_homepage_feed` & `mv_homepage_evergreen` MVs: replace `language ILIKE 'hu%'` with `is_hungarian = true AND language_decision = 'accept_hungarian'`.
- `sitemap` edge fn, `prerender`, `search-hybrid`, `search-suggest`, `CategoryDetail`, `NewPodcastsPage`, `Index.tsx`, `PodcastDetail`, `EpisodeDetail` similar episodes, `SimilarPodcasts`, `TrendingEntities`, `RecentlyAddedPodcasts`, entity pages.
- One helper: `.eq('is_hungarian', true).eq('language_decision', 'accept_hungarian')` chained on every public podcast query.

## Phase 6 — Admin panel

New page `/admin/language-gate` (`AdminLanguageGatePage.tsx`):
- Counters: accepted / rejected / review_pending / last_audit_at / last_cleanup_at.
- Top detected foreign languages (group by `detected_language`).
- Recent ingestion rejections (last 50 from cleanup log where `deletion_reason='gate_at_ingestion'`).
- Review queue table with approve/reject buttons (writes back to podcasts.language_decision + is_hungarian).
- Buttons: "Run language audit (dry-run)", "Run language audit (apply)", "Run cleanup of rejected", "Resume background jobs" (clears incident_mode after user confirms cleanup done).
- Link from AdminHubPage.

## Phase 7 — Tests & verification

Deno tests in `_shared/hu-language-classifier_test.ts` with fixtures.

Final manual verification on user request:
- SQL: zero `is_hungarian=false` rows visible on homepage MVs.
- Spot-check homepage in preview.
- Report counts.

## Open question

Do you want me to start with **Phase 0 (pause jobs) + Phase 1 (migration) + Phase 2 (classifier) + Phase 3 (audit dry-run)** in this turn so you can review the dry-run report before any deletion? That's the safest path. After you OK the dry-run, I run cleanup + ingestion gates + public guards + admin panel.

Or go all-in: pause, classify, cleanup-with-conservative-thresholds (foreign_score≥75 only), gate ingestion, guard public — all in one shot, with full report at the end.

## Technical notes

- No new AI cost — classifier is pure heuristic. AI can be added later as tiebreaker for `review_uncertain` cases via the existing `pi-language-recheck` pattern.
- Cleanup log preserves what was deleted (title, rss_url, evidence) — recoverable if a podcast is wrongly removed.
- `review_uncertain` defaults to hidden but not deleted — safe middle ground.
- Re-classification is idempotent (uses `language_checked_at` to skip recently-checked).
