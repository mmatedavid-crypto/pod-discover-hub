-- Final publisher article pipeline policy reassertion.
-- Keeps source coverage, brand-anchor-only patterns and transcript-first best
-- text source controls together after older bundled app_settings rewrites.

ALTER TABLE public.episode_best_text_source
  DROP CONSTRAINT IF EXISTS episode_best_text_source_source_type_check;

ALTER TABLE public.episode_best_text_source
  ADD CONSTRAINT episode_best_text_source_source_type_check
  CHECK (source_type IN ('rss', 'spotify', 'youtube', 'article', 'transcript'));

ALTER TABLE public.episode_best_text_source
  VALIDATE CONSTRAINT episode_best_text_source_source_type_check;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_article_pairer_controls',
  jsonb_build_object(
    'enabled', true,
    'policy', 'publisher_article_match_v1',
    'source_version', 'publisher_sources_v4',
    'pattern_safety_version', 'brand_anchor_no_topic_words_v2',
    'patterns_policy', 'brand_or_show_name_only_no_topic_words',
    'blocked_generic_title_patterns', jsonb_build_array(
      'téma', 'közélet', 'gazdaság', 'tech', 'tudomány',
      'biznisz', 'forint', 'tőzsde', 'befektetés', 'checklist', 'after'
    ),
    'batch_limit', 220,
    'sources_per_run', 3,
    'article_feed_item_limit', 120,
    'max_article_fetches_per_run', 40,
    'fetch_article_html', true,
    'recent_episode_days', 90,
    'recent_article_days', 90,
    'auto_confirm_threshold', 0.82,
    'needs_review_threshold', 0.68,
    'reasserted_by', '20260608192000_reassert_article_pipeline_policy_v5_final',
    'sources', jsonb_build_array(
      jsonb_build_object(
        'outlet', '444',
        'feed_urls', jsonb_build_array('https://444.hu/feed'),
        'listing_urls', jsonb_build_array('https://444.hu/category/podcast', 'https://444.hu/cimke/podcast'),
        'podcast_title_patterns', jsonb_build_array('444', 'borízű', 'tyúkól', 'saját tőke', 'háromharmad')
      ),
      jsonb_build_object(
        'outlet', 'telex',
        'feed_urls', jsonb_build_array('https://telex.hu/rss?tag=podcast', 'https://telex.hu/rss'),
        'listing_urls', jsonb_build_array('https://telex.hu/rovat/podcast', 'https://telex.hu/cimke/podcast'),
        'podcast_title_patterns', jsonb_build_array('telex', 'telex after', 'nyomozó podcast', 'ízfokozó', 'telex filmklub')
      ),
      jsonb_build_object(
        'outlet', 'hvg',
        'feed_urls', jsonb_build_array('https://hvg.hu/rss', 'https://hvg.hu/rss/podcast'),
        'listing_urls', jsonb_build_array('https://hvg.hu/podcastok', 'https://hvg.hu/itthon/podcast', 'https://hvg.hu/gazdasag/podcast', 'https://hvg.hu/tudomany/podcast'),
        'podcast_title_patterns', jsonb_build_array('hvg', 'fülke')
      ),
      jsonb_build_object(
        'outlet', 'portfolio',
        'feed_urls', jsonb_build_array('https://www.portfolio.hu/rss/all.xml'),
        'listing_urls', jsonb_build_array('https://www.portfolio.hu/podcast', 'https://www.portfolio.hu/uzlet/podcast'),
        'podcast_title_patterns', jsonb_build_array('portfolio', 'portfolio checklist')
      ),
      jsonb_build_object(
        'outlet', 'hold',
        'feed_urls', jsonb_build_array('https://hold.hu/holdblog/feed/'),
        'listing_urls', jsonb_build_array('https://hold.hu/holdblog/', 'https://hold.hu/holdblog/tag/podcast/', 'https://hold.hu/holdblog/tag/hold-after-hours/'),
        'podcast_title_patterns', jsonb_build_array('hold', 'hold after hours', 'holdblog')
      ),
      jsonb_build_object(
        'outlet', 'partizan',
        'feed_urls', jsonb_build_array('https://www.partizan.hu/rss.xml'),
        'listing_urls', jsonb_build_array('https://www.partizan.hu/podcastok', 'https://www.partizan.hu/blog'),
        'podcast_title_patterns', jsonb_build_array('partizán', 'partizan', 'vétó', 'partizán podcast', 'háromharmad')
      ),
      jsonb_build_object(
        'outlet', 'qubit',
        'feed_urls', jsonb_build_array('https://qubit.hu/feed'),
        'listing_urls', jsonb_build_array('https://qubit.hu/tag/podcast'),
        'podcast_title_patterns', jsonb_build_array('qubit', 'qubit podcast')
      )
    )
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'enabled', COALESCE(public.app_settings.value->'enabled', 'true'::jsonb),
    'policy', 'publisher_article_match_v1',
    'source_version', 'publisher_sources_v4',
    'pattern_safety_version', 'brand_anchor_no_topic_words_v2',
    'patterns_policy', 'brand_or_show_name_only_no_topic_words',
    'blocked_generic_title_patterns', EXCLUDED.value->'blocked_generic_title_patterns',
    'batch_limit', 220,
    'sources_per_run', 3,
    'article_feed_item_limit', 120,
    'max_article_fetches_per_run', 40,
    'fetch_article_html', true,
    'recent_episode_days', 90,
    'recent_article_days', 90,
    'auto_confirm_threshold', 0.82,
    'needs_review_threshold', 0.68,
    'reasserted_by', '20260608192000_reassert_article_pipeline_policy_v5_final',
    'sources', EXCLUDED.value->'sources'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_best_text_source_controls',
  jsonb_build_object(
    'enabled', true,
    'batch_limit', 1000,
    'youtube_min_confidence', 0.78,
    'spotify_min_confidence', 0.55,
    'article_min_confidence', 0.82,
    'transcript_min_chars', 900,
    'prefer_external_gain_chars', 150,
    'article_prefer_gain_chars', 300,
    'rescan_after_days', 7,
    'policy', 'best_text_source_v3_transcript_first_confirmed_article_youtube',
    'reasserted_by', '20260608192000_reassert_article_pipeline_policy_v5_final'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE SET
  value = public.app_settings.value
    || jsonb_build_object(
      'enabled', true,
      'batch_limit', 1000,
      'youtube_min_confidence', 0.78,
      'spotify_min_confidence', 0.55,
      'article_min_confidence', 0.82,
      'transcript_min_chars', 900,
      'prefer_external_gain_chars', 150,
      'article_prefer_gain_chars', 300,
      'rescan_after_days', 7,
      'policy', 'best_text_source_v3_transcript_first_confirmed_article_youtube',
      'reasserted_by', '20260608192000_reassert_article_pipeline_policy_v5_final'
    ),
  updated_at = now();

DO $$
DECLARE
  v_pairer jsonb;
  v_best_source jsonb;
  v_source_count integer;
  v_generic_count integer;
  v_constraint_def text;
BEGIN
  SELECT value INTO v_pairer
  FROM public.app_settings
  WHERE key = 'episode_article_pairer_controls';

  SELECT value INTO v_best_source
  FROM public.app_settings
  WHERE key = 'episode_best_text_source_controls';

  SELECT pg_get_constraintdef(c.oid)
  INTO v_constraint_def
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'episode_best_text_source'
    AND c.conname = 'episode_best_text_source_source_type_check'
  LIMIT 1;

  SELECT jsonb_array_length(COALESCE(v_pairer->'sources', '[]'::jsonb))
  INTO v_source_count;

  SELECT count(*)
  INTO v_generic_count
  FROM jsonb_array_elements(COALESCE(v_pairer->'sources', '[]'::jsonb)) source,
       jsonb_array_elements_text(COALESCE(source->'podcast_title_patterns', '[]'::jsonb)) pattern(value)
  WHERE lower(pattern.value) = ANY (ARRAY[
    'téma', 'közélet', 'gazdaság', 'tech', 'tudomány',
    'biznisz', 'forint', 'tőzsde', 'befektetés', 'checklist', 'after'
  ]);

  IF COALESCE(v_pairer->>'source_version', '') <> 'publisher_sources_v4' THEN
    RAISE EXCEPTION 'episode_article_pairer_controls.source_version must be publisher_sources_v4';
  END IF;

  IF COALESCE(v_pairer->>'pattern_safety_version', '') <> 'brand_anchor_no_topic_words_v2'
     OR COALESCE(v_pairer->>'patterns_policy', '') <> 'brand_or_show_name_only_no_topic_words' THEN
    RAISE EXCEPTION 'article pairer pattern policy must be brand-anchor-only v2';
  END IF;

  IF COALESCE(v_source_count, 0) < 6 THEN
    RAISE EXCEPTION 'article pairer expected at least 6 sources, got %', COALESCE(v_source_count, 0);
  END IF;

  IF COALESCE(v_generic_count, 0) > 0 THEN
    RAISE EXCEPTION 'article pairer found % blocked generic title patterns', v_generic_count;
  END IF;

  IF COALESCE(v_best_source->>'policy', '') <> 'best_text_source_v3_transcript_first_confirmed_article_youtube'
     OR NOT (v_best_source ? 'article_min_confidence')
     OR NOT (v_best_source ? 'transcript_min_chars') THEN
    RAISE EXCEPTION 'best text source policy must be transcript-first with article controls';
  END IF;

  IF v_constraint_def IS NULL
     OR v_constraint_def NOT ILIKE '%article%'
     OR v_constraint_def NOT ILIKE '%transcript%' THEN
    RAISE EXCEPTION 'episode_best_text_source source_type constraint must accept article and transcript';
  END IF;
END $$;
