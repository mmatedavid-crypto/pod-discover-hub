-- Weekly maintenance: refresh free-text topic label stats, then map the newly
-- frequent labels onto canonical topic hubs so new episodes keep gaining
-- bot-visible internal links into /temak/ pages.
insert into public.app_settings (key, value, updated_at)
values ('topic_alias_mapper_controls',
  jsonb_build_object(
    'enabled', true,
    'model', 'google/gemini-2.5-flash-lite',
    'min_count', 8,
    'batch', 200,
    'cron_job', 'topic-alias-mapper-weekly',
    'cron_schedule', '25 3 * * 1',
    'policy', 'internal_link_coverage_for_free_text_episode_topics_v1'
  ), now())
on conflict (key) do update set value = public.app_settings.value || excluded.value, updated_at = now();

select cron.unschedule(jobid) from cron.job where jobname in ('topic-alias-stats-weekly','topic-alias-mapper-weekly');

select cron.schedule(
  'topic-alias-stats-weekly',
  '15 3 * * 1',
  $$select public.refresh_episode_topic_label_stats(5);$$
);

select cron.schedule(
  'topic-alias-mapper-weekly',
  '25 3 * * 1',
  $$select net.http_post(
    url := 'https://yoxewklaybougzpmzvkg.supabase.co/functions/v1/topic-alias-mapper',
    headers := jsonb_build_object('Content-Type','application/json'),
    body := jsonb_build_object('batch', 200, 'min_count', 8)
  );$$
);