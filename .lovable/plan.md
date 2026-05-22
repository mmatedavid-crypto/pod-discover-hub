# A Te Podiverzumod — Taste Vector Engine

## Architecture

Taste cards are first-class semantic objects with their own 768D embeddings (same model as `episode_embeddings`: `google/gemini-embedding-001`). The user swipes cards (not episodes), their liked card embeddings are averaged into a **user taste vector**, then we cosine-match that vector to `episode_embeddings`.

## 1. Database (migration)

**Table `taste_cards`** — exactly as user spec'd:
- 768D `card_embedding vector(768)` with HNSW cosine index
- topic/mood/format/psych/archetype tag arrays
- `stage`, `sensitivity_level`, `validation_status`, `active`, `priority`
- `catalog_fit_score`, `top_episode_similarity` (validation outputs)

**RPC `match_episodes_by_taste_vector(user_vector, negative_vector, exclude_episode_ids, limit_count)`**:
- cosine sim to user_vector on `episode_embeddings`
- light penalty: `final = sim - 0.15 * neg_sim`
- quality boost from `podcasts.episode_rank` tiers (S/A/B/C)
- recency boost (last 90 days)
- HU-only filter
- diversity in SQL: window-rank per podcast, keep top-2 per podcast, ensure ≥5 distinct podcasts

**RPC `match_cards_for_seeding(...)`** — admin helper used by validator.

**RLS:** public read on `taste_cards WHERE active`, admin write.

## 2. Edge functions

**`taste-card-embedder`** (admin):
- pulls cards where `card_embedding IS NULL`
- calls Lovable AI Gateway `google/gemini-embedding-001` on `hidden_embedding_prompt`
- writes vector back
- batched, idempotent

**`taste-card-validator`** (admin):
- for each card: nearest 20 episodes via embeddings
- compute avg similarity, distinct podcast count
- write `top_episode_similarity`, `catalog_fit_score`, `validation_status` (ok if avg≥0.55 & distinct≥6, weak if mid, broken if avg<0.35)

**`taste-card-seed`** (admin one-shot): inserts the initial 120–180 card bank as SQL upsert (idempotent on `title`).

## 3. Card bank seed (120+ cards)

Coverage across all 16 domains the spec lists. Each card has visible `title` in HU preference-language ("Érdekelnek a …"), `hidden_embedding_prompt` rich HU description for embedding, and tag arrays. Sensitive domains (religion/politics/health/mental_health/finance) get `sensitivity_level` set and never use identity claims.

Stages distributed: ~40% `broad` (first 6–8 cards), ~35% `refine`, ~15% `style` (format/mood), ~10% `validate` (archetype disambiguation).

Seed inserted via migration so it ships with the feature.

## 4. Frontend — rewrite `src/pages/StartSwipePage.tsx`

Phases:
1. **Landing**: "A Te Podiverzumod" + "Kezdjük" CTA (no anchor picker anymore — that whole flow is removed).
2. **Swipe**: full-screen card, swipe left/right only (no up). Touch + button fallback (❌ / ❤).
3. **Result**: personal listening profile.

**localStorage `podiverzum_taste_v1`** state shape exactly per spec (sessionId, seenCardIds, liked/disliked, vectors stored as Float32 arrays serialized to base64, weight maps, totalSwipes, confidence).

**Vector math (client-side, in `src/lib/tasteVector.ts`):**
- `addToPositive(cardEmb)` / `addToNegative(cardEmb)` — incremental weighted mean
- weights: liked cards weighted by `priority` (default 1), with recency decay 0.95^n optional
- never subtract negative from positive
- coherence = avg pairwise cosine within positive set
- separation = 1 − cos(posMean, negMean)
- archetype confidence = softmax max over archetype tag weights
- catalog match strength = cached avg `top_episode_similarity` of liked cards
- confidence = weighted sum per spec

**Stopping rule** evaluated after every swipe:
- primary: swipes≥10 && positives≥6 && confidence≥0.72
- fallback A: swipes≥22 && positives≥5 && confidence≥0.60
- fallback B: swipes≥30

**Next-card selector** (`pickNextCard`):
- candidates = active cards not in seen
- score each: 0.35 uncertainty + 0.25 relevance + 0.20 coverage_gap + 0.10 disambiguation + 0.10 random
- first 6 swipes: force `stage='broad'` and rotate domains to ensure coverage
- batch-load card pool (id + embedding + tags + meta) up-front via paginated RPC `get_active_taste_cards()`

**Recommendation fetch** on result phase: call `match_episodes_by_taste_vector` with the computed vectors (passed as JSON arrays converted to pgvector via `::vector` cast in RPC).

## 5. Result page

`<TasteProfileResult/>` shows:
- archetype name (rule-based mapping from top archetype_tags weight)
- 1–2 sentence deterministic explanation template per archetype
- "Podcast-DNS" bars: top topic/mood weights normalized to %
- top 3–5 interest labels (chips)
- 8–16 recommended episodes grid
- 3–5 recommended podcasts strip
- share card preview + "Megosztom" (uses Web Share API + canvas-rendered 1080x1350 PNG)
- "Újrakezdem" → reset localStorage, back to landing

`/* TODO(ai-copy): behind feature flag, swap deterministic copy with `personalize-profile` edge fn */`

## 6. Share card

`src/lib/tasteShareCard.ts` — renders 1080x1350 canvas: black bg, red accent, white text, Podiverzum logo, archetype name large, 3–5 interest chips, Podcast-DNS bar block, "Find it. Hear it." footer, podiverzum.hu. Download as PNG + Web Share API when available.

## 7. Archetype mapping (deterministic)

`src/lib/tasteArchetypes.ts` — 12 archetypes with `tagAffinity: Record<string, number>`. Score = Σ(weight × affinity), highest wins. Includes copy templates.

## Technical details

- Embedding model: `google/gemini-embedding-001` 768D via Lovable AI Gateway (`LOVABLE_API_KEY` already configured).
- pgvector cosine ops on `card_embedding` and `episode_embeddings`.
- Card pool size for client: limit to ~500 cards with embeddings — fetched once on swipe start (cached in `sessionStorage`).
- No per-user AI calls in MVP.

## Out of scope (later)

- AI-generated personalized profile copy (flagged TODOs)
- Subtract-negative vector experiments
- Cross-session sync (currently localStorage only)
- Card auto-generation pipeline
