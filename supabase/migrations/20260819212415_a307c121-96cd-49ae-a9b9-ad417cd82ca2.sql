-- Fix lowercased first words after the "🎧▶️ Hallgasd ingyen: " CTA prefix
-- (proper nouns like "fábry Kornél" were being broken).
UPDATE public.episodes
SET seo_description = regexp_replace(
      seo_description,
      '^(🎧▶️ Hallgasd ingyen: )([a-záéíóöőúüű])',
      '\1' || upper(substring(seo_description from '^🎧▶️ Hallgasd ingyen: ([a-záéíóöőúüű])'))
    )
WHERE seo_description ~ '^🎧▶️ Hallgasd ingyen: [a-záéíóöőúüű]';