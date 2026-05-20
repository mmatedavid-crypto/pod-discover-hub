# Integrate completed data layers into public product

Goal: ship the value from already-completed pipelines (ai_summary 96.8%, episode embeddings 99.1%, entity backfill 100%, Formula C 100%) into the public UI now — with safe fallbacks for the still-draining ones (clean_text 0.3%, chunks 43%, person bio 0%).

## 1. AI summary as primary description (frontend)

Shared helper `src/lib/episodeText.ts`:
```ts
pickEpisodeDescription(e) =
  e.ai_summary?.trim()
  ?? e.clean_text_excerpt?.trim()       // when available
  ?? excerpt(e.summary ?? e.description)
```
Apply in:
- `EpisodeCard` (already prefers ai_summary — confirm + add clean_text tier)
- `EpisodeDetail` page meta description + OG + body excerpt
- `SimilarEpisodes`, `SearchPage` snippets
- `search-answer` "why relevant" prompt input (already uses ai_summary; tighten)

No backend change. Pure frontend + meta-tag fallback chain.

## 2. Episode embeddings — already live

Already powering `SimilarEpisodes` (`get_related_episodes_by_embedding`), search-hybrid, mood collections, topic ranking. **No change needed** except: confirm `EntityPage` (topic/person) episode list uses embedding-aware ordering when no strict gate fires. Add a quick audit pass — no new code unless gap found.

Person-name strict gate: already implemented last turn in `search-hybrid` — confirm vector fallback truly disabled for that branch.

## 3. Entities — surface completed backfill

- `EpisodeCard`: `showEntities` already wired; flip default ON in SearchPage + EpisodeDetail "related" + EntityPage lists.
- `EpisodeDetail`: add entity chip row above audio (people / companies / topics / tickers) linking to entity hub pages — already in card, lift to page header.
- Homepage: add `<FrequentlyMentioned />` module — top 8 entities by recent episode count, links to entity hubs. New component, single RPC.
- `search-suggest`: already pulls entities; verify it surfaces person/company/topic results, not just episodes.

## 4. Formula C — internal boost, soft public labels

- `episodeScore` in `src/lib/episodeRank.ts` already uses `rank_label` — keep.
- `EpisodeCard` currently shows numeric "Forrás 7.2" — keep numeric, **add softLabel mapping** only when explicitly needed:
  - S → "Kiemelt forrás"
  - A → "Aktív podcast"
  - B → "Rendszeresen frissül"
  - C → omit
- Never render raw "S/A/B/C" in public surfaces. Audit: grep for `rank_label` in `src/pages/**` and `src/components/**`, replace any literal letter display.
- Sitemap priority already tiered.

## 5. Search UX

Done last turn (strict person-name gate, no fallback). Verify with regression test query "Burján Szilárd".

## 6. Clean text — fallback only

Already in `pickEpisodeDescription`. No gating of public surfaces on clean_text. Chunk embedding remains paused (job 26).

## 7. Chunk embeddings

Stay gated. No change.

## 8. People pages

No bio generation triggered. PersonDetailPage already gates by accepted/relevance. Add **read-only export** admin button: CSV of `people` + relevance stats for manual audit (new small edge fn `people-audit-export` or admin SQL view + client CSV download).

## 9. Admin data-layer visibility

New page `/admin/data-coverage` (`AdminDataCoveragePage.tsx`):
Single dashboard listing each public module + which data layer powers it + current coverage %:

```
Module                       Layer            Coverage   Fallback
─────────────────────────────────────────────────────────────────
Episode cards (description)  ai_summary       96.8%      clean_text → RSS
Episode detail meta          ai_summary       96.8%      clean_text → RSS
Similar episodes             embeddings       99.1%      —
Search semantic              embeddings       99.1%      FTS
Search person-name           aliases (strict) 93.5%      none (gate)
Entity chips                 entity_backfill  100%       —
Homepage trending            Formula C + emb. 100%       —
Topic / person pages         entities + emb.  100% / 16% audit before expand
Person bios                  ai_bio           0%         hidden
Clean text                   episode_clean    0.3%       RSS desc
Chunk embeddings (paused)    episode_chunks   43%        not used in search
```

Coverage % pulled live via existing RPCs / count queries. Read-only.

## Technical details

Files to add:
- `src/lib/episodeText.ts` — `pickEpisodeDescription`, `softTierLabel`
- `src/components/FrequentlyMentioned.tsx` — homepage module
- `src/pages/AdminDataCoveragePage.tsx` + route in `App.tsx` + entry in AdminHubPage
- (optional) `supabase/functions/people-audit-export/index.ts`

Files to edit:
- `src/components/EpisodeCard.tsx` — clean_text fallback, soft tier label, default showEntities in search context
- `src/pages/EpisodeDetail.tsx` — meta/OG/excerpt via helper, entity header row
- `src/pages/SearchPage.tsx` — pass `showEntities`
- `src/pages/Index.tsx` — mount FrequentlyMentioned
- `src/pages/PersonDetailPage.tsx` — no bio rendering until ai_bio_status='done'
- Grep + scrub any raw S/A/B/C in public components

No DB migrations required. No new cron. No model/runner changes.

## Out of scope (per user)
- Bio generation, wikipedia enrich, ai_review runners — stay off.
- Chunk embedding cron — stays paused.
- Direct Google API / GEMINI_API_KEY_FREE — untouched.
- Person-judge drain crons — untouched.
