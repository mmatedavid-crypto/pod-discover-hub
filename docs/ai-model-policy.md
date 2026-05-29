# AI Model Policy

Goal: spend money only where model quality changes product quality.

## Default Choices

- Batch extraction, classification, language detection, suggestions: `google/gemini-2.5-flash-lite`.
- User-facing short answers, editorial copy, hard ambiguity review: `google/gemini-2.5-flash`.
- Embeddings: prefer the cheapest 768d model that meets retrieval benchmark quality.
- Pro/full frontier models: disabled for backlog/batch work unless a benchmark and daily cap explicitly justify them.

## Hard Rules

- No Pro models in recurring batch jobs.
- No Gemini 3 preview models in recurring batch jobs.
- No GPT-5 full/pro/5.5 models in recurring batch jobs.
- No silent fallback to a more expensive model.
- Every paid model call needs input validation, audit logging, and a daily budget cap.
- Empty, URL-only, placeholder, or too-short inputs must be skipped with zero estimated cost.

## Review Rules

- `gemini-2.5-flash` is allowed, but should be reviewed when `flash-lite` could do the job.
- Paid reranking needs a benchmark improvement, not just vibes.
- Embedding model changes require a search/recommendation benchmark before bulk re-embedding.

## Checks

Run:

```bash
npm run audit:ai-models
```

The script fails if blocked model families are referenced in Supabase functions.
