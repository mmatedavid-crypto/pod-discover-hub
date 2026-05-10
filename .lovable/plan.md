## Search v2 — Implementation Plan

A 298k epizódhoz a jelenlegi 8-OR PostgREST search nem skálázódik. Az `mem://plans/search-v2.md` szerint csinálom, négy lépésben. AI/embed backlog még nincs teljesen lecsapolva (12k AI pending), de mivel a sprint nem fut, most van időablak.

### 1. Adatbázis: `search_text` materialized columns + indexek

**`episodes` táblán:**
- `search_text` GENERATED column: `unaccent(coalesce(display_title,title) || ' ' || coalesce(ai_summary,'') || ' ' || coalesce(summary,'') || ' ' || array_to_string(topics||people||companies||ingredients||tickers, ' '))`
- `search_tsv` tsvector GENERATED: `to_tsvector('simple', search_text)`
- `description` kihagyva (87k HTML, külön epizódban kezeljük később)
- 2 új index: `GIN search_tsv`, `GIN search_text gin_trgm_ops`
- A 10 régi trgm/array indexet **csak az új live verifikálása után** dobjuk

**`podcasts` táblán** ugyanez a pattern, de a category-vel együtt.

`unaccent` extension engedélyezése (ha még nincs).

### 2. Új RPC: `search_episodes_hybrid(q text, limit int, lang text)`

PostgreSQL function ami:
- websearch_to_tsquery + ts_rank_cd a lexikai oldalon (top 100)
- ha van `q_embedding` paraméter → cosine distance az `episode_embeddings`-en (top 100)
- RRF (reciprocal rank fusion) a két listán → top 50
- Visszaadja az episode-okat + lexical_rank + semantic_rank + rrf_score mezővel
- EN-only filter (language IS NULL OR ILIKE 'en%')

### 3. Edge function `search-hybrid`

- Bemenet: `{ q: string }`
- Lépések:
  1. Embedding generálás: Lovable AI `google/gemini-embedding-001` (768d) — ugyanaz mint az episode_embeddings
  2. RPC hívás `search_episodes_hybrid(q, q_embedding, 50)`
  3. AI re-rank: `google/gemini-2.5-flash-lite` a top 30-ra → top 15 sorrend + relevance label
  4. Cache: `Deno.env`-ben memória LRU (10 perc TTL) — a re-ranker olcsó de queryk ismétlődnek
- Output: ordered episodes + match_type per episode

### 4. Frontend `SearchPage.tsx`

- A `searchEpisodes()` helyett `supabase.functions.invoke("search-hybrid", { body: { q } })`
- Régi `src/lib/search.ts` megmarad **fallback**-ként 1 hétig (ha edge function fail/timeout)
- Loading state + "AI ranking..." badge ha re-rank folyik
- Match type badge továbbra is megjelenik

### 5. Synonyms + Hungarian

- A meglévő `search_synonyms` táblát beolvassuk az edge function-ban → query expansion az embedding generálás ELŐTT
- Az `unaccent` az indexen + a query oldalon is fut → `matchát` → `matchat` matchel

### Mit NEM csinálunk most
- HU stemming/ragozás kezelés (HU launch előtti task)
- Description GIN index retry (külön epizód, idle window)
- Régi indexek dropolása (1 hét fallback után)
- Query log driven synonym tuning (ongoing)

### Kockázatok
- A `search_tsv` GENERATED column létrehozása 298k soron lock-olja a táblát ~1-2 percig. **Időpont kérdés**: most vagy éjszaka?
- Az `embedding-001` API kvóta: minden user query 1 embedding call. Ha sok forgalom van, a re-rank cache fontos.
- AI re-ranker latency ~1.5-2s. Streamelnünk kell-e a lexical eredményeket előre, majd re-rank után átrendezni? — első verzióban nem, blokkoló.

### Sorrend
1. Migráció: `unaccent` + `search_text` + `search_tsv` + indexek (episodes + podcasts)
2. RPC `search_episodes_hybrid`
3. Edge function `search-hybrid` (cache + re-rank)
4. Frontend switch + fallback
5. QA: `mem://qa/search-issues.md` benchmark futtatás

**Kérdések indítás előtt:**
- Most futtassam a migrációt vagy várjunk éjszakára? (298k row, lock ~1-2 perc)
- Az AI re-rankert bekapcsoljuk indítástól, vagy első verzióban csak hybrid lexical+semantic, majd re-rank külön kapcsolóval?
