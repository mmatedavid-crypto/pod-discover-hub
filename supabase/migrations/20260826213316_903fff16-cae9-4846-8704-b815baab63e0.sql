create or replace function public.top_unmapped_episode_topics(p_min_count integer default 15, p_limit integer default 60)
returns table(name text, mentions bigint)
language sql
stable
security definer
set search_path = public
as $$
  with t as (
    select lower(btrim(x)) nm
    from episodes e
    join podcasts p on p.id = e.podcast_id
    cross join lateral unnest(e.topics) as x
    where p.language_decision = 'accept_hungarian'
      and e.topics is not null
  ), agg as (
    select nm, count(*) c
    from t
    where length(nm) between 3 and 60
    group by nm
    having count(*) >= p_min_count
  )
  select a.nm::text, a.c
  from agg a
  where not exists (
    select 1 from topic_aliases ta where ta.normalized_alias = a.nm
  )
  and not exists (
    select 1 from topics tp where lower(tp.name) = a.nm or lower(coalesce(tp.short_name,'')) = a.nm
  )
  order by a.c desc
  limit p_limit;
$$;

grant execute on function public.top_unmapped_episode_topics(integer, integer) to service_role;