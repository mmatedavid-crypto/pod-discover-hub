create or replace function public.hu_norm_label(v text)
returns text
language sql
immutable
set search_path = public
as $$
  select translate(lower(btrim(regexp_replace(coalesce(v,''), '\s+', ' ', 'g'))),
                   'áéíóöőúüűÁÉÍÓÖŐÚÜŰâäàçêîôûñß',
                   'aeiooouuuaeiooouuuaaaceiouns');
$$;

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
  select public.hu_norm_label(x) as nm, min(btrim(x)) as sample_label, count(*)
  from episodes e
  join podcasts p on p.id = e.podcast_id
  cross join lateral unnest(e.topics) as x
  where p.language_decision = 'accept_hungarian'
    and e.topics is not null
    and length(btrim(x)) between 3 and 60
  group by public.hu_norm_label(x)
  having count(*) >= p_min_count;
  select count(*) into n from episode_topic_label_stats;
  return n;
end;
$$;

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
    and not exists (select 1 from topic_aliases ta where public.hu_norm_label(ta.normalized_alias) = s.normalized_label)
    and not exists (select 1 from topics tp where public.hu_norm_label(tp.name) = s.normalized_label or public.hu_norm_label(coalesce(tp.short_name,'')) = s.normalized_label)
  order by s.mentions desc
  limit p_limit;
$$;

grant execute on function public.refresh_episode_topic_label_stats(integer) to service_role;
grant execute on function public.top_unmapped_episode_topics(integer, integer) to service_role;
grant execute on function public.hu_norm_label(text) to service_role;