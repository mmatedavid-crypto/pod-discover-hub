# Person + Topic SEO Layer for podiverzum.hu

Massive scope (14 parts). I'll execute in **6 sequential phases**, each shippable and verifiable. After each phase I'll report and continue. All public queries enforce `podcasts.is_hungarian = true AND podcasts.language_decision = 'accept_hungarian'`. No public company pages — organizations stored in a generic `entities` table for later.

## Phase 1 — Data model (DB migration)

Single migration creating:

- `people`, `person_aliases`, `person_episode_mentions`, `person_podcast_map`, `entity_extraction_runs`
- `entities` (generic, for organizations now, future-proof)
- `topics`, `topic_aliases`, `episode_topic_map`, `podcast_topic_map`
- Storage bucket `entity-images` (public read) for cached Wikimedia images
- RLS: public read on all, admin write
- Indexes: slug, normalized_name, person_id, episode_id, topic_id
- Helper RPCs: `select_person_page_episodes(person_id)`, `select_topic_page_episodes(topic_id)`, `select_topic_page_podcasts(topic_id)` — all enforcing HU gate
- Seed all ~80 priority topics from PART 7 with HU SEO copy

## Phase 2 — Person extraction worker

Edge fn `person-entity-extractor`:
- Reads episodes joined to HU-approved podcasts
- Uses existing `episodes.people`, `episodes.mentioned`, `podcasts.hosts` arrays already populated by SEO enrichment
- Normalizes names (NFKD, lowercase, dedupe via aliases)
- Computes confidence using PART 2 rules (host / guest in title / mention count / single first name reject)
- Upserts `people`, `person_aliases`, `person_episode_mentions`, `person_podcast_map`
- Sets `is_public` / `is_indexable` per thresholds
- Logs to `entity_extraction_runs`
- Cron `*/30` (controls in `app_settings.person_extractor_controls`, $1/day cap — mostly free since it reuses existing AI extractions)

## Phase 3 — AI bio + Wikimedia image pipeline

Edge fn `person-enricher`:
- For `is_public` people without bio: query Wikidata SPARQL by name + HU context → get `wikidata_id`, `wikipedia_title`, `wikipedia_url`, `P18` image filename
- Fetch MediaWiki `imageinfo` + `extmetadata` → license, author, attribution
- Only accept reusable licenses (CC-BY*, CC0, PD); skip fair-use/unclear
- Download image, resize to 160/320/640 WebP via `Sharp` (use Deno-compatible `imagescript` or fetch through an image transform service)
- Upload all 3 sizes to `entity-images` Storage bucket, store paths
- Generate HU bio via Lovable AI Gateway (`google/gemini-2.5-flash`) — strict no-hallucination prompt, fallback template if data weak
- Store all attribution + license fields; never hotlink
- Daily cron, $3/day cap

## Phase 4 — Public pages

- `/szemelyek` — hub: search, trending (by recent mention count), category-grouped people
- `/szemelyek/:slug` — person detail per PART 5 layout (breadcrumb, image+attribution, AI bio, episode sections, related podcasts/topics/people, search box, FAQ)
- `/temak` — topic hub grouped by domain
- `/temak/:slug` — topic detail per PART 8 layout
- All pages: react-helmet SEO (title/desc/canonical/OG), JSON-LD (Person/CollectionPage/BreadcrumbList/FAQPage), `noindex` when `is_indexable=false`
- Strict HU filter on every query
- Image rendering uses local Storage URL only, with width/height + lazy loading + `<picture>` srcset for 3 sizes
- Initials avatar fallback component

## Phase 5 — Internal linking + sitemap

- Add **Témák** to main nav (next to Kategóriák), **Személyek** to nav + footer
- Add homepage compact section "Podcast témák szerint" (12 priority topics)
- Footer links: Témák, Személyek, Magyar podcastok, Friss epizódok, Új podcastok
- Update `sitemap` edge fn: include indexable `/szemelyek/:slug` + `/temak/:slug` (joined query with HU gate + `is_indexable=true`)
- Cross-links: person→topics/podcasts, topic→people/podcasts/siblings

## Phase 6 — Admin pages + verification

- `/admin/entities/people` — list, search, merge duplicates, edit aliases, approve/reject, regenerate bio, refresh image, manual image upload, toggle indexability
- `/admin/topics` — list, edit SEO copy, refresh mappings, approve/reject, sitemap refresh trigger
- Link both from `/admin` hub page
- Final verification report with all counts requested in PART 14

## Technical notes

- Topic mapping uses keyword aliases + existing `episodes.topics` arrays + AI extraction; capped at 5/episode, 8/podcast; specific > broad
- Materialized views for hot paths: `mv_person_episodes`, `mv_topic_episodes`, `mv_topic_podcasts`, refreshed every 15 min
- HU gate is non-negotiable on every public RPC + page query
- Performance: lazy load images, MV-backed queries, react-helmet for per-route SEO

## Scope confirmation

This is ~2 weeks of work compressed. I'll execute Phase 1 in this turn (migration only — single tool call, then awaits your approval). After approval, I'll continue with Phases 2–6 across subsequent turns, reporting after each phase. **Confirm to proceed with Phase 1 migration.**
