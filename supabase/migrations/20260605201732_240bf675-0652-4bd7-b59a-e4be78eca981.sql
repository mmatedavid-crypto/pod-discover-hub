CREATE OR REPLACE FUNCTION public.merge_organizations(p_src uuid, p_dst uuid, p_note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src_name text;
  v_src_slug text;
  v_dst_name text;
  v_dst_slug text;
  v_moved_eom int := 0;
  v_moved_jobs int := 0;
  v_moved_alias int := 0;
BEGIN
  IF p_src = p_dst THEN
    RAISE EXCEPTION 'merge_organizations: src equals dst (%)', p_src;
  END IF;

  SELECT name, slug INTO v_src_name, v_src_slug FROM organizations WHERE id = p_src;
  SELECT name, slug INTO v_dst_name, v_dst_slug FROM organizations WHERE id = p_dst;
  IF v_src_name IS NULL THEN
    RAISE EXCEPTION 'merge_organizations: src not found (%)', p_src;
  END IF;
  IF v_dst_name IS NULL THEN
    RAISE EXCEPTION 'merge_organizations: dst not found (%)', p_dst;
  END IF;

  UPDATE episode_organization_map SET organization_id = p_dst WHERE organization_id = p_src;
  GET DIAGNOSTICS v_moved_eom = ROW_COUNT;

  UPDATE org_ai_review_jobs SET organization_id = p_dst WHERE organization_id = p_src;
  GET DIAGNOSTICS v_moved_jobs = ROW_COUNT;

  UPDATE organization_aliases SET organization_id = p_dst WHERE organization_id = p_src;
  GET DIAGNOSTICS v_moved_alias = ROW_COUNT;

  INSERT INTO organization_aliases (organization_id, alias, normalized_alias, source, confidence, status)
  SELECT p_dst, v_src_name, lower(btrim(regexp_replace(v_src_name, '\s+', ' ', 'g'))), 'merge', 1.0, 'verified'
  WHERE NOT EXISTS (
    SELECT 1 FROM organization_aliases
    WHERE organization_id = p_dst
      AND normalized_alias = lower(btrim(regexp_replace(v_src_name, '\s+', ' ', 'g')))
  );

  UPDATE organizations dst SET
    wikidata_id           = COALESCE(dst.wikidata_id, src.wikidata_id),
    wikipedia_url         = COALESCE(dst.wikipedia_url, src.wikipedia_url),
    wikipedia_title       = COALESCE(dst.wikipedia_title, src.wikipedia_title),
    wikipedia_extract     = COALESCE(dst.wikipedia_extract, src.wikipedia_extract),
    wikipedia_description = COALESCE(dst.wikipedia_description, src.wikipedia_description),
    logo_url              = COALESCE(dst.logo_url, src.logo_url),
    short_description_hu  = COALESCE(dst.short_description_hu, src.short_description_hu),
    ai_bio                = COALESCE(dst.ai_bio, src.ai_bio)
  FROM organizations src
  WHERE dst.id = p_dst AND src.id = p_src;

  DELETE FROM organizations WHERE id = p_src;

  INSERT INTO canonical_alias_backfill_log (entity_kind, entity_id, current_name, current_slug, canonical_name, canonical_slug, action, note)
  VALUES ('org', p_dst, v_src_name, v_src_slug, v_dst_name, v_dst_slug, 'merge',
          COALESCE(p_note, format('moved eom=%s jobs=%s alias=%s', v_moved_eom, v_moved_jobs, v_moved_alias)));

  UPDATE organizations dst SET
    episode_count = COALESCE((SELECT count(DISTINCT episode_id) FROM episode_organization_map WHERE organization_id = p_dst), 0),
    mention_count = COALESCE((SELECT count(*)               FROM episode_organization_map WHERE organization_id = p_dst), 0),
    primary_count = COALESCE((SELECT count(*)               FROM episode_organization_map WHERE organization_id = p_dst AND role = 'primary'), 0),
    podcast_count = COALESCE((SELECT count(DISTINCT podcast_id) FROM episode_organization_map WHERE organization_id = p_dst), 0),
    updated_at = now()
  WHERE id = p_dst;

  RETURN jsonb_build_object(
    'src', p_src, 'dst', p_dst,
    'src_name', v_src_name, 'dst_name', v_dst_name,
    'moved_eom', v_moved_eom, 'moved_jobs', v_moved_jobs, 'moved_alias', v_moved_alias
  );
END;
$$;