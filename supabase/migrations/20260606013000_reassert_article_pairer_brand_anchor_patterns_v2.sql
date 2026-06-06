-- Reassert article-pairer source patterns with a hard postcondition.
-- Production can drift back to broad topic words through older source config;
-- this migration leaves the final app_settings row in a brand-anchor-only state
-- and fails the deploy if any blocked generic pattern remains.

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
    'sources', EXCLUDED.value->'sources'
  ),
  updated_at = now();

DO $$
DECLARE
  v_controls jsonb;
  v_source_count integer;
  v_generic_count integer;
BEGIN
  SELECT value INTO v_controls
  FROM public.app_settings
  WHERE key = 'episode_article_pairer_controls';

  IF v_controls->>'pattern_safety_version' <> 'brand_anchor_no_topic_words_v2' THEN
    RAISE EXCEPTION 'article_pairer pattern_safety_version was not reasserted to v2';
  END IF;

  IF v_controls->>'patterns_policy' <> 'brand_or_show_name_only_no_topic_words' THEN
    RAISE EXCEPTION 'article_pairer patterns_policy is not brand-anchor-only';
  END IF;

  SELECT jsonb_array_length(COALESCE(v_controls->'sources', '[]'::jsonb))
  INTO v_source_count;

  IF v_source_count < 6 THEN
    RAISE EXCEPTION 'article_pairer expected at least 6 publisher sources, got %', v_source_count;
  END IF;

  SELECT count(*)
  INTO v_generic_count
  FROM jsonb_array_elements(COALESCE(v_controls->'sources', '[]'::jsonb)) source,
       jsonb_array_elements_text(COALESCE(source->'podcast_title_patterns', '[]'::jsonb)) pattern(value)
  WHERE lower(pattern.value) = ANY (ARRAY[
    'téma', 'közélet', 'gazdaság', 'tech', 'tudomány',
    'biznisz', 'forint', 'tőzsde', 'befektetés', 'checklist', 'after'
  ]);

  IF v_generic_count > 0 THEN
    RAISE EXCEPTION 'article_pairer found % blocked generic podcast_title_patterns', v_generic_count;
  END IF;
END $$;
