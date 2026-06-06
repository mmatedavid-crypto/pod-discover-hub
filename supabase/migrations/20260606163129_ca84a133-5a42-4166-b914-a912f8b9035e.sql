
CREATE OR REPLACE FUNCTION public.merge_organizations(src_id uuid, dst_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src record;
  v_dst record;
  v_moved int := 0;
  v_dupes int := 0;
  v_alias_moved int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    -- allow when called from service_role (no auth.uid()) by edge functions / SQL admin
    IF auth.uid() IS NOT NULL THEN
      RAISE EXCEPTION 'merge_organizations: admin only';
    END IF;
  END IF;

  IF src_id = dst_id THEN
    RAISE EXCEPTION 'merge_organizations: src and dst are the same';
  END IF;

  SELECT id, slug, name, episode_count INTO v_src FROM organizations WHERE id = src_id;
  SELECT id, slug, name, episode_count INTO v_dst FROM organizations WHERE id = dst_id;
  IF v_src.id IS NULL OR v_dst.id IS NULL THEN
    RAISE EXCEPTION 'merge_organizations: src or dst not found';
  END IF;

  -- 1. Move episode mappings, skip conflicts (dst already has same episode)
  WITH moved AS (
    UPDATE episode_organization_map m
    SET organization_id = dst_id
    WHERE m.organization_id = src_id
      AND NOT EXISTS (
        SELECT 1 FROM episode_organization_map d
        WHERE d.episode_id = m.episode_id AND d.organization_id = dst_id
      )
    RETURNING 1
  )
  SELECT count(*) INTO v_moved FROM moved;

  -- 2. Delete remaining (conflict) duplicates
  WITH del AS (
    DELETE FROM episode_organization_map WHERE organization_id = src_id RETURNING 1
  )
  SELECT count(*) INTO v_dupes FROM del;

  -- 3. Move organization_aliases referencing src
  WITH alias_moved AS (
    UPDATE organization_aliases SET organization_id = dst_id
    WHERE organization_id = src_id
    RETURNING 1
  )
  SELECT count(*) INTO v_alias_moved FROM alias_moved;

  -- 4. Seed the src name as an alias on dst (so future re-extraction normalizes)
  INSERT INTO canonical_entity_aliases (entity_kind, canonical_slug, canonical_name, alias, normalized_alias, language, weight, status, source, notes)
  VALUES (
    'organization', v_dst.slug, v_dst.name, v_src.name, lower(regexp_replace(v_src.name, '\s+', ' ', 'g')),
    'hu', 20, 'active', 'merge_organizations',
    'auto-seeded on merge from slug=' || v_src.slug
  )
  ON CONFLICT (entity_kind, normalized_alias, canonical_slug) DO NOTHING;

  -- 5. Delete src org
  DELETE FROM organizations WHERE id = src_id;

  -- 6. Audit
  UPDATE app_settings
  SET value = COALESCE(value, '{}'::jsonb) || jsonb_build_object(
    'log', COALESCE(value->'log', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'at', now(),
      'src_slug', v_src.slug, 'src_name', v_src.name,
      'dst_slug', v_dst.slug, 'dst_name', v_dst.name,
      'moved', v_moved, 'deleted_dupes', v_dupes, 'alias_moved', v_alias_moved
    ))
  )
  WHERE key = 'org_merge_log';
  IF NOT FOUND THEN
    INSERT INTO app_settings(key, value) VALUES ('org_merge_log', jsonb_build_object(
      'log', jsonb_build_array(jsonb_build_object(
        'at', now(),
        'src_slug', v_src.slug, 'src_name', v_src.name,
        'dst_slug', v_dst.slug, 'dst_name', v_dst.name,
        'moved', v_moved, 'deleted_dupes', v_dupes, 'alias_moved', v_alias_moved
      ))
    ));
  END IF;

  RETURN jsonb_build_object(
    'src_slug', v_src.slug, 'dst_slug', v_dst.slug,
    'moved', v_moved, 'deleted_dupes', v_dupes, 'alias_moved', v_alias_moved
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_organizations(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_organizations(uuid, uuid) TO service_role;
