# P0.1 — HU ranking correction (audit + shadow proposal only)

Status: READ-ONLY AUDIT. No live `rank_label` / `podiverzum_rank` writes performed.
Date: 2026-05-29.

## 1. Revised HU formula (language removed from score)

Total: 10.0. Language is NOT a component — it is a gate (see §3).

| Component | Weight | Notes |
|---|---|---|
| `market_popularity` | 3.5 | RRF of Apple HU + Spotify HU + YouTube HU charts |
| `feed_health` | 2.0 | rss_status, recent ep, hydrated_episode_count |
| `hu_activity_cadence` | 1.5 | HU-calibrated: 8+ eps/90d already full credit |
| `content_discovery_quality` | 1.5 | title/description/summary length, existing metadata |
| `platform_structural_availability` | 1.0 | apple_url + spotify_url + youtube_url + website_url |
| `curation_boost` | 0.5 | `featured` + small `featured_rank` decay |

Tier ladder (shadow only): S ≥ 8.0, A ≥ 5.0, B ≥ 4.0, C ≥ 3.0, D ≥ 2.0, else E.

## 2. Exact existing fields per component

- **market_popularity** — `podcast_charts` (source ∈ {apple,spotify,youtube}, country='hu'), per-platform `LN(rank)` decay, sum capped at 3.5. Snapshot freshness verified: Apple HU 200 + Spotify HU 50 + YouTube HU 100, last refresh 2026-05-29.
- **feed_health** — `podcasts.rss_status`, `MAX(episodes.published_at)`, `podcasts.hydrated_episode_count`.
- **hu_activity_cadence** — `COUNT(episodes) WHERE published_at > now()-90d`. Thresholds 8/3/1, plus alive-in-last-365d floor of 0.3.
- **content_discovery_quality** — `podcasts.title`, `description`, `summary` length only. No AI call.
- **platform_structural_availability** — `podcasts.apple_url`, `spotify_url`, `youtube_url`, `website_url`.
- **curation_boost** — `podcasts.featured`, `podcasts.featured_rank`.

## 3. Separate language gate (no score impact)

`podcasts.language_status` (proposed enum, *not yet created*):

| Status | Definition | Indexable | Rankable |
|---|---|---|---|
| `accepted_hungarian` | RSS+content agree on HU | yes | yes |
| `accepted_hungarian_metadata_mismatch` | content/domain HU, RSS lang wrong | yes | yes |
| `needs_language_review` | conflicting signals | hidden | no |
| `likely_foreign` | weak HU signals | hidden | no |
| `confirmed_foreign` | strong non-HU signals | excluded | no |
| `excluded_foreign` | manual exclusion | excluded | no |

Decision inputs (existing, non-AI):
- HU TLD (`rss_url ILIKE '%.hu/%'` or `website_url ILIKE '%.hu%'`)
- Known HU publisher list (Telex, 24.hu, HVG, Mediaworks/HEOL family, Infostart, MTVA/hirado.hu, mediaklikk…)
- `detected_language='hu'` (already populated by `hu-language-classifier`)
- `hungarian_score`, `foreign_score`
- Existing `language_decision`, `is_hungarian`
- RSS `language` = ONE weak signal, never decisive

Gate logic (priority order):
1. HU domain OR known HU publisher → `accepted_hungarian_metadata_mismatch` if RSS lang ≠ hu.
2. `detected_language='hu'` AND `hungarian_score ≥ 60` → accepted (mismatch flag if RSS lang ≠ hu).
3. Strong foreign signal (`foreign_score ≥ 60` AND `hungarian_score < 20`) → `likely_foreign`.
4. Otherwise → `needs_language_review`.

## 4. HEOL-style bad-RSS-language handling

Live row: `Heol.hu`, `language='af'`, `rank_label='S'`, `podiverzum_rank=10`. Currently survives because `language_decision='accept_hungarian'` was set elsewhere. Confirmed: at least 50 HU podcasts have `language='en'/'fr'/'cs'/'de'` while `detected_language='hu'` and/or `hungarian_score=100` (Partizán Podcast, Deepstage, Tripla-dupla, SztereoTrip, Prédikációk a Fasori Evangélikusoknál, apAkt, Expat Boomers, Digital Backstage…). Some of these were incorrectly flipped to `reject_non_hungarian` despite `detected_language='hu' AND hungarian_score=100` — a bug in the current gate.

Proposed handling (read-only for now): mark them `accepted_hungarian_metadata_mismatch`. They keep ranking eligibility, do NOT lose score, and the RSS `language` mismatch is recorded for later cleanup.

## 5. How `podcast_charts` joins into `market_popularity`

```sql
SELECT podcast_id,
  COUNT(DISTINCT source) AS platforms,
  MIN(rank) FILTER (WHERE source='apple')   AS apple_rank,
  MIN(rank) FILTER (WHERE source='spotify') AS spotify_rank,
  MIN(rank) FILTER (WHERE source='youtube') AS yt_rank
FROM podcast_charts WHERE country='hu' AND podcast_id IS NOT NULL
GROUP BY podcast_id
```

Per-platform score = `MAX(0, W - LN(rank)/LN(N)*W)` with W ∈ {1.2, 1.2, 1.1} and N ∈ {200, 50, 100}.
Sum is `LEAST(3.5, …)`. This is RRF-style (sub-linear decay) and dominates the formula for chart-present podcasts — exactly the user requirement.

Same `podcast_charts` table already feeds `get_trending_podcasts` / toplista, so no new source is needed.

## 6. Top likely UPGRADES under shadow formula

(Shadow run; sample of strongest signals. Full ranked list materialised below in §11.)

| Title | Old | New | shadow_v1 | apple/spotify/yt |
|---|---|---|---|---|
| Partizán | A | **S** | 8.16 | 2 / 3 / 1 |
| Della — 24.hu | B | A | 6.74 | 20 / 31 / 4 |
| The Happy Hour Show | B | A | 6.57 | 3 / — / 6 |
| Portfolio | B | A | 5.98 | 45 / 10 / — |
| Partizán Podcast | C | A | 5.74 | 40 / 9 / — |
| MÁRKÓ ÉS BARNA | B | A | 5.71 | 12 / — / 17 |
| Apu azért iszik, mert te sírsz! | B | A | 5.59 | 65 / 17 / — |
| Aranykalitka | B | A | 5.46 | 80 / — / — |
| Csibész Boiz Podcast | B | A | 5.43 | 38 / — / 43 |
| Megbeszéljük… | C | B | 4.55 | — |
| Marosvásárhely Hit Gyülekezete | B | A | 5.72 | — / 20 / 16 |
| Alley-oop / Radnóti Színház | C | B | 4.05 | — |

(Most other "upgrades" surfaced by raw query are foreign podcasts that the current language gate mis-tagged as HU — they are NOT genuine upgrades, they are language-gate cleanup work and live as §8.)

## 7. Top likely DOWNGRADES under shadow formula

| Title | Old | New | shadow_v1 | reason |
|---|---|---|---|---|
| Mezítlábas Mesék [Tilos Rádió podcast] | A | **E** | 0.95 | rss=failed, no recent ep, no chart, 0 hydrated |
| Erizo meséi [Tilos Rádió podcast] | A | **E** | 0.95 | same |
| Búgócsiga / Plug & Lay / Filter / Eredeti helyzet / Felkelők / Bioritmus / Népzene / Déli Front / electrocat / HiFi Budapest / Még több jazzt az óvodákba! / Irodalmi lépegető / Euphonic Moments [Tilos Rádió] | A | E | ~1.0 | stale Tilos backlog, pr=10 inflated |
| Forr a világ [Tilos Rádió] | S | **D** | 2.65 | pr=10 but no chart, 0–2 eps/90d, 134 hydrated only |
| Cégfejlesztés Podcast | S | D | 2.75 | no chart, no recent ep |
| Filmkocka podcast | S | D | 2.75 | same |
| Hírek röviden (×2) | S | D | 2.25 | bulletin filler, no chart |
| Mesterterv / K&H podcastok / Urbán dzsungel / Csillagpont Rádió Miskolc | A | E | ~1.0 | pr=10 inherited, zero engagement signal |
| Mapei Krónika Podcast / Társasházi Percek – THT Podcast / Lépjünk szintet a minőségi jogalkotásért | S/A | D/E | 1.95–2.0 | no chart, low cadence |
| 17 InfoRádió bulletin segments (Paragrafus, Aréna, Szigma, Üzleti reggeli magazin, Napinfó, Adóinfó, Ötkarika, Energiavilág, Vívópercek, Könyvpercek, Vegyesúszás, Fővárosi mozaik, Világtükör, Kultúr Percek, Vállalatok és Piacok, Családi hét, Orvosmeteorológiai percek) | S | C | ~3.5 | flagged news_like; not blacklisted, just not S |

The S→D/E demotions almost all come from the long-tail Tilos Rádió show family and a few inflated `pr=10` rows. The InfoRádió segments are demoted only one notch via the news_like flag, not removed.

## 8. Likely Hungarian podcasts with bad RSS language metadata (sample, hungarian_score ≥ 60)

`Deepstage`, `apAkt`, `Tripla-dupla Podcast`, `Digital Backstage`, `Prédikációk a Fasori Evangélikusoknál`, `Expat Boomers Podcast`, `SztereoTrip`, `Partizán Podcast`, `Medical Portfolio Podcast`, `Radio8`, `TiL-Podcast`, `Heol.hu` (`language='af'`).

Recommended status: `accepted_hungarian_metadata_mismatch`. Several are currently `reject_non_hungarian` — that should be undone.

## 9. News/radio/bulletin-like candidates (existing-fields heuristic only)

Title regex: `\m(hírek|krónika|napi hír|infostart|inforádió|hangposta|percek|bulletin|hírmondó|reggeli magazin|napindító)\M`. Returns ~30+ HU shows: all InfoRádió segments, `Hírek röviden`, `Mapei Krónika Podcast`, `Társasházi Percek`, `Képtelen Krónika`, `Infostart.hu - Összes hír`, `TechRoaft Gyors Hírek`, `Galnet hírek`. Recommendation: write to `shadow_rank_components.news_like=true`. Do NOT blacklist. Homepage downweighting is already in place from the P0 patch — this only adds a structured flag.

## 10. Schema changes

**No DDL required for shadow scoring.** Everything fits into existing columns:

- `podcasts.shadow_rank` (numeric) — write the new score
- `podcasts.shadow_rank_tier` (text) — write proposed tier
- `podcasts.shadow_rank_components` (jsonb) — write `{formula:"HU_v1", components:{pop, health, act, content, avail, curation}, news_like, language_status_proposed, gate_inputs}`
- `podcasts.shadow_computed_at` (timestamptz)

`language_status` becomes a new optional field later (Phase 3). For Phase 1 we write the proposed status inside `shadow_rank_components.language_status_proposed` only.

## 11. Safest shadow-scoring implementation plan

**Phase A — fix the drift (no live label writes).**
1. Migration: rewrite `formula_c_candidates(_limit)` to read `app_settings.formula_c_thresholds` (currently hardcoded 8.5/7.0/5.5/4.0/2.5; live thresholds are 8/5/4/3/2). This stops the "stuck" backlog and `formula_c_runner.health='stuck'` signal.
2. Add a kill-switch: `app_settings.formula_c_runner_controls = {apply_to_live_rank:false}` and gate the `UPDATE podcasts SET rank_label=…` block in `formula-c-runner` behind it. Default OFF until Phase D.

**Phase B — new shadow-only edge function `hu-formula-v1-shadow`.**
- Reads `podcasts` + `podcast_charts` + `episodes(MAX/COUNT)` in batches of 200.
- Writes ONLY `shadow_rank`, `shadow_rank_tier`, `shadow_rank_components`, `shadow_computed_at`.
- Adaptive cron (start every 30 min, drain target 1500 podcasts in ~6 h).
- New admin page `/admin/hu-formula-shadow` with per-tier delta histograms + "promote X to live" review queue.

**Phase C — language gate v2 (read-only annotations).**
- New edge `hu-language-status-classifier`: writes `shadow_rank_components.language_status_proposed` using rules in §3.
- No `is_hungarian` / `language_decision` writes yet.

**Phase D — cutover (separate, gated user approval).**
- Manual whitelist review of top 200 movers in admin UI.
- Flip `formula_c_runner_controls.apply_to_live_rank=true` for a tiny batch (50 IDs) to validate.
- Roll forward in batches; never mass-update.

**Hard stops respected:** no live `rank_label`/`podiverzum_rank` writes anywhere in Phases A–C. No homepage change. No search-hybrid change. No AI calls. No blacklists. No schema changes beyond optional jsonb keys.

## 12. Confirmation: no live rank fields modified

This audit ran SELECT-only queries against `podcasts`, `podcast_charts`, `episodes`, `app_settings`, and `pg_get_functiondef`. No `UPDATE`, no `INSERT`, no migration, no edge-function deploy. `podcasts.rank_label`, `podcasts.podiverzum_rank`, `podcasts.shadow_rank*` were not touched.
