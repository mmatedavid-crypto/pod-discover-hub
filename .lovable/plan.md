
# Podiverzum HU átállás

Cél: a remixelt projekt fusson **podiverzum.hu** (vagy hasonló) néven, **kizárólag magyar** podcast tartalommal, **teljes magyar UI-val**, az eredeti architektúra és funkciók megtartásával. Az EN forráskódban semmi sem hivatkozhat a régi EN tartalomra/domainre.

---

## Fázis 1 — Adatbázis tiszta lap (csak podcast/episode adat)

Egyetlen migráció (TRUNCATE-eket egy tranzakcióban), minden config/admin marad.

**TRUNCATE (CASCADE ahol kell):**
- `podcasts` — minden podcast törölve
- `episodes` — minden epizód törölve
- `podcast_embeddings`, `episode_embeddings`
- `ai_enrichment_jobs` — minden függőben/befejezett job
- `pi_feed_staging`, `pi_dump_imports` — staging takarítás
- `discovery_queue`
- `mv_homepage_feed`, `mv_homepage_evergreen` REFRESH (üresre)
- `search_query_cache`, `search_suggest_cache` — angol cache törlés
- `mood_collections` — episode_ids/podcast_ids hivatkoztak EN UUID-kre
- `social_posts`, `growth_runs` — régi kampány/run adatok
- `rss_url_history`, `page_events`, `search_events`, `beta_feedback`, `email_send_log` — analitika reset
- `podcasts_backup_pre_c_v3` DROP (régi backup már nem releváns)

**Megmarad:** `app_settings`, `categories` (átnevezzük HU-ra Fázis 3-ban), `search_synonyms` (HU-ra cseréljük), `user_roles` + admin user, `email_send_state`, `email_unsubscribe_tokens`, `suppressed_emails`.

**Sequence reset & defaults:**
- `podcasts.language` default `'hu'` (volt `'en'`)
- HU feed-scout default sources beállítása `app_settings`-ben (ld. Fázis 4)

---

## Fázis 2 — UI teljes magyarítása (EN eltávolítva)

Hardcoded HU stringek mindenhol — nincs i18n setup (egyszerűbb, gyorsabb; ha később kell EN, akkor jön az i18n).

**Érintett UI területek:**

| Felület | Mit írunk át |
|---|---|
| `src/pages/Index.tsx` | hero, "Trending", "Fresh", "Recent", "Evergreen" → "Felkapott", "Friss", "Új", "Időtálló" |
| `src/pages/SearchPage.tsx` + `SearchInput` | placeholder, "No results", "Did you mean", filter chip-ek |
| `src/pages/PodcastDetail.tsx` | "Episodes", "Listen on", "All episodes", "Subscribe" → magyar |
| `src/pages/EpisodeDetail.tsx` | "Listen", "About this episode", "Related" → magyar |
| `src/pages/CategoryDetail.tsx` + `Categories` | kategória header sablonok |
| `src/pages/NewPodcastsPage.tsx` | "Recently added" → "Új podcastok" |
| `src/components/Layout/Header.tsx`, `Footer.tsx` | nav linkek, copyright |
| `src/components/seo/*` (PodcastJsonLd, EpisodeJsonLd, MetaTags) | description/title sablonok HU |
| `index.html` | `<title>`, meta description, og:locale `hu_HU` |
| `src/pages/Auth.tsx` + auth komponensek | "Sign in", "Sign up", "Email", "Password" → magyar |
| `src/components/feedback/*` | beta feedback widget szövegek |
| Toast üzenetek (`useToast` hívások) | minden user-facing toast HU |
| Empty states, error boundaries, 404 oldal | HU |
| Date formatting | `date-fns/locale/hu` minden `format()` híváshoz |

**Admin (`/admin/*`) marad angolul** — csak te látod, nem prioritás.

**SEO sablonok (DB-ben):** `categories.seo_title/seo_description`, `app_settings`-ben tárolt SEO sablonok (ha vannak) HU-ra cserélve.

---

## Fázis 3 — Tartalom-pipeline HU-only

**`_shared/seo-prompt.ts`** + minden Gemini prompt:
- Output language instruction: "always respond in Hungarian"
- "never translate" maradhat (forrás már HU lesz úgyis)

**`ai-feed-scout` edge function:**
- `DEFAULT_SOURCES` cseréje: Apple HU charts (`https://podcasts.apple.com/hu/charts`), HVG/Index/444/Telex podcast listák, Spotify HU top, Magyar Podcast adatbázis ha találunk, Wikipedia HU "Magyar podcastok" lista
- `lang_hint: 'hu'` minden forráshoz
- Gemini prompt szigorítva: csak `language='hu'` feed-eket fogadjon el

**`pi-dump-process`:**
- Reject ha `detected_language !== 'hu'` (volt: `=== 'en'`)
- Felülírás logika ugyanaz (language-guard)

**`_shared/incident-guard.ts`** és language-guard változatlan logikával, csak target `'hu'`.

**Frontend filter (`mv_homepage_feed`, sitemap, daily-social-post, CategoryDetail, NewPodcastsPage):**
- `podcasts.language IS NULL OR ILIKE 'hu%'` (volt `'en%'`)
- Sitemap `<urlset>` `xml:lang="hu"`

**`categories` HU átnevezés:** `name`, `slug`, `description` magyarra (pl. `business` → `uzlet`, `news` → `hirek`, `comedy` → `humor`, `technology` → `tech`, `health` → `egeszseg`, stb.). Slug váltás miatt **redirect map** nem kell, mert nincs régi tartalom.

**`search_synonyms`:** EN szinonimák törölve, HU szinonimák seed (pl. `ai` → `mesterséges intelligencia`, `mi`; `vc` → `kockázati tőke`; `startup` → `cég, vállalkozás`).

**Daily social post:** X/Twitter prompt magyarul, magyar copy stílus (info+szórakoztató, nincs hashtag/emoji továbbra is).

---

## Fázis 4 — Domain és deploy (új .hu)

**Lépések (te végzed, én segítek a setupban):**

1. **Domain vásárlás:** `podiverzum.hu` (vagy alternatíva) — Lovable Settings → Domains → Buy new domain (ha .hu támogatott), VAGY külső registrar (pl. Forpsi, Rackhost, Nethely) — utána manuális DNS.
2. **Cloudflare:**
   - Új CF zone a `.hu` domainre
   - Új worker: `podiverzum-hu-bot-prerender` (a régi `podiverzum-bot-prerender` worker kód másolata, csak host check `podiverzum.hu`-ra)
   - Routes: `podiverzum.hu/*`, `www.podiverzum.hu/*`
   - Sitemap proxy: ugyanaz a logika, új cache key (`proxy-cache-hu-v1`)
3. **Lovable kapcsolás:** Project Settings → Domains → Connect domain (proxy mode pipálva)
4. **`index.html`:** `<html lang="hu">`, `og:locale="hu_HU"`, canonical `https://podiverzum.hu`
5. **Sitemap edge function:** base URL `https://podiverzum.hu`
6. **Robots.txt:** új sitemap URL
7. **Google Search Console:** új property, sitemap submit (nincs migráció a régiről, friss start)

---

## Fázis 5 — Memory frissítés

`mem://index.md` Core szabályok átírása:
- "EN-only site" rule → "HU-only site"
- AI summary language → HU
- DEFAULT_SOURCES leírás → HU források
- `[Multilingual rollout]` memory törölve vagy átírva
- Új memory: `mem://plans/hu-launch.md` — a fenti checklist + post-launch teendők

---

## Sorrend és függőségek

```text
Fázis 1 (DB wipe migration)         ← első, blokkolja a többit
   ↓
Fázis 3 (pipeline HU-only kód)      ← párhuzamos Fázis 2-vel
Fázis 2 (UI magyarítás)             ← párhuzamos Fázis 3-mal
   ↓
Fázis 5 (memory update)             ← Fázis 2+3 után
   ↓
Fázis 4 (domain — te csinálod)      ← bármikor, de éles indítás előtt
```

---

## Amit MOST eldöntenél / megerősítenél

1. **Domain név** — `podiverzum.hu` ok, vagy más? (befolyásolja a hardcoded URL-eket sitemap/JSON-LD/canonical helyeken)
2. **Kategória magyarítás** — minden kategóriát átnevezünk magyar slug-gal, vagy az angol slug-ok maradjanak (pl. `/category/business` de a megjelenítés "Üzlet")? **Javaslat: magyar slug** (SEO szempontból jobb).
3. **Auth Google login** — marad-e? (Igen javasolt, ne piszkáljuk.)
4. **`mood_collections`** — TRUNCATE most (mert EN UUID-kre hivatkoznak), és **későbbi seed** HU mood-okkal külön körben? Vagy most rögtön rakjak HU seed mood collectionöket (pl. "elalváshoz", "futáshoz", "munkába menet")?

Ha ezek megvannak, megyek a Fázis 1 migrációval.
