
-- Extend swipe anchor search: include episodes (FTS) so a guest's name surfaces even without a person row,
-- and allow free-text keyword anchors that seed via FTS.

CREATE OR REPLACE FUNCTION public.search_swipe_anchors(p_query text, p_limit integer DEFAULT 8)
RETURNS TABLE(kind text, id uuid, name text, slug text, image_url text, subtitle text, rank numeric)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with q as (select trim(coalesce(p_query, '')) as t)
  (
    select 'podcast'::text, p.id, p.title, p.slug, p.image_url,
      coalesce(nullif(p.category, ''), 'Podcast'),
      (coalesce(p.podiverzum_rank,0) + case when lower(p.title) like lower((select t from q)) || '%' then 5 else 0 end)::numeric
    from podcasts p
    where p.language ilike 'hu%'
      and (select length(t) from q) >= 2
      and (p.title ilike '%' || (select t from q) || '%' or p.slug ilike '%' || (select t from q) || '%')
    order by 7 desc nulls last, p.podiverzum_rank desc
    limit p_limit
  )
  union all
  (
    select 'person'::text, pe.id, pe.name, pe.slug, pe.image_url,
      coalesce(left(pe.wikipedia_description, 80), 'Személy'),
      (pe.episode_count::numeric + case when lower(pe.name) like lower((select t from q)) || '%' then 50 else 0 end)
    from people pe
    where pe.is_public = true
      and (select length(t) from q) >= 2
      and (pe.name ilike '%' || (select t from q) || '%' or pe.normalized_name ilike '%' || (select t from q) || '%')
    order by 7 desc nulls last
    limit p_limit
  )
  union all
  -- Episode-title fallback: surface podcasts whose recent episode titles mention the query,
  -- useful when the queried person/guest is not in the people table.
  (
    select distinct on (p.id)
      'podcast'::text, p.id, p.title, p.slug, p.image_url,
      ('Említve: ' || coalesce(e.display_title, e.title))::text as subtitle,
      (coalesce(p.podiverzum_rank,0) * 0.5)::numeric as rank
    from episodes e
    join podcasts p on p.id = e.podcast_id
    where p.language ilike 'hu%'
      and (select length(t) from q) >= 2
      and (
        e.title ilike '%' || (select t from q) || '%'
        or e.display_title ilike '%' || (select t from q) || '%'
      )
    order by p.id, p.podiverzum_rank desc nulls last
    limit p_limit
  )
$function$;

-- Add keyword support to seed RPC
CREATE OR REPLACE FUNCTION public.get_swipe_seed_from_anchors(
  p_podcast_ids uuid[] DEFAULT '{}'::uuid[],
  p_person_ids uuid[] DEFAULT '{}'::uuid[],
  p_keywords text[] DEFAULT '{}'::text[],
  p_limit integer DEFAULT 8
)
RETURNS TABLE(episode_id uuid, podcast_id uuid, title text, display_title text, slug text, image_url text, ai_summary text, podcast_title text, podcast_slug text, podcast_image_url text, anchor_kind text)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with anchor_eps as (
    select e.id as episode_id, 'podcast'::text as anchor_kind, random() as r
    from episodes e
    join podcasts p on p.id = e.podcast_id
    where p.language ilike 'hu%'
      and e.podcast_id = any(coalesce(p_podcast_ids, '{}'::uuid[]))
      and exists (select 1 from episode_embeddings ee where ee.episode_id = e.id)
    union all
    select pem.episode_id, 'person'::text, random()
    from person_episode_mentions pem
    join podcasts p on p.id = pem.podcast_id
    where p.language ilike 'hu%'
      and pem.person_id = any(coalesce(p_person_ids, '{}'::uuid[]))
      and pem.relevance_status in ('confirmed','pending')
      and exists (select 1 from episode_embeddings ee where ee.episode_id = pem.episode_id)
    union all
    -- keyword anchors: FTS over episode title + display_title
    select e.id, 'keyword'::text, random()
    from episodes e
    join podcasts p on p.id = e.podcast_id
    where p.language ilike 'hu%'
      and exists (select 1 from episode_embeddings ee where ee.episode_id = e.id)
      and exists (
        select 1 from unnest(coalesce(p_keywords, '{}'::text[])) kw
        where length(trim(kw)) >= 2
          and (
            e.title ilike '%' || trim(kw) || '%'
            or e.display_title ilike '%' || trim(kw) || '%'
          )
      )
  ),
  picked as (
    select distinct on (episode_id) episode_id, anchor_kind
    from anchor_eps order by episode_id, random()
  ),
  ranked as (
    select episode_id, anchor_kind, random() as r from picked order by r limit p_limit
  )
  select e.id, e.podcast_id, e.title, e.display_title, e.slug, e.image_url, e.ai_summary,
         p.title, p.slug, p.image_url, r.anchor_kind
  from ranked r
  join episodes e on e.id = r.episode_id
  join podcasts p on p.id = e.podcast_id;
$function$;
