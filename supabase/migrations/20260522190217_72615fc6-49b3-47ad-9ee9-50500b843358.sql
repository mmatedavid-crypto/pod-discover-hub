
drop policy if exists "ai_call_audit public read" on public.ai_call_audit;
drop policy if exists "ai_jobs public read" on public.ai_enrichment_jobs;
drop policy if exists "ai_spend public read" on public.ai_spend_daily;
drop policy if exists "queue public read" on public.discovery_queue;
drop policy if exists "ep_clean public read" on public.episode_clean_text;
drop policy if exists "ep_transcripts public read" on public.episode_transcripts;
drop policy if exists "runs public read" on public.growth_runs;
drop policy if exists "habr public read" on public.hu_archive_backfill_runs;
drop policy if exists "oarj public read" on public.org_ai_review_jobs;
drop policy if exists "pajr public read" on public.person_ai_review_jobs;
drop policy if exists "pej public read" on public.person_enrichment_jobs;
drop policy if exists "pi_dump_imports public read" on public.pi_dump_imports;
drop policy if exists "pi_feed_staging public read" on public.pi_feed_staging;
drop policy if exists "plcl public read" on public.podcast_language_cleanup_log;
drop policy if exists "bench_results public read" on public.search_benchmark_results;
drop policy if exists "bench_runs public read" on public.search_benchmark_runs;
drop policy if exists "social_posts public read" on public.social_posts;

create policy "ai_call_audit admin read" on public.ai_call_audit for select using (has_role(auth.uid(),'admin'));
create policy "ai_jobs admin read" on public.ai_enrichment_jobs for select using (has_role(auth.uid(),'admin'));
create policy "ai_spend admin read" on public.ai_spend_daily for select using (has_role(auth.uid(),'admin'));
create policy "queue admin read" on public.discovery_queue for select using (has_role(auth.uid(),'admin'));
create policy "ep_clean admin read" on public.episode_clean_text for select using (has_role(auth.uid(),'admin'));
create policy "ep_transcripts admin read" on public.episode_transcripts for select using (has_role(auth.uid(),'admin'));
create policy "runs admin read" on public.growth_runs for select using (has_role(auth.uid(),'admin'));
create policy "habr admin read" on public.hu_archive_backfill_runs for select using (has_role(auth.uid(),'admin'));
create policy "oarj admin read" on public.org_ai_review_jobs for select using (has_role(auth.uid(),'admin'));
create policy "pajr admin read" on public.person_ai_review_jobs for select using (has_role(auth.uid(),'admin'));
create policy "pej admin read" on public.person_enrichment_jobs for select using (has_role(auth.uid(),'admin'));
create policy "pi_dump_imports admin read" on public.pi_dump_imports for select using (has_role(auth.uid(),'admin'));
create policy "pi_feed_staging admin read" on public.pi_feed_staging for select using (has_role(auth.uid(),'admin'));
create policy "plcl admin read" on public.podcast_language_cleanup_log for select using (has_role(auth.uid(),'admin'));
create policy "bench_results admin read" on public.search_benchmark_results for select using (has_role(auth.uid(),'admin'));
create policy "bench_runs admin read" on public.search_benchmark_runs for select using (has_role(auth.uid(),'admin'));
create policy "social_posts admin read" on public.social_posts for select using (has_role(auth.uid(),'admin'));

drop policy if exists "settings public read" on public.app_settings;
create policy "settings public read allowlist"
  on public.app_settings for select
  using (key = any (array['smart_player','search_suggestions']));
create policy "settings admin read"
  on public.app_settings for select
  using (has_role(auth.uid(),'admin'));

alter view public.v_person_collision_buckets set (security_invoker = on);
alter view public.person_activation_status_view set (security_invoker = on);
alter view public.person_ai_action_queue_view set (security_invoker = on);
alter view public.person_ai_review_summary_view set (security_invoker = on);
alter view public.v_hu_archive_completeness set (security_invoker = on);
alter view public.person_missing_content_review_view set (security_invoker = on);
alter view public.person_ai_duplicate_candidates_view set (security_invoker = on);
