insert into public.topic_aliases (topic_id, alias, normalized_alias, weight)
select t.id, v.label, public.hu_norm_label(v.label), 3
from public.topics t
cross join lateral (values (t.name), (t.short_name)) as v(label)
where t.is_public and t.is_indexable and coalesce(btrim(v.label),'') <> ''
  and not exists (
    select 1 from public.topic_aliases ta where ta.normalized_alias = public.hu_norm_label(v.label)
  )
on conflict (normalized_alias) do nothing;