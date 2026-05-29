# Podiverzum Intelligence Roadmap

Goal: become Hungary's leading podcast directory and podcast intelligence platform.

## North Star

Podiverzum should feel like a lovable podcast Netflix for listeners, while the same data layer powers B2B media monitoring for brands, public figures, organizations, and political parties.

The moat is not the page shell. The moat is clean text, entity quality, semantic search, recommendations, and reliable mention evidence.

## Layer 1: Clean Text Quality

The system must prefer `episode_clean_text.cleaned_text` over raw RSS descriptions for search, entity extraction, summaries, chunks, and recommendations.

Quality gates:

- Track clean-text coverage across recent and high-tier Hungarian episodes.
- Detect overcleaning: long raw descriptions becoming empty or tiny clean text.
- Detect undercleaning: URLs, social links, CTA boilerplate, emails, platform lists left in clean text.
- Re-run cleaner after heuristic changes, then re-run dependent embeddings/entities.

Current instrumentation:

- `/admin/intelligence-audit`
- `npm run audit:intelligence`

## Layer 2: Entity Extraction

Entity extraction must distinguish:

- `people`: people speaking in the episode.
- `mentioned`: people discussed but absent.
- `organizations`: typed organizations such as company, party, institution, media, NGO.
- `topics`: short searchable themes.
- `tickers`: stock symbols and mapped company names.

Quality gates:

- Every extracted entity needs evidence or a source phrase where possible.
- Political figures default to `mentioned` unless the metadata clearly says they speak.
- Show hosts and podcast names must not become subject entities.
- Organizations need canonicalization and aliases.
- Low-confidence entities go to review, not straight to public/B2B reporting.

## Layer 3: Vector Usage

The 768d episode embeddings should power more than hidden similarity:

- hybrid search: FTS + vector + freshness + source quality;
- related episodes on episode pages;
- topic/person/company pages with semantic expansion;
- user taste vectors from swipe behavior;
- B2B entity-adjacent episode discovery.

Quality gates:

- Golden query benchmark for consumer search.
- Entity-specific benchmark for brand/person/party monitoring.
- Recommendation diagnostics explaining why an episode was selected.

## Layer 4: Listener Product

Consumer experience should center on repeated use:

- Today for you;
- continue listening;
- mood rails;
- followed shows and topics;
- "because you liked..." explanations;
- high-quality persistent player;
- like/dislike/save feedback loops.

## Layer 5: B2B Monitoring

B2B is powered by the same entity layer, but needs evidence and trust:

- brand/person/party mention dashboard;
- mention timelines;
- episode, podcast, date, snippet, confidence;
- competitor comparisons;
- alerts;
- CSV/report export.

## Immediate Sequence

1. Stabilize clean text and reprocess recent/high-tier episodes.
2. Re-run entity extraction from clean text.
3. Re-embed from clean text or clean-text-derived search documents.
4. Add benchmark sets for search and entity monitoring.
5. Improve recommendations with explicit diagnostics.

## AI Spend Guardrails

Paid AI calls must be fail-closed. Empty rows, URL-only descriptions, placeholder values, and title-only embedding inputs are not valid work.

Current code guardrails:

- Shared Gemini and Lovable helpers validate user-message content before network calls.
- Invalid inputs write `ai_call_audit.status='skipped'` with `estimated_cost_usd=0`.
- Episode and chunk embedding runners skip inputs with less than 80 useful characters after stripping URLs, handles, placeholders, and whitespace.
- Embedding runners report `skipped_last_run` in progress settings so waste prevention is visible.
- Model choices are governed by `docs/ai-model-policy.md`; run `npm run audit:ai-models` before deployment.

Operational rules:

- Prefer shared AI helpers over direct `fetch` to model APIs.
- Any new AI batch runner must have a preflight input validator and a daily budget cap.
- Any reprocess run starts with a dry-run plan and a small batch.
- A skipped row is not a failure if it prevented a paid empty call; the queue design should later mark permanently unprocessable rows explicitly.

## Production Refresh Runbook

Never overwrite the full corpus blindly. Keep the currently served clean text live until a replacement candidate exists and passes quality checks.

1. Deploy the frontend and these Supabase functions:
   - `episode-clean-text-runner`
   - `episode-clean-text-candidate-runner`
   - `intelligence-reprocess-admin`
   - `seo-enrich-enqueue`
   - `seo-enrich-runner`
   - `entity-backfill-runner`
   - `embed-episode-runner`
   - `embed-episode-chunks-runner`

2. Open `/admin/intelligence-audit`.

3. Click `Plan safe refresh`.
   - This is dry-run only.
   - It finds recent S/A/B/C Hungarian episodes with old cleaner versions, missing clean rows, overcleaned rows, undercleaned rows, or suspicious footer cuts.

4. Click `Stage refresh plan`.
   - This records the candidate episode IDs and reasons.
   - It does not delete `episode_clean_text`.
   - It does not set `episodes.clean_text_status='pending'`.
   - It does not clear SEO, summaries, entities, embeddings, chunks, or mention maps.
   - The public site keeps serving the old clean text and old derived data while the replacement is prepared.

5. Generate replacement clean-text candidates into a staging table or staging setting.
   - From `/admin/intelligence-audit`, click `Generate candidates`.
   - Compare old vs new retention ratio.
   - Reject empty, overcleaned, URL-only, and placeholder candidates.
   - Promote only rows that pass the quality gate.

6. After promotion, invalidate and rebuild only the promoted episodes:
   - SEO and `ai_summary`;
   - entity extraction;
   - episode embeddings;
   - chunk embeddings;
   - mention maps.

7. Re-run `/admin/intelligence-audit` and compare:
   - overcleaned should fall sharply;
   - entity v4 should rise;
   - embeddings should rise;
   - no-summary/no-entities should fall.

8. Repeat the batch with a larger limit only after the metrics move in the right direction.
