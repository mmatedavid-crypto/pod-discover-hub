CREATE OR REPLACE FUNCTION public.get_homepage_rails_with_images_v1(
  _trending_limit integer DEFAULT 8,
  _evergreen_limit integer DEFAULT 6,
  _category_limit integer DEFAULT 6,
  _max_categories integer DEFAULT 8
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH base AS (
  SELECT public.get_homepage_rails_v1(
    _trending_limit,
    _evergreen_limit,
    _category_limit,
    _max_categories
  ) AS j
),
trending AS (
  SELECT coalesce(
    jsonb_agg(
      jsonb_set(x.item, '{episode_image_url}', to_jsonb(e.image_url), true)
      ORDER BY x.ord
    ),
    '[]'::jsonb
  ) AS items
  FROM base b
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(b.j->'trending', '[]'::jsonb)) WITH ORDINALITY AS x(item, ord)
  LEFT JOIN public.episodes e ON e.id = (x.item->>'episode_id')::uuid
),
evergreen AS (
  SELECT coalesce(
    jsonb_agg(
      jsonb_set(x.item, '{episode_image_url}', to_jsonb(e.image_url), true)
      ORDER BY x.ord
    ),
    '[]'::jsonb
  ) AS items
  FROM base b
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(b.j->'evergreen', '[]'::jsonb)) WITH ORDINALITY AS x(item, ord)
  LEFT JOIN public.episodes e ON e.id = (x.item->>'episode_id')::uuid
),
category_items AS (
  SELECT
    c.key,
    coalesce(
      jsonb_agg(
        jsonb_set(x.item, '{episode_image_url}', to_jsonb(e.image_url), true)
        ORDER BY x.ord
      ),
      '[]'::jsonb
    ) AS items
  FROM base b
  CROSS JOIN LATERAL jsonb_each(coalesce(b.j->'categories', '{}'::jsonb)) AS c(key, arr)
  CROSS JOIN LATERAL jsonb_array_elements(coalesce(c.arr, '[]'::jsonb)) WITH ORDINALITY AS x(item, ord)
  LEFT JOIN public.episodes e ON e.id = (x.item->>'episode_id')::uuid
  GROUP BY c.key
),
categories AS (
  SELECT coalesce(jsonb_object_agg(key, items), '{}'::jsonb) AS items
  FROM category_items
)
SELECT jsonb_set(
  jsonb_set(
    jsonb_set(
      b.j,
      '{trending}',
      (SELECT items FROM trending),
      true
    ),
    '{evergreen}',
    (SELECT items FROM evergreen),
    true
  ),
  '{categories}',
  (SELECT items FROM categories),
  true
)
FROM base b;
$$;

GRANT EXECUTE ON FUNCTION public.get_homepage_rails_with_images_v1(integer, integer, integer, integer) TO anon, authenticated;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'homepage_rails_image_policy',
  jsonb_build_object(
    'version', 1,
    'rpc', 'get_homepage_rails_with_images_v1',
    'rule', 'Homepage rails include episode_image_url from episodes.image_url and keep podcast_image_url as fallback.',
    'updated_at', now()
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
