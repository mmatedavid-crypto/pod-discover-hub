
-- RPC 1: Unified anchor search (podcasts + people) for the swipe onboarding intro
create or replace function public.search_swipe_anchors(p_query text, p_limit integer default 8)
returns table (
  kind text,
  id uuid,
  name text,
  slug text,
  image_url text,
  subtitle text,
  rank numeric
)
language sql
stable
security definer
set search_path = public
as $$
  with q as (select trim(coalesce(p_query, '')) as t)
  (
    select
      'podcast'::text as kind,
      p.id,
      p.title as name,
      p.slug,
      p.image_url,
      coalesce(nullif(p.category, ''), 'Podcast') as subtitle,
      (p.podiverzum_rank + case when lower(p.title) like lower((select t from q)) || '%' then 5 else 0 end)::numeric as rank
    from podcasts p
    where p.language ilike 'hu%'
      and (select length(t) from q) >= 2
      and (
        p.title ilike '%' || (select t from q) || '%'
        or p.slug ilike '%' || (select t from q) || '%'
      )
    order by rank desc nulls last, p.podiverzum_rank desc
    limit p_limit
  )
  union all
  (
    select
      'person'::text as kind,
      pe.id,
      pe.name,
      pe.slug,
      pe.image_url,
      coalesce(left(pe.wikipedia_description, 80), 'Személy') as subtitle,
      (pe.episode_count::numeric + case when lower(pe.name) like lower((select t from q)) || '%' then 50 else 0 end) as rank
    from people pe
    where pe.is_public = true
      and (select length(t) from q) >= 2
      and (
        pe.name ilike '%' || (select t from q) || '%'
        or pe.normalized_name ilike '%' || (select t from q) || '%'
      )
    order by rank desc nulls last
    limit p_limit
  )
$$;

grant execute on function public.search_swipe_anchors(text, integer) to anon, authenticated;

-- RPC 2: Seed episodes biased from selected podcasts/people anchors
create or replace function public.get_swipe_seed_from_anchors(
  p_podcast_ids uuid[] default '{}',
  p_person_ids uuid[] default '{}',
  p_limit integer default 8
)
returns table (
  episode_id uuid,
  podcast_id uuid,
  title text,
  display_title text,
  slug text,
  image_url text,
  ai_summary text,
  podcast_title text,
  podcast_slug text,
  podcast_image_url text,
  anchor_kind text
)
language sql
stable
security definer
set search_path = public
as $$
  with anchor_eps as (
    -- episodes from chosen podcasts
    select e.id as episode_id, 'podcast'::text as anchor_kind, random() as r
    from episodes e
    join podcasts p on p.id = e.podcast_id
    where p.language ilike 'hu%'
      and e.podcast_id = any(coalesce(p_podcast_ids, '{}'::uuid[]))
      and exists (select 1 from episode_embeddings ee where ee.episode_id = e.id)
    union all
    -- episodes featuring chosen people
    select pem.episode_id, 'person'::text as anchor_kind, random() as r
    from person_episode_mentions pem
    join podcasts p on p.id = pem.podcast_id
    where p.language ilike 'hu%'
      and pem.person_id = any(coalesce(p_person_ids, '{}'::uuid[]))
      and pem.relevance_status in ('confirmed', 'pending')
      and exists (select 1 from episode_embeddings ee where ee.episode_id = pem.episode_id)
  ),
  picked as (
    select distinct on (episode_id) episode_id, anchor_kind
    from anchor_eps
    order by episode_id, r
  ),
  ranked as (
    select episode_id, anchor_kind, random() as r from picked
  )
  select
    e.id as episode_id,
    e.podcast_id,
    e.title,
    e.display_title,
    e.slug,
    e.image_url,
    e.ai_summary,
    p.title as podcast_title,
    p.slug as podcast_slug,
    p.image_url as podcast_image_url,
    r.anchor_kind
  from ranked r
  join episodes e on e.id = r.episode_id
  join podcasts p on p.id = e.podcast_id
  order by r.r
  limit p_limit
$$;

grant execute on function public.get_swipe_seed_from_anchors(uuid[], uuid[], integer) to anon, authenticated;
