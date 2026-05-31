# Clean Text Gold Eval

This is the contract for the manually reviewed clean-text gold sample. The goal is to prove whether a cleaner version is actually better before any broad v3 -> v4 backfill, embedding, SEO, summary, or entity reprocessing is allowed.

## Sample

Use 60 episodes, 6 buckets x 10 rows:

1. `short_rss` - RSS raw text under 500 characters.
2. `long_narrative` - long editorial descriptions over 5000 characters.
3. `youtube_dominant` - confirmed YouTube description is longer or richer than RSS.
4. `sponsor_heavy` - high URL/social/CTA density.
5. `radio_bulletin` - short news/radio bulletin style items.
6. `suspected_overcut` - current cleaned text is under 20% of raw text.

Prefer a mix of podcast tiers and publishers inside every bucket. Do not let one podcast dominate a bucket.

## Required Columns

Export as `.xlsx` for editing, then save/export the reviewed file as CSV for the repo script.

Required columns:

- `episode_id`
- `podcast_title`
- `episode_title`
- `sample_bucket`
- `raw_text`
- `raw_len`
- `current_cleaned_text`
- `current_cleaned_len`
- `cleaner_method`
- `source_type`
- `yt_description`
- `quality_reasons`
- `notes_for_you`
- `gold_cleaned_text`

`gold_cleaned_text` is the only column that should be authored during review.

## Gold Rules

Keep:

- The actual topic, guest names, organizations, factual claims, chapter topics, and useful editorial context.
- Original wording as much as possible.
- Hungarian accents and punctuation when present.
- Disclosures such as `#hirdetés` only when they are attached to a substantive description and not just a tag wall.

Remove:

- URLs, short links, platform links, handles, social blocks.
- Calls to follow, subscribe, support, donate, join, book, register, buy.
- Sponsor blocks, legal disclaimers, ad-choice boilerplate, privacy boilerplate.
- Repeated podcast/channel boilerplate that is not about the episode.
- Pure timestamp/link lists when they add no topic context.

Do not:

- Rewrite or summarize.
- Translate.
- Invent missing content.
- Make the output nicer by paraphrasing. The best gold text is usually a cleaned substring-like extraction.

## Acceptance Gates

Global backfill stays disabled until an eval run over the gold CSV passes:

- `current_dirty_rate` must drop materially against the existing stored cleaned text.
- `candidate_dirty_rate <= 5%`.
- `candidate_overcut_rate <= 1%`.
- `candidate_gold_similarity >= 0.80` average token F1.
- Every `suspected_overcut` row must be manually inspected; no near-empty output may pass when gold is substantive.

## AI Trim Gate

Paid AI trim is allowed only for rows where `assessCleanTextQuality` marks the deterministic candidate as `needs_ai_trim=true` and `overcut_risk=false`.

Every AI output must then pass `validateExtractOnlyTrim`:

- At least 90% of candidate tokens must exist in the original text.
- Added-token ratio must stay under 8%.
- Candidate must not be near-empty compared with a long original.
- Candidate must not be longer than the original.

If validation fails, the AI output is discarded. The row stays unresolved for a better deterministic rule or manual gold review; it must not silently fall through to downstream embedding/SEO/entity refresh.

## Eval Command

Generate the sample directly from production read-only Postgres:

```bash
DATABASE_URL="postgresql://..." node scripts/export-clean-text-gold-sample.mjs --per-bucket=10 --out=/tmp/clean-text-gold-sample.csv
```

The exporter writes the required columns and keeps the sample balanced across the six buckets.

After the reviewed spreadsheet is exported to CSV:

```bash
node scripts/evaluate-clean-text-gold.mjs path/to/clean-text-gold.csv
```

The script reports current-vs-gold and candidate-vs-gold metrics using the same deterministic quality gate as the production cleaner.
