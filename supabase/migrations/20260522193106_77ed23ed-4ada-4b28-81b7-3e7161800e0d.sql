create or replace function public.match_episodes_by_centroid(
  p_liked uuid[], p_disliked uuid[] default '{}'::uuid[], p_limit int default 8
)
returns table (
  episode_id uuid, podcast_id uuid, title text, display_title text, slug text,
  image_url text, ai_summary text, podcast_title text, podcast_slug text,
  podcast_image_url text, similarity double precision
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_centroid vector(768);
  v_neg vector(768);
  v_exclude uuid[];
begin
  if p_liked is null or array_length(p_liked, 1) is null then
    return;
  end if;

  select avg(ee.embedding)::vector(768)
  into v_centroid
  from public.episode_embeddings ee
  where ee.episode_id = any(p_liked);

  if v_centroid is null then
    return;
  end if;

  if p_disliked is not null and array_length(p_disliked, 1) is not null then
    select avg(ee.embedding)::vector(768)
    into v_neg
    from public.episode_embeddings ee
    where ee.episode_id = any(p_disliked);

    if v_neg is not null then
      v_centroid := (v_centroid::vector - (v_neg::vector * 0.3))::vector(768);
    end if;
  end if;

  v_exclude := coalesce(p_liked, '{}'::uuid[]) || coalesce(p_disliked, '{}'::uuid[]);

  return query
  select e.id, e.podcast_id, e.title, e.display_title, e.slug,
         coalesce(e.image_url, p.image_url), e.ai_summary,
         p.title, p.slug, p.image_url,
         1 - (ee.embedding <=> v_centroid)
  from public.episode_embeddings ee
  join public.episodes e on e.id = ee.episode_id
  join public.podcasts p on p.id = e.podcast_id
  where p.language ilike 'hu%'
    and not (e.id = any(v_exclude))
  order by ee.embedding <=> v_centroid
  limit p_limit;
end;
$$;

grant execute on function public.match_episodes_by_centroid(uuid[], uuid[], int) to anon, authenticated;