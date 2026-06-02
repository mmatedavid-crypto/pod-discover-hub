INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'weekly_editorial_controls',
  jsonb_build_object(
    'enabled', true,
    'policy', 'weekly_editorial_v3_auto_public_hu_diverse',
    'cadence', 'weekly_monday_morning',
    'min_text_chars', 180,
    'max_candidates', 500,
    'allow_reuse_existing_week', true,
    'auto_publish', true,
    'model', 'google/gemini-2.5-flash',
    'note', 'Weekly public editorial. Reuses the current week post, publishes automatically, and avoids repeat AI billing for the same week.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || EXCLUDED.value,
    updated_at = now();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'podiverzum-weekly-editorial-post') THEN
    PERFORM cron.unschedule('podiverzum-weekly-editorial-post');
  END IF;

  PERFORM cron.schedule(
    'podiverzum-weekly-editorial-post',
    '30 6 * * 1',
    $cmd$
    SELECT net.http_post(
      url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/weekly-editorial-post',
      headers := '{"Content-Type":"application/json","apikey":"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8"}'::jsonb,
      body := concat('{"trigger":"weekly_cron","publish":true,"ts":"', now(), '"}')::jsonb
    );
    $cmd$
  );
END $$;

WITH bounds AS (
  SELECT
    (current_date - interval '7 days')::date AS week_start,
    current_date::date AS week_end
),
base_candidates AS (
  SELECT
    e.id AS episode_id,
    e.slug AS episode_slug,
    COALESCE(NULLIF(e.display_title, ''), e.title) AS episode_title,
    e.published_at,
    p.id AS podcast_id,
    p.slug AS podcast_slug,
    COALESCE(NULLIF(p.display_title, ''), p.title) AS podcast_name,
    regexp_replace(
      regexp_replace(lower(COALESCE(NULLIF(p.display_title, ''), p.title, p.slug)), '\m(podcast|podcastok|radio|rádió|musor|műsor)\M', '', 'gi'),
      '[^a-z0-9áéíóöőúüű]+',
      '',
      'g'
    ) AS brand_key,
    COALESCE(NULLIF(ct.cleaned_text, ''), NULLIF(e.ai_summary, ''), NULLIF(e.summary, ''), NULLIF(e.description, ''), '') AS source_text,
    (
      CASE p.rank_label
        WHEN 'S' THEN 140
        WHEN 'A' THEN 95
        WHEN 'B' THEN 55
        WHEN 'C' THEN 20
        ELSE 0
      END
      + LEAST(40, GREATEST(0, 8 - EXTRACT(day FROM (now() - e.published_at)))::int * 5)
      + LEAST(20, COALESCE(p.podiverzum_rank, 0)::int * 2)
    ) AS score
  FROM public.episodes e
  JOIN public.podcasts p ON p.id = e.podcast_id
  LEFT JOIN public.episode_clean_text ct ON ct.episode_id = e.id
  WHERE e.published_at >= now() - interval '9 days'
    AND e.slug IS NOT NULL
    AND p.slug IS NOT NULL
    AND p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND COALESCE(p.rss_status, '') NOT IN ('failed', 'inactive', 'deleted')
    AND COALESCE(p.category, '') <> 'Religion & Spirituality'
    AND (p.rank_label IN ('S', 'A', 'B', 'C') OR p.featured = true)
    AND length(COALESCE(NULLIF(ct.cleaned_text, ''), NULLIF(e.ai_summary, ''), NULLIF(e.summary, ''), NULLIF(e.description, ''), '')) >= 180
),
candidates AS (
  SELECT
    b.*,
    row_number() OVER (PARTITION BY b.podcast_id ORDER BY b.published_at DESC NULLS LAST) AS podcast_rn,
    row_number() OVER (PARTITION BY b.brand_key ORDER BY b.score DESC, b.published_at DESC NULLS LAST) AS brand_rn
  FROM base_candidates b
),
picked AS (
  SELECT *
  FROM candidates
  WHERE podcast_rn = 1
    AND brand_rn = 1
  ORDER BY score DESC, published_at DESC NULLS LAST
  LIMIT 5
),
numbered AS (
  SELECT
    row_number() OVER (ORDER BY score DESC, published_at DESC NULLS LAST) AS rn,
    *
  FROM picked
),
payload AS (
  SELECT
    b.week_start,
    b.week_end,
    jsonb_agg(
      jsonb_build_object(
        'episode_id', n.episode_id,
        'title', n.episode_title,
        'podcast_name', n.podcast_name,
        'podcast_slug', n.podcast_slug,
        'episode_slug', n.episode_slug,
        'url', 'https://podiverzum.hu/podcast/' || n.podcast_slug || '/' || n.episode_slug,
        'teaser', left(regexp_replace(n.source_text, '\s+', ' ', 'g'), 420),
        'quote', null,
        'cover_card_url', null,
        'score', n.score,
        'source_quality', null,
        'source_text_chars', length(n.source_text)
      )
      ORDER BY n.rn
    ) AS items
  FROM bounds b
  JOIN numbered n ON true
  GROUP BY b.week_start, b.week_end
)
INSERT INTO public.editorial_posts (
  week_start,
  week_end,
  status,
  title,
  intro,
  items,
  ig_caption,
  fb_caption,
  ai_model,
  generation_meta,
  trigger,
  approved_at,
  published_at
)
SELECT
  p.week_start,
  p.week_end,
  'published',
  'A hét a Podiverzumon',
  'Elindult a Podiverzum heti válogatása: friss magyar podcastok, erős témák és olyan epizódok, amelyekből látszik, miről beszél az ország.',
  p.items,
  'A hét a Podiverzumon: friss magyar podcastválogatás a Podiverzumon.',
  'A hét a Podiverzumon: friss magyar podcastválogatás a Podiverzumon. https://podiverzum.hu/heti',
  'sql_bootstrap_no_ai',
  jsonb_build_object(
    'policy', 'weekly_editorial_public_bootstrap_v1',
    'picked', jsonb_array_length(p.items),
    'reason', 'Ensure /heti has a public current issue before the weekly AI cron creates the next editorial post.'
  ),
  'migration_bootstrap',
  now(),
  now()
FROM payload p
WHERE jsonb_array_length(p.items) >= 3
  AND NOT EXISTS (
    SELECT 1
    FROM public.editorial_posts ep
    WHERE ep.status = 'published'
      AND ep.week_start >= current_date - interval '10 days'
  );
