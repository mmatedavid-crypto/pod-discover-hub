
create or replace function public.get_swipe_seed_episodes(p_limit int default 8)
returns table (
  episode_id uuid, podcast_id uuid, title text, display_title text, slug text,
  image_url text, ai_summary text, podcast_title text, podcast_slug text, podcast_image_url text
)
language sql stable security definer set search_path = public as $$
  with eligible as (
    select e.id, e.podcast_id, e.title, e.display_title, e.slug,
           e.image_url, e.ai_summary,
           p.title as p_title, p.slug as p_slug, p.image_url as p_image
    from episodes e
    join podcasts p on p.id = e.podcast_id
    join episode_embeddings ee on ee.episode_id = e.id
    where p.language ilike 'hu%'
      and e.published_at >= now() - interval '180 days'
      and coalesce(e.image_url, p.image_url) is not null
      and coalesce(e.ai_summary, '') <> ''
      and p.shadow_rank_tier in ('S','A','B')
  )
  select id, podcast_id, title, display_title, slug, coalesce(image_url, p_image),
         ai_summary, p_title, p_slug, p_image
  from eligible
  order by random()
  limit p_limit;
$$;
grant execute on function public.get_swipe_seed_episodes(int) to anon, authenticated;

create or replace function public.match_episodes_by_centroid(
  p_liked uuid[], p_disliked uuid[] default '{}'::uuid[], p_limit int default 8
)
returns table (
  episode_id uuid, podcast_id uuid, title text, display_title text, slug text,
  image_url text, ai_summary text, podcast_title text, podcast_slug text,
  podcast_image_url text, similarity double precision
)
language plpgsql stable security definer set search_path = public as $$
declare v_centroid vector(768); v_neg vector(768); v_exclude uuid[];
begin
  if p_liked is null or array_length(p_liked,1) is null then return; end if;
  select avg(embedding)::vector(768) into v_centroid from episode_embeddings where episode_id = any(p_liked);
  if v_centroid is null then return; end if;
  if p_disliked is not null and array_length(p_disliked,1) is not null then
    select avg(embedding)::vector(768) into v_neg from episode_embeddings where episode_id = any(p_disliked);
    if v_neg is not null then
      v_centroid := (v_centroid::vector - (v_neg::vector * 0.3))::vector(768);
    end if;
  end if;
  v_exclude := coalesce(p_liked,'{}') || coalesce(p_disliked,'{}');
  return query
  select e.id, e.podcast_id, e.title, e.display_title, e.slug,
         coalesce(e.image_url, p.image_url), e.ai_summary,
         p.title, p.slug, p.image_url,
         1 - (ee.embedding <=> v_centroid)
  from episode_embeddings ee
  join episodes e on e.id = ee.episode_id
  join podcasts p on p.id = e.podcast_id
  where p.language ilike 'hu%' and not (e.id = any(v_exclude))
  order by ee.embedding <=> v_centroid
  limit p_limit;
end;
$$;
grant execute on function public.match_episodes_by_centroid(uuid[], uuid[], int) to anon, authenticated;
