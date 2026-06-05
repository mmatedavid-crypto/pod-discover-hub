-- See supabase/migrations/20260605210000_reassert_article_pairer_sources_v4.sql
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'episode_article_pairer_controls',
  jsonb_build_object(
    'enabled', true,
    'policy', 'publisher_article_match_v1',
    'source_version', 'publisher_sources_v4',
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
      jsonb_build_object('outlet','444','feed_urls',jsonb_build_array('https://444.hu/feed'),'listing_urls',jsonb_build_array('https://444.hu/category/podcast','https://444.hu/cimke/podcast'),'podcast_title_patterns',jsonb_build_array('444','borízű','tyúkól','saját tőke','háromharmad')),
      jsonb_build_object('outlet','telex','feed_urls',jsonb_build_array('https://telex.hu/rss?tag=podcast','https://telex.hu/rss'),'listing_urls',jsonb_build_array('https://telex.hu/rovat/podcast','https://telex.hu/cimke/podcast'),'podcast_title_patterns',jsonb_build_array('telex','after','nyomozó','ízfokozó','téma','filmklub')),
      jsonb_build_object('outlet','hvg','feed_urls',jsonb_build_array('https://hvg.hu/rss','https://hvg.hu/rss/podcast'),'listing_urls',jsonb_build_array('https://hvg.hu/podcastok','https://hvg.hu/itthon/podcast','https://hvg.hu/gazdasag/podcast','https://hvg.hu/tudomany/podcast'),'podcast_title_patterns',jsonb_build_array('hvg','fülke','közélet','gazdaság','tech','tudomány')),
      jsonb_build_object('outlet','portfolio','feed_urls',jsonb_build_array('https://www.portfolio.hu/rss/all.xml'),'listing_urls',jsonb_build_array('https://www.portfolio.hu/podcast','https://www.portfolio.hu/uzlet/podcast'),'podcast_title_patterns',jsonb_build_array('portfolio','checklist','portfolio checklist','biznisz','forint','tőzsde')),
      jsonb_build_object('outlet','hold','feed_urls',jsonb_build_array('https://hold.hu/holdblog/feed/'),'listing_urls',jsonb_build_array('https://hold.hu/holdblog/','https://hold.hu/holdblog/tag/podcast/','https://hold.hu/holdblog/tag/hold-after-hours/'),'podcast_title_patterns',jsonb_build_array('hold','hold after hours','holdblog','after hours','befektetés')),
      jsonb_build_object('outlet','partizan','feed_urls',jsonb_build_array('https://www.partizan.hu/rss.xml'),'listing_urls',jsonb_build_array('https://www.partizan.hu/podcastok','https://www.partizan.hu/blog'),'podcast_title_patterns',jsonb_build_array('partizán','partizan','vétó','partizán podcast','háromharmad')),
      jsonb_build_object('outlet','qubit','feed_urls',jsonb_build_array('https://qubit.hu/feed'),'listing_urls',jsonb_build_array('https://qubit.hu/tag/podcast'),'podcast_title_patterns',jsonb_build_array('qubit','qubit podcast'))
    )
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object(
    'enabled', COALESCE(public.app_settings.value->'enabled','true'::jsonb),
    'policy','publisher_article_match_v1',
    'source_version','publisher_sources_v4',
    'batch_limit',220,
    'sources_per_run',3,
    'article_feed_item_limit',120,
    'max_article_fetches_per_run',40,
    'fetch_article_html',true,
    'recent_episode_days',90,
    'recent_article_days',90,
    'auto_confirm_threshold',0.82,
    'needs_review_threshold',0.68,
    'sources', EXCLUDED.value->'sources'
  ),
  updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'database_quality_fast_lane',
  jsonb_build_object('run_article_pairer',true,'article_pairer_limit',220,'article_pairer_sources_per_run',3,'run_best_text_source',true),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value
  || jsonb_build_object('run_article_pairer',true,'article_pairer_limit',220,'article_pairer_sources_per_run',3,'run_best_text_source',true),
  updated_at = now();