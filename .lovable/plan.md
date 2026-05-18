# Episode-level topic/category relevance — sprint 1

Goal: replace the coarse podcast-level category signal with cached, AI-judged, episode-level relevance for HU public topic/category pages. Deliver the foundation + first batch for the 6 user-reported topics. No public-pageview AI. No public downtime.

Hard filter everywhere: `podcasts.is_hungarian = true AND podcasts.language_decision = 'accept_hungarian'`.

---

## Phase A — Schema (one migration)

Add two cache tables (no FKs to auth, RLS public-read + admin-write, same pattern as `episode_topic_map`):

- `episode_topic_relevance_reviews(id, episode_id, topic_id, candidate_source, status, confidence, reason_hu, suggested_topic_ids uuid[], reviewed_by, source_hash, model_version, created_at, reviewed_at)`
  - unique `(episode_id, topic_id)`; partial index on `status='accepted'`; index on `(topic_id, status)`.
- `episode_category_overrides(id, episode_id, category_slug, status, confidence, reason_hu, reviewed_by, source_hash, created_at, reviewed_at)`
  - unique `(episode_id, category_slug)`.

Add to `topics`: `positive_hints text[]`, `negative_hints text[]`, `min_evidence_score numeric default 0.3` (if not present in `metadata`). Seed hints for Food, Oktatás, Művészet, Sport, Orosz irodalom, Orosz kultúra (create the last two as topics if missing).

Add to `categories`: same hint columns. Seed for the matching slugs.

Add `app_settings.episode_topic_judge_controls = { enabled, daily_budget_usd: 3, batch_size: 40, concurrency: 4, model: "google/gemini-2.5-flash-lite", priority_topics: [...slugs...] }`.

## Phase B — Candidate generator (edge fn `topic-candidates-runner`)

For one `topic_id` (or `category_slug`) per call, build candidate `episode_id`s from:

1. positive-hint ILIKE on `title || ' ' || description || ' ' || coalesce(ai_summary,'') || ' ' || coalesce(search_text,'')`
2. vector match: `episode_embeddings` nearest to topic name + aliases (via embed call once, cached in `topic_hubs` if exists, else `app_settings.topic_query_embeddings`)
3. current `episode_topic_map` rows for the topic
4. `search_episodes_hybrid(topic.name, …)` top 200, gap = present in search but not in map
5. existing `podcast_topic_map` → episodes from those podcasts (last 365d)

For each candidate compute `source_hash = sha256(episode_id || topic_id || ai_summary_hash || title)`. Skip if a row in `_reviews` exists with same hash. Insert `status='needs_review'`, `candidate_source` set, `reviewed_by='rule'`.

Apply cheap pre-filters before queueing for AI: must hit ≥1 positive hint OR vector_sim≥0.72 AND no negative hint. Pure-negative candidates inserted directly as `status='rejected', reviewed_by='rule'`.

## Phase C — AI judge runner (`topic-judge-runner`)

Drain loop, TIME_BUDGET 50s. Claims oldest `needs_review` rows in priority order (priority_topics first, then high search-gap). Calls Lovable AI Gateway with tool-call schema returning the strict JSON specified in PART 3. Writes back `status`, `confidence`, `reason_hu`, `model_version`, `reviewed_at`, `reviewed_by='ai'`. Logs spend to `ai_spend_daily.by_kind.topic_judge`. Stops at daily cap. Same pattern as `seo-enrich-runner`.

Identical second runner `category-judge-runner` writes `episode_category_overrides`.

Cron: jobid 25 (`topic-candidates-runner` `*/15`), jobid 26 (`topic-judge-runner` `*/2`). Adaptive backoff if backlog=0 → `*/30`.

## Phase D — Public read path

- **`TopicDetailPage.tsx`**: replace direct `episode_topic_map` read with union: (a) `episode_topic_relevance_reviews where status='accepted'` (b) fallback `episode_topic_map where confidence≥0.6` for topics with no judge coverage yet. Keep HU gate, freshness sort, capPerPodcast(2,12).
- **`CategoryDetail.tsx`**: prefer `episode_category_overrides where status='accepted'`; fall back to `podcasts.category` join; exclude episodes with `status='rejected'` override even if podcast-level matches. Keep cap + freshness.
- No new client AI calls. No latency change for pageviews.

## Phase E — Query intent

`_shared/search-understand.ts`: when query matches `/\b(orosz|magyar|francia|…)\s+(irodalom|kultúra|művészet|zene|film|könyv|író)\b/i`, set `intent='topic'`, push the noun to `expanded_terms`, and emit a `downrank_people: ["Orosz …"]` hint consumed by `search-hybrid` to reduce people-match weight. Podcast-title intent already handled — verify Hold After Hours regression still passes.

## Phase F — Admin dashboard `/admin/topic-quality`

New page (read-only RPC + a few admin-write actions):
- table: topic | mapped | accepted | rejected | needs_review | search_count | gap | dominant_podcast | stale_days
- per-row buttons: "Run candidates", "Run judge batch" (invokes the runners with `topic_id` body)
- regression test panel running the 10 PART 7 cases against `search-hybrid` + topic page query, showing pass/fail
- backlog + AI spend summary (read from `ai_spend_daily.by_kind.topic_judge`)
- manual accept/reject buttons → `supabase.from('episode_topic_relevance_reviews').update(...)`

Route added to `App.tsx`, linked from `AdminHubPage.tsx`.

## Phase G — First batch

Run candidates + judge for these topic slugs in order: sport, oktatas, gasztronomia, muveszet, orosz-irodalom, orosz-kultura. Then top 5 by search-gap. Budget cap $3/day; expected 1–2k judge calls. Pause after.

## Phase H — Regression + verification report

Run the 10 PART 7 cases through `search-hybrid` and the rebuilt topic pages. Save results to `mem://qa/p0-2026-05-18-batch2.md`. Print full PART 13 verification report.

---

## Files I'll touch

Migration:
- `supabase/migrations/<ts>_episode_level_relevance.sql` (tables + topic/category hint columns + indexes + RLS)

New edge functions:
- `supabase/functions/topic-candidates-runner/index.ts`
- `supabase/functions/topic-judge-runner/index.ts`
- `supabase/functions/category-judge-runner/index.ts`

Edited:
- `src/pages/TopicDetailPage.tsx`
- `src/pages/CategoryDetail.tsx`
- `supabase/functions/_shared/search-understand.ts`
- `src/App.tsx` (+ new `src/pages/AdminTopicQualityPage.tsx`)
- `src/pages/AdminHubPage.tsx` (link)

Data ops (via insert tool, not migration):
- seed hints for 6 topics + 4 categories
- seed `app_settings.episode_topic_judge_controls`
- schedule crons jobid 25 + 26

---

## What I will NOT do

- No Smart Player Phase 2.
- No mass deletes of existing `episode_topic_map` rows (the new accepted/rejected layer supersedes them without destroying history).
- No realtime/pageview AI.
- No schema work beyond the two tables + hint columns.
- No classification of every episode in the DB — first sprint is the 6 priority topics + top-5 search-gap topics only.

---

## Estimated execution

~30–45 tool calls. Migration first (requires approval), then runners + UI in parallel, then first batch + report.

Approve to proceed, or tell me which phases to drop / reorder. In particular: confirm the $3/day judge cap is OK and that creating new topics `orosz-irodalom` and `orosz-kultura` is desired.
