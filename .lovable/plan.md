## 48h Public Launch Sprint

**Cél:** 500,000 epizód + minőségi tartalom + public-ready, 48 órán belül.

### Kiindulás (most)
| Metrika | Érték | Kell |
|---|---|---|
| Epizódok | 129,884 | 500,000 (+370k) |
| DH függőben (S/A/B/C) | 1,258 podcast | mind kész |
| DH várható plusz | ~245k epizód | nem elég |
| AI enrichment pending | 34,239 | < 5,000 |
| Episode embeddings | 1,570 / ~129k | min. S+A teljes |
| Podcast embeddings | 1,544 | mind S/A/B/C |
| Új epizód / 24h | 1,838 | ~185,000/nap |

### Realitás-check

A **370k új epizód 48h alatt csak akkor jön be**, ha:
1. **DH targetek megduplázódnak** (S=1000, A=600, B=300, C=100) → ~480k várható
2. **DH cron `*/2`-re gyorsul** + concurrency emelés
3. **Új podcastok S/A/B/C-be sorolása** (D/E tier promotálás vagy új import)

Ha csak az 1+2 fut → ~375–400k. Ha mind a 3 → 500k reálisan elérhető.

---

### Fázis 1 — Volume push (0–24h)

**A. Deep Hydration tier targets duplázása**
- Update `app_settings.deep_hydration_targets`: S=1000, A=600, B=300, C=100
- Trigger `reopen_deep_hydration_on_target_bump` automatikusan újranyitja a podcastokat
- Várható plusz: ~245k → ~480k epizód

**B. DH cron felgyorsítása**
- `set_deep_hydration_schedule('*/2 * * * *')`
- Runner concurrency emelés (jelenleg low) — lépésenként, monitorozva
- Adaptive guardrail: ha PI rate-limit jön, lépcsőzetesen vissza `*/5`-re

**C. RSS hunter + incremental refresh felpörgetés**
- RSS hunter `0 */2 * * *` (recovery → aktív)
- Incremental refresh adaptive vissza
- Több új epizódot hoz a meglévő feed-ekből

**D. PI dump + discovery új import** (ha kell még feed)
- 1 nagy PI dump batch indítása → új S/A/B candidate-ek

### Fázis 2 — Minőség (párhuzamosan)

**E. AI enrichment backlog drain**
- Pending: 34,239 → seo-enrich-runner már `*/1`-en fut
- Daily budget emelés ideiglenesen $5 → $15
- Cél: < 5,000 pending 48h alatt

**F. Episode embeddings**
- Jelenleg 1,570 / ~150k várható
- Cron már `*/1`, de batch méretet 50 → 100, concurrency 6 → 8
- Cél 48h alatt: min. **S+A tier teljesen embeddelve** (~50k)

**G. Title cleanup**
- Aktiválás `*/30` (most `0 6 * * *` napi 1×)
- Display_title nélküli epizódok eltüntetése a public oldalakról

**H. Podcast embeddings**
- Most futtattuk be → 24h alatt mind az 533 S/A/B/C kész lesz

### Fázis 3 — Public launch readiness (36–48h)

**I. Homepage MV ellenőrzés**
- mv_homepage_feed + mv_homepage_evergreen 5 percenként frissül ✓
- Manuális QA: minden kategóriában van min. 4-8 friss epizód

**J. Search QA**
- Lefuttatni a `mem://qa/search-issues.md` benchmark setet
- Hibrid search + AI re-ranker eredmények
- Kritikus regressziók fixálása (de **nem ranking tuning** — embed backlog még)

**K. Robots / sitemap / SEO**
- robots.txt: jelenleg noindex? → ellenőrzés, public-re kapcsolás
- sitemap.xml friss, minden S/A podcast benne van
- Meta tagek minden detail page-en

**L. Incident guard ellenőrzés**
- `app_settings.background_jobs.enabled = true`, `incident_mode = false`
- Kill switch teszt (gyors on/off ciklus)

**M. Rate limit / cost monitoring**
- AI spend dashboard: napi $20 plafon
- Edge function error budget < 1%
- Embed/AI pipeline auto-pause működik

### Kockázatok

- **Gemini rate limit** — embed + AI jobok közös API key-en. Ha 429-re fut, lépcsőzetes back-off működik, de lassít.
- **PI rate limit** — DH `*/2` ütemnél PodcastIndex API-t terheli. Ha jön 429, vissza `*/5`-re.
- **Postgres terhelés** — sok új insert + embeddings index update. Statement timeout-ok már részben fixálva.
- **Költség** — AI $5/nap → $15/nap, episode embed ~$4 egyszer. Összesen ~$50–80 a 48h.

### Mit kell most eldönteni

1. **Engedélyezed a target duplázást** (S=1000, A=600, B=300, C=100)?
2. **Engedélyezed a $5 → $15 napi AI budget emelést** 48 órára?
3. **Discovery új import** is fusson, vagy maradjunk a meglévő ~1900 podcastnál?
4. **Public launch hard deadline** 48h múlva fix, vagy ha minőség nem ér oda, csúsztathatjuk?

Ha mind a 4-re igen → kezdem rögtön A→H lépésekkel és óránként riportolok.
