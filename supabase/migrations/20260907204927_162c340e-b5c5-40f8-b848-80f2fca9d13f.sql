create or replace function public.get_episode_index_text(p_episode_id uuid, p_max_chars integer default 16000)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select left(t.transcript, greatest(500, least(coalesce(p_max_chars, 16000), 20000)))
  from public.episode_transcripts t
  where t.episode_id = p_episode_id
    and t.transcript is not null
    and length(t.transcript) > 500
    and coalesce(t.status, 'ok') = 'ok'
    and coalesce(t.rights_status, 'rss_public_index_only') = 'rss_public_index_only'
  order by length(t.transcript) desc
  limit 1
$$;

revoke all on function public.get_episode_index_text(uuid, integer) from public;
grant execute on function public.get_episode_index_text(uuid, integer) to anon, authenticated, service_role;