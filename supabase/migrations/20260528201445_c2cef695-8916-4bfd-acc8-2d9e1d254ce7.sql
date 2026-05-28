CREATE OR REPLACE FUNCTION public.find_existing_podcast(p_rss_url text, p_title text)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_norm_url text;
  v_norm_title text;
  v_id uuid;
BEGIN
  -- 1) Exact RSS URL match
  SELECT id INTO v_id FROM public.podcasts WHERE rss_url = p_rss_url LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  -- 2) Normalized RSS URL match
  BEGIN
    v_norm_url := public.normalize_rss_url(p_rss_url);
  EXCEPTION WHEN OTHERS THEN
    v_norm_url := NULL;
  END;
  IF v_norm_url IS NOT NULL THEN
    SELECT id INTO v_id FROM public.podcasts WHERE rss_url_norm = v_norm_url LIMIT 1;
    IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  END IF;

  -- 3) Normalized title match (HU-only catalog; safe enough as defense-in-depth)
  IF p_title IS NOT NULL AND length(trim(p_title)) >= 4 THEN
    BEGIN
      v_norm_title := public.normalize_podcast_title(p_title);
    EXCEPTION WHEN OTHERS THEN
      v_norm_title := NULL;
    END;
    IF v_norm_title IS NOT NULL AND length(v_norm_title) >= 4 THEN
      SELECT id INTO v_id
      FROM public.podcasts
      WHERE public.normalize_podcast_title(title) = v_norm_title
        AND (language IS NULL OR language ILIKE 'hu%')
      LIMIT 1;
      IF v_id IS NOT NULL THEN RETURN v_id; END IF;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_existing_podcast(text, text) TO service_role, authenticated;