
# /szemelyek curated discovery redesign + person relevance hardening

This is a multi-part change covering schema, ranking logic, AI validation, UI redesign and targeted data cleanups. It is intentionally scoped to people / person-episode relevance — no topic groups, no host carousel, no public exposure of editorial internals.

---

## 1. Database schema additions (migration)

Add to `people`:
- `people_hub_score numeric NOT NULL DEFAULT 0`
- `recent_relevant_episode_count_30d int NOT NULL DEFAULT 0`
- `latest_accepted_relevant_episode_at timestamptz`
- `one_show_host boolean NOT NULL DEFAULT false`
- `disambiguation_label text`
- `disambiguation_context text`
- `canonical_identity_key text`
- `identity_confidence numeric NOT NULL DEFAULT 0`
- `identity_status text NOT NULL DEFAULT 'normal'`  -- normal / ambiguous / split_needed / split_resolved / needs_review
- `manual_approval_status` already exists — add value `'approved_browsable'` semantically (text, no enum)

Add to `person_episode_mentions`:
- `relevance_status text NOT NULL DEFAULT 'pending'`  -- pending / accepted / rejected / needs_review
- `final_relevance_score numeric`
- `validation_source text`  -- rule / ai / manual
- `ai_identity_match text`  -- same_person / different_person_same_name / substring_false_positive / uncertain
- `ai_reason text`
- `ai_evidence_phrases text[]`
- `ai_judged_at timestamptz`
- `ai_model text`

Indexes:
- `idx_people_hub_score` on `(is_browsable_in_people_hub, people_hub_score DESC)`
- `idx_pem_person_relevance` on `(person_id, relevance_status)`

RPCs:
- `refresh_people_hub_score()` — recomputes `people_hub_score`, `recent_relevant_episode_count_30d`, `latest_accepted_relevant_episode_at`, `one_show_host`, and refreshes `is_browsable_in_people_hub` using the new score + one-show-host penalty.
- `admin_get_hub_candidates(section text, limit_n int)` returning ranked lists for the 3 hub sections.

## 2. Hub score formula (inside RPC)

```
score =
  3.0 * recent_relevant_episode_count_30d
+ 2.5 * distinct_podcast_count
+ 1.5 * strong_mention_count
+ 1.0 * (verified_wikipedia ? 1 : 0)
+ 0.5 * (editorial_priority ? editorial_priority_level/100 : 0)
+ 0.1 * episode_count
- 5.0 * (one_show_host ? 1 : 0)
- 4.0 * (identity_status IN ('ambiguous','split_needed','needs_review') ? 1 : 0)
- 3.0 * (ai_review_status='duplicate_candidate' ? 1 : 0)
```

`one_show_host = (distinct_podcast_count = 1 AND host_count >= 1)`.

`is_browsable_in_people_hub = true` requires:
- accepted relevance evidence exists
- NOT one_show_host (unless `manual_approval_status='approved_browsable'` OR `editorial_priority` with cross-person evidence)
- identity_status NOT IN ('ambiguous','split_needed','needs_review')
- ai_review_status NOT IN ('needs_human_review','duplicate_candidate')

## 3. Edge functions

**New**: `supabase/functions/person-relevance-judge/index.ts`
- Input: person_id (optional batch_limit, target ids)
- Selects pending or weak `person_episode_mentions` (filtered to HU-accepted podcasts), prioritizing same-name / editorial / public people + Lakatos Péter / Pólus Enikő / Frei Tamás.
- Calls `google/gemini-2.5-flash` (Lovable AI) with strict Hungarian-output JSON tool.
- Writes `relevance_status`, `final_relevance_score`, `ai_*` fields. Logs spend in `ai_spend_daily.by_kind.person_relevance`.
- $2/day budget guard, 110s drain loop.

**New**: `supabase/functions/people-hub-refresh/index.ts`
- Calls `refresh_people_hub_score()` RPC. Schedulable hourly later (not added to cron in this pass to avoid backlog interference).

**Updated**: `editorial-people-seed-matcher` — when creating/updating people, set `identity_status='ambiguous'` if another person with same normalized_name exists.

## 4. Targeted cleanup script (one-off via `pi-dump-process` style admin endpoint, or SQL via `supabase--insert`)

- **Lakatos Péter split**: classify each mention by token presence in episode title+summary+podcast title:
  - Cluster A (business): videoton, üzlet, gazdaság, ipar, vállalat, menedzsment, befektetés, cég
  - Cluster B (sport): sport, táplálkozás, edzés, egészség, teljesítmény, életmód, étrend, mozgás
  - Else: needs_review
  - Create `lakatos-peter-videoton-holding` (label "Üzletember, Videoton Holding") and `lakatos-peter-sport-taplalkozas` (label "Sport és táplálkozás"). Move mentions accordingly. Mark original as `identity_status='split_resolved'`, hide from hub.

- **Pólus Enikő FP**: reject mentions whose episode text contains "kántorné", "ibolya", or "többpólusú" / "pólus" without "enikő".

- **Frei Tamás FP**: reject mentions where episode title/summary contains "freiburg" or "mire való az iskola" without "frei tamás" full match.

- **Bochkor Gábor**: recompute one_show_host; expected → hidden from hub.

All cleanup applied only to HU-accepted podcasts (`is_hungarian=true AND language_decision='accept_hungarian'`).

## 5. UI redesign

**New** `src/components/PersonCard.tsx` — single reusable card:
- `PersonAvatar` (existing, unchanged — already uses brand gradient HSL tokens, no black/red inconsistency. Confirm + tidy if needed).
- Name + optional `disambiguation_label` subtitle.
- Meta row: `N epizód · M műsor` + `Friss` badge if `latest_accepted_relevant_episode_at >= now()-30d`.
- Optional context line derived from top topics aggregated from accepted mentions.

**Rewrite** `src/pages/PeopleHubPage.tsx`:
- Hero + search (kept).
- Sections (in order):
  1. **Mostanában említve** — accepted relevant episode in last 30d, ordered by `latest_accepted_relevant_episode_at desc`, limit 12.
  2. **Több műsorban szerepel** — `distinct_podcast_count >= 2 AND strong_mention_count >= 2`, ordered by `people_hub_score desc`, limit 18.
  3. **Kiemelt beszélgetések szereplői** — top `people_hub_score` overall (no public "editorial" label), limit 24, dedup with section 2.
- Removed: "Legtöbb epizódban".
- Filtering: `is_browsable_in_people_hub=true` (unchanged).
- Responsive: mobile single column, tablet 2 col, desktop 3 col, generous spacing.

**Update** `src/pages/PersonDetailPage.tsx`:
- Show `disambiguation_label` as subtitle under H1 if present.
- Episode query filters to `relevance_status='accepted' OR final_relevance_score>=0.75 OR validation_source='manual'`, fallback for legacy (`mention_type IN ('host','guest','subject') AND confidence>=0.80`).
- Continue using `PersonAvatar` (already consistent).

## 6. Verification

After migrations + cleanup + AI judge sample run, query DB for:
- old vs new browsable count
- Bochkor Gábor hub status
- one-show-host hidden count
- Lakatos Péter cluster sizes
- Friss badge count + 20 examples
- AI judge totals (accepted/rejected/needs_review) + spend
- Pólus Enikő / Frei Tamás false-positive removal counts
- confirm no public surface reads editorial_priority / manually_seeded / editorial_notes

## Scope guardrails

- No topic group sections.
- No public host carousel.
- No exposure of editorial internals.
- No changes to ranking/search/AI pipelines unrelated to person relevance.
- HU-only filter preserved everywhere.

## Risks / notes

- AI judge will not finish judging all backlog in one run — drain loop processes a batch, leaves rest pending. Page rules already gate display on accepted/score/manual + legacy fallback so UX stays intact.
- Lakatos split is heuristic; episodes that match neither cluster go to `needs_review` and remain on the original (now hidden) record until reviewed.
- New `people_hub_score` columns are derived — `refresh_people_hub_score()` must be re-run after relevance changes. Will be invoked at end of cleanup and from people-hub-refresh fn.

Proceed?
