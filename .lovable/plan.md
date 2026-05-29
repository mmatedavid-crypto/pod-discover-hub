
# P0 Homepage Editorial + Admin Cleanup

Scope-locked patch. No redesign, no search/index changes, no global feed removal, no LiveIndexBar edits, no schema changes.

## Files changed

1. `src/pages/Index.tsx` — homepage scoring + news soft-downweight + brand title/description.
2. `src/pages/AdminHubPage.tsx` — drop temp admin fallback.
3. `src/App.tsx` — remove `/admin-bootstrap` route and its import.
4. `src/pages/AdminBootstrapPage.tsx` — delete file (no longer referenced).

LiveIndexBar, search-hybrid, RSS feeds, database schema, AI calls, RLS: untouched.

## 1. Homepage scoring (`src/pages/Index.tsx`)

Source remains `mv_homepage_feed`, `HOMEPAGE_EPISODE_LIMIT = 240` unchanged. Replace `compareByScore` usage in the trending block and `epsByCat` with a new local helper `homepageScore(ep)` (kept inside `Index.tsx` so `episodeRank.ts` and other pages stay untouched).

### Formula

```
score(ep) =
    tier        // S=100, A=70, B=40, C=20, D/E=5, else 10
  + featuredBoost   // featured=true → +60; bonus -featured_rank (0..20) capped
  + rankBoost       // clamp(podiverzum_rank, 0, 10) * 2          → 0..20
                   + max(0, 10 - clamp(pod_rank, 0, 10)) * 2     → 0..20
  + freshness       // see below, capped lower than today
  - newsPenalty     // 25 if isNewsLikeEpisode(ep), else 0
```

Freshness (softer than current `episodeRank.ts`, so quality stays competitive 7–14 days):

```
age_h < 24            → +35
age_h < 72            → +25
age_h < 7d            → +15
age_h < 14d           → +8
older                 → 0
```

Featured / S-tier podcasts: tier(100) + featured(60) + rank(up to 40) ≈ 200 base, which dwarfs freshness — they stay eligible 7–14 days as required. Mid-tier (B=40) relies mostly on the <7d freshness window. News penalty (−25) is soft: a freshly published S-tier news episode still outranks a stale mid-tier episode, but loses to comparable non-news.

`featuredBoost` detail:
```ts
const fb = ep.podcasts?.featured ? 60 : 0;
const fr = Number(ep.podcasts?.featured_rank);
const featuredRankBonus = ep.podcasts?.featured && Number.isFinite(fr)
  ? Math.max(0, 20 - Math.min(20, fr)) : 0;
```

Comparator: `(a,b) => homepageScore(b) - homepageScore(a)`, tiebreak by `published_at` desc (same pattern as current `compareByScore`).

## 2. News-like detection

Conservative, lowercase substring matching only. No regex globs over unrelated words. Applies only inside `Index.tsx` scoring + trending cap — does NOT touch search, indexing, podcast pages, category pages, sitemap, or RSS pipeline.

```ts
const NEWS_HINTS = [
  "hírek", "hírösszefoglaló", "hír összefoglaló",
  "napi hír", "esti hír", "reggeli hír",
  "krónika", "infostart",
  "rádió hírek", "radio hirek",
  "hírpercek", "hírműsor",
];
function isNewsLikeEpisode(ep) {
  const hay = [
    ep.podcasts?.category, ep.podcasts?.title, ep.podcasts?.display_title,
    ep.title, ep.display_title,
  ].filter(Boolean).join(" ").toLowerCase();
  return NEWS_HINTS.some(h => hay.includes(h));
}
```

## 3. Trending rail rules

Inside the existing trending block (replaces lines ~226–241):

- Sort `trendingPool` by `homepageScore` desc.
- Walk sorted list, keep max 2 per podcast (existing `PER_PODCAST_CAP = 2`).
- Track `newsCount`; in the top-8 selection, accept at most 2 news-like items. Surplus news-like items spill to overflow.
- After the primary pass, if `primary.length < 8`, backfill from overflow (news allowed) so the rail never looks empty.
- Final `.slice(0, 8)`.

## 4. Category rails (`epsByCat`)

- Keep current per-podcast cap of 2.
- Sort with `homepageScore` (which already includes the −25 news penalty) — mild, no hard cap.
- Only when a single category rail would be >50% news after sort, demote news items below non-news within that rail. Otherwise leave ordering as-is.
- Final `.slice(0, 6)` unchanged.

## 5. Brand title / description

Replace the `setSeo({ title, description, … })` block:

```ts
title: "Podiverzum.hu — Find it. Hear it.",
description: "Magyar podcast kereső és felfedező. Keress epizódokat téma, személy, szervezet, műsor vagy gondolat alapján.",
```

`hreflang` and `jsonLd` unchanged.

## 6. Admin cleanup

### `src/pages/AdminHubPage.tsx`
- Delete `TEMP_ADMIN_USER_ID` constant.
- Remove `fallback` state + the `fb = hasAdmin !== true && uid === TEMP_ADMIN_USER_ID` logic; set `admin = hasAdmin === true` only.
- Delete the "Temporary admin fallback active" banner.
- Remove the `Admin Bootstrap` tool tile (`/admin-bootstrap`) from the System section.

### `src/App.tsx`
- Remove line `import AdminBootstrapPage from "./pages/AdminBootstrapPage.tsx";`
- Remove route `<Route path="/admin-bootstrap" element={<AdminBootstrapPage />} />`.

### `src/pages/AdminBootstrapPage.tsx`
- Delete the file (no remaining references). The `admin-bootstrap` edge function and RLS policies are NOT touched — purely a frontend removal.

Server-side: no migrations, no policy changes, service role stays server-only. Admin access now strictly depends on `has_role(auth.uid(), 'admin')` via `user_roles`.

## Hard stops honored

- LiveIndexBar: not opened, not edited.
- `search-hybrid` / search RPCs: not touched.
- DB schema, RLS, edge functions: not touched.
- No AI calls added.
- Infostart and other news feeds remain in DB, in search, in category and podcast pages, in sitemap. Only homepage rail ordering applies the soft −25 penalty + 2-of-8 cap.
- Build must pass before deploy (verified by harness build step).

## Report template (filled after build)

1. Files changed: Index.tsx, AdminHubPage.tsx, App.tsx, AdminBootstrapPage.tsx (deleted).
2. Formula: as above.
3. News rules: NEWS_HINTS substring list above.
4. LiveIndexBar untouched — confirmed (not in diff).
5. Search/indexing untouched — confirmed (no edits under `supabase/functions/search-*`, `SearchPage.tsx`, sitemap, RSS).
6. Temp admin fallback removed — `TEMP_ADMIN_USER_ID` no longer referenced in repo.
7. Build result: reported from harness after apply.
