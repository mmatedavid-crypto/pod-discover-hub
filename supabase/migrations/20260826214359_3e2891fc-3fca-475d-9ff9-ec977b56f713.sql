create table if not exists public.episode_topic_label_stats (
  normalized_label text primary key,
  sample_label text not null,
  mentions integer not null default 0,
  refreshed_at timestamptz not null default now()
);

grant all on public.episode_topic_label_stats to service_role;
alter table public.episode_topic_label_stats enable row level security;
create policy "admins read topic label stats" on public.episode_topic_label_stats
  for select to authenticated using (public.has_role(auth.uid(), 'admin'));

create or replace function public.refresh_episode_topic_label_stats(p_min_count integer default 5)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  delete from episode_topic_label_stats;
  insert into episode_topic_label_stats (normalized_label, sample_label, mentions)
  select lower(btrim(x)) as nm, min(btrim(x)) as sample_label, count(*)
  from episodes e
  join podcasts p on p.id = e.podcast_id
  cross join lateral unnest(e.topics) as x
  where p.language_decision = 'accept_hungarian'
    and e.topics is not null
    and length(btrim(x)) between 3 and 60
  group by lower(btrim(x))
  having count(*) >= p_min_count;
  select count(*) into n from episode_topic_label_stats;
  return n;
end;
$$;

grant execute on function public.refresh_episode_topic_label_stats(integer) to service_role;

create or replace function public.top_unmapped_episode_topics(p_min_count integer default 15, p_limit integer default 60)
returns table(name text, mentions bigint)
language sql
stable
security definer
set search_path = public
as $$
  select s.sample_label::text, s.mentions::bigint
  from episode_topic_label_stats s
  where s.mentions >= p_min_count
    and not exists (select 1 from topic_aliases ta where ta.normalized_alias = s.normalized_label)
    and not exists (select 1 from topics tp where lower(tp.name) = s.normalized_label or lower(coalesce(tp.short_name,'')) = s.normalized_label)
  order by s.mentions desc
  limit p_limit;
$$;

grant execute on function public.top_unmapped_episode_topics(integer, integer) to service_role;