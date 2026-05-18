# P0 Quality Fix — podiverzum.hu

This is a large multi-system fix. I will execute it in 4 phases, each independently verifiable. Each phase ends with a written report section. I will stop and ask if any phase requires destructive changes (mass-deleting bad topic mappings, etc.).

---

## Phase 1 — Diagnostics & instrumentation (NO behavior change yet)

Goal: build the data I need before changing ranking/classifier logic, so fixes are evidence-based, not guesswork.

1. **Topic/Search gap audit (read-only SQL)**
   - For every public topic: current `episode_topic_map` count vs. `search_episodes_hybrid` count for the topic name + aliases (HU-gated).
   - Surface top 20 worst gaps + 10 worst false-positives (per topic, lowest-confidence mappings).
2. **Friderikusz × Oktatás dump** — list every (episode, podcast) pair currently in Oktatás coming from Friderikusz; check title/summary for education keywords; mark false positives.
3. **Drágám hol a vacsorám × Food dump** — same logic, food keywords.
4. **Művészet freshness dump** — top 20 by `published_at` currently shown on the topic page, with podcast distribution, to confirm Hangosító dominance + age.
5. **Public stability window** — query `page_events` errors, edge-function logs (`hu_archive_backfill_runs`, `ai_enrichment_jobs` failures, `cloud_status`) for the reported afternoon window.

Deliverable: a one-shot report printed in chat + saved to `mem://qa/p0-2026-05-18.md`.

---

## Phase 2 — Classifier guardrails (episode-level evidence + negative hints)

Touches: `supabase/functions/categorize-podcast-runner` (and any topic mapper used by `episode_topic_map`), DB seed data on `topics` table.

1. Add `positive_hints` / `negative_hints` / `min_evidence_score` columns to `topics` (migration) if not present; otherwise reuse existing `metadata` JSONB.
2. Seed hints for: Food/Gasztronómia, Oktatás, Művészet, Sport, Orosz irodalom/kultúra (new disambiguation topic or guard rule).
3. Update topic-mapping logic so an episode is mapped ONLY if episode-level text (title + description + ai_summary + search_text) hits ≥1 positive hint and no negative hint, OR podcast is wholly about the topic (≥80% of recent episodes match).
4. One-shot cleanup migration: delete `episode_topic_map` rows that fail the new guard for the 4 problem topics (Food, Oktatás, Művészet false-positives), then re-run mapper for those topics.
5. Recompute `topics.episode_count` / `podcast_count`.

I will pause before the destructive cleanup step and show the count of rows to be deleted per topic.

---

## Phase 3 — Search intent + freshness + autocomplete

Touches: `supabase/functions/search-hybrid`, `supabase/functions/search-suggest`, new `supabase/functions/search-autocomplete` (or extend `search-suggest`), `src/pages/SearchPage.tsx`, `src/pages/TopicDetailPage.tsx`, `src/pages/CategoryDetail.tsx`.

1. **Podcast-title intent** in `search-hybrid`: pre-step that calls `match_podcast_by_name(query)`; if confidence ≥ 0.85, returns a `podcast_intent` block (the podcast card + latest 10 episodes ordered by `published_at DESC`) ahead of semantic results. Frontend renders a "Podcast találat" card.
2. **HU adjective vs. surname disambiguation**: in `_shared/search-understand.ts`, when query contains `orosz` + {`irodalom`,`kultúra`,`könyv`,`író`,`zene`,`film`,`művészet`}, downrank `people.name ILIKE 'Orosz %'` hits and war/geopolitics-only episodes. General pattern: `<adj> + <topic-noun>` ⇒ treat first token as adjective, not surname.
3. **Freshness fix on topic/category pages**: `TopicDetailPage` "Friss epizódok" — sort by `published_at DESC` with a per-podcast cap (max 2 per podcast in the top 12), only include episodes published within last 365 days when a fresher pool exists. Same fix for `CategoryDetail`.
4. **Autocomplete `/api/search-autocomplete`** (new edge function, public, no JWT, no logging of PII):
   - Inputs: `q` (≥2 chars), `limit` (default 8).
   - Sources, in priority order: podcast titles (ILIKE + trigram), people names (HU-gated, `is_public`), topics (positive hint match), categories, popular `search_query_cache` entries.
   - Returns typed suggestions: `{ type, label, subtitle, href, confidence, image_url? }`.
   - Cached 60s per `q` in memory; no DB cache to keep latency low.
   - Wire into `SiteHeader` search input (debounced 150ms, mobile-friendly dropdown, ARIA combobox, no indexable links).
5. Block autocomplete URLs in `public/robots.txt` and ensure not in sitemap.

---

## Phase 4 — Stability audit & report

1. Query the user-reported afternoon window (≈12:00–18:00 local on 2026-05-18):
   - Public 5xx in edge logs (`search-hybrid`, `search-suggest`, `prerender`, `og-image`, `sitemap`).
   - `cloud_status` snapshot.
   - Cron overlap: any background job claiming > 30s during the window.
2. If a culprit is found (likely: archive backfill or embed-episode-chunks at `*` colliding with peak traffic), apply one of:
   - Tighten `TIME_BUDGET` on the offending runner.
   - Add traffic-aware backoff: skip run if a public-read indicator (e.g. `app_settings.public_traffic_high`) is set.
3. Verify `_shared/incident-guard.ts` still fail-closes correctly (it does; just confirm).
4. Final regression run of the test set listed in the request; print before/after counts.

---

## Technical notes

- All new edge functions deploy with default `verify_jwt = false`; no `config.toml` edits required.
- New migration files: 1 for topic hints schema, 1 for cleanup (data ops via insert tool, not migration).
- `topics.positive_hints` / `negative_hints` are `text[]` columns; `min_evidence_score` `numeric DEFAULT 0.3`.
- Regression queries saved to `mem://qa/search-issues.md` (append).
- Memory updates: index entry for "P0 quality 2026-05-18" pointing to the QA file.

---

## What I will NOT do

- No Smart Player Phase 2 work.
- No new product features.
- No schema changes outside the topic guardrails + autocomplete needs.
- No mass deletes without showing counts first.

---

## Estimated execution

~25–40 tool calls across the 4 phases. Phase 1 alone is ~8 read-only queries and produces the report that tells me exactly how aggressive Phase 2's cleanup must be.

Approve to proceed, or tell me which phases to skip / reorder.
