
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
      (coalesce(pe.episode_count,0)::numeric + case when lower(pe.name) like lower((select t from q)) || '%' then 50 else 0 end)
    from people pe
    where (pe.is_indexable = true or pe.is_public = true)
      and coalesce(pe.episode_count,0) >= 1
      and (select length(t) from q) >= 2
      and (pe.name ilike '%' || (select t from q) || '%' or pe.normalized_name ilike '%' || (select t from q) || '%')
    order by 7 desc nulls last
    limit p_limit
  )
  union all
  (
    select distinct on (p.id)
      'podcast'::text, p.id, p.title, p.slug, p.image_url,
      ('Említve: ' || coalesce(e.display_title, e.title))::text,
      (coalesce(p.podiverzum_rank,0) * 0.5)::numeric
    from episodes e
    join podcasts p on p.id = e.podcast_id
    where p.language ilike 'hu%'
      and (select length(t) from q) >= 2
      and (e.title ilike '%' || (select t from q) || '%' or e.display_title ilike '%' || (select t from q) || '%')
    order by p.id, p.podiverzum_rank desc nulls last
    limit p_limit
  )
$function$;
