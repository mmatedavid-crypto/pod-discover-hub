
# Semantic Discovery & Personalized Mood — Phased Plan

A 18-pontos kérés egyetlen loopban nem teljesíthető tisztességesen (több új edge function, RPC, admin felület, benchmark, design változás). Az alábbi fázisokban szállítom, mindegyik fázis külön loop, külön QA-val. Az állapotfelmérés most:

- HU-approved podcastok: **691**, HU epizódok: **63 655**
- episode_embeddings: **63 655 / 63 655 = 100%**
- podcast_embeddings: **691 / 691 = 100%**
- episode_chunks: **59 134** (~93%)
- `app_settings.search_engine` jelenleg **nincs** beállítva — a search-hybrid alapból v12

A vektorizálás tehát kész — biztonsággal építhetünk rá.

## Globális garanciák (minden fázisban)
- Minden public RPC / edge fn szűr: `podcasts.is_hungarian = true AND podcasts.language_decision = 'accept_hungarian'`.
- Minden publikus AI szöveg `_shared/hu-language-guard` szűrőn megy át; nem-HU esetén egyszeri regenerálás, utána HU fallback.
- Nincs nyers score publikusan; nincs „IP alapján…” jellegű copy.
- Sitemap: arbitrary search/AI oldal NEM kerül bele.

## Fázisok

### Fázis 1 — Search alapok v13 + HU guard + "Miért releváns?" (PART 1, 2, 4)
- `app_settings.search_engine` upsert default jsonbbal (default v13, fallback v12, chunk_aug=false, semantic=on, cohere=on, quality_guard=on).
- `search-hybrid`: ha nincs explicit `engine` paraméter, beolvassa az app_settinget. Quality guard: ha top-1 score < küszöb VAGY 0 találat → fallback v12. Egységes HU-only podcast filter.
- `search-answer`: HU guard (regen 1x → fallback). Soha nem ad ki nem-HU mondatot.
- SearchPage: "Miért releváns?" 1 mondatos magyar magyarázat találatonként magas-konfidenciánál (entity/topic/title hit alapján, nem AI generált).
- Homepage hero / AskPodiverzum copy: „Keress gondolat, téma, személy vagy kérdés alapján — nem csak műsorcímre.”

### Fázis 2 — Hasonló epizódok + hasonló podcastok beépítése (PART 5, 6)
- A meglévő `SimilarEpisodes` / `SimilarPodcasts` komponensek **már léteznek**, de nincsenek beillesztve. Mountolás EpisodeDetail és PodcastDetail aljára.
- `similar_episodes` és `similar_podcasts` RPC-k áttekintése: HU-only filter biztosítása, azonos podcast enyhe downweight, friss + source score rerank, 4–8 elem, gyenge match esetén szekció elrejtése.
- Empty-state: ha nincs erős match, semmit nem renderelünk.

### Fázis 3 — Methodology oldal frissítés (PART 3)
- `/modszertan` átírás magyarul: jelentésalapú keresés, HU-only filter, AI összefoglalók, editorial safeguardok, sitemap szabály. Nincs technikai zsargon (vector/embedding/cosine).

### Fázis 4 — Mood cards perszonalizáció (PART 7, 8, 9, 11, 12)
- Új edge fn `get-personalized-mood-cards`: input { viewport, tod, dow, returning_pref? }. Output: 4 (mobile) / 6 (tablet+desktop) kártya, mind reason_label-lel ("Reggelre ajánlva", "Friss témák", stb.). Csak nem-érzékeny kontextus, semmi „IP-d alapján". Cookie consent: localStorage `mood_pref_v1` minimális preferencia (utoljára kattintott mood, max 5).
- `MoodCollections.tsx` átállítása az edge fn-re; viewport-szabályos layout (2x2 mobil, 2x3/3x2 tablet/desktop), „Összes hangulat” link.
- `MoodsPage.tsx` (`/hangulatok`) audit: HU-only filter, minden aktív mood listázva, magyar leírások, fallback.

### Fázis 5 — Mood vector-powered ajánlás (PART 10)
- `mood_collections` séma kiegészítés: `seed_embedding vector(768)`, `positive_topic_hints text[]`, `negative_topic_hints text[]`, `preferred_duration_min/max int`, `energy_level text`, `freshness_weight numeric`, `evergreen_weight numeric`.
- `mood-collections-seed` edge fn frissítés: minden aktívra seed embedding generálás (Lovable AI gemini-embedding-001, 768d).
- `MoodCollectionPage.tsx` váltása vektoros RPC-re (`recommend_episodes_for_mood`): HU-only, kiküszöböli rejected/non-HU, per-podcast cap (max 2-3), rerank semantic + recency + duration + source. Same-podcast downweight.

### Fázis 6 — Ask Podiverzum semantic upgrade (PART 13)
- `search-answer` mostani v13 hybrid + cited episode cards; HU guard; alacsony konfidencia → magyar „Nem találtam elég releváns epizódot" üzenet. Nincs külső tény, csak grounded.

### Fázis 7 — Admin vector & benchmark (PART 14, 16)
- `/admin/vector-search` új oldal: coverage számok (HU ep / embed / chunks / podcast emb / pending / failed / utolsó embedding), search engine setting toggle, mood coverage, smoke test gomb.
- Benchmark tool: lista a megadott 15 teszt-queryvel, mindhárom engine-en (v12 / v13 / v13+chunk-aug) top 10 + score komponensek + latency + HU-only flag. CSV export.
- Iterációs súlyok admin-állíthatók `app_settings.search_engine.weights`-en keresztül.

### Fázis 8 — Chunk-aug behind flag + finomhangolás (PART 15)
- `search-hybrid` v13 chunk-aug ág: ha `chunk_aug_enabled=true`, hosszú/long-tail queryken `episode_chunks` hit boostolja a parent epizódot (NEM helyettesít, csak boost). Threshold + cap.
- Tuning a Fázis 7 benchmark alapján: title/entity/person/semantic súlyok, podcast diversity, freshness.

### Fázis 9 — SEO szabályok + verifikáció (PART 17, 18)
- Sitemap audit: nincs `/kereses?q=…` URL benne; mood oldalak csak ha curated + 10+ HU epizód + egyedi meta. Robots noindex a generikus search result oldalakra.
- Verifikációs riport: a PART 18 minden pontja számokkal.

## Mit kérek tőled (priorizálás)
A teljes 9 fázis sok loop. Két kérdés:

1) Mehet-e ebben a sorrendben (1 → 9), és minden fázis külön loopban?
2) Van-e fázis amit ki akarsz hagyni vagy előrébb hozni (pl. Mood vektoros recsi (5) fontosabb-e most, mint Ask Podiverzum upgrade (6))?

Ha igen-mehet-így, akkor most a **Fázis 1**-et viszem végig (search v13 default + HU guard + Miért releváns + hero copy), és a végén jelentek számokkal. A többi fázist a következő loopokban.
