-- Deterministic podcast category guard v2.
-- Fixes obvious religious publisher/channel identities that AI can misclassify
-- as broad Society & Culture, without reclassifying political/culture episodes
-- that merely mention "Isten" in a title.

WITH candidates AS (
  SELECT
    p.id,
    p.category AS old_category,
    lower(unaccent(concat_ws(' ', p.title, p.display_title, p.slug, p.website_url, p.rss_url))) AS titleish,
    lower(unaccent(coalesce(p.description, ''))) AS description_text
  FROM public.podcasts p
  WHERE (p.is_hungarian = true OR p.language_decision = 'accept_hungarian')
    AND COALESCE(p.rss_status, '') NOT IN ('failed', 'inactive', 'deleted', 'blocked', 'dead')
    AND COALESCE(p.category, '') <> 'Religion & Spirituality'
),
religious_candidates AS (
  SELECT
    id,
    old_category,
    CASE
      WHEN titleish ~ '\m(zarandok|maria ut|golgota|gyulekezet|baptista|adventista|katolikus|reformatus|evangelikus|istentisztelet|predikacio|igehirdetes|biblia|ahitat|evangelium|teologia|plebania|templom|lelki gyakorlat|lelkigyakorlat|hit gyulekezete|kereszteny)\M'
        THEN 'strong_religion_title_or_url_signal'
      WHEN description_text ~ '\m(zarandok|maria ut|golgota|gyulekezet|baptista|adventista|katolikus|reformatus|evangelikus|istentisztelet|predikacio|igehirdetes|biblia|ahitat|evangelium|teologia|plebania|templom|lelki gyakorlat|lelkigyakorlat|hit gyulekezete|kereszteny)\M'
        AND description_text ~ '\m(vallas|hit|isten|ima|imadsag|lelki|szentiras|pap|puspok|atya|jezus|krisztus|egyhazi|egyhaz)\M'
        AND titleish !~ '\m(isten[, ]+orban|orban|politika|valasztas|reszveny|tozsde|befektetes|milliardos|film|zene|etterem|bor|kave|gasztro)\M'
        THEN 'multiple_religion_description_signals'
      ELSE NULL
    END AS reason
  FROM candidates
),
updated AS (
  UPDATE public.podcasts p
  SET category = 'Religion & Spirituality',
      ai_category_alt = COALESCE(p.ai_category_alt, rc.old_category),
      ai_category_confidence = GREATEST(COALESCE(p.ai_category_confidence, 0), 0.88),
      ai_category_needs_review = false,
      ai_category_model = 'deterministic-category-guard-v2',
      ai_category_at = now(),
      shadow_rank_components = COALESCE(p.shadow_rank_components, '{}'::jsonb)
        || jsonb_build_object(
          'category_repair',
          jsonb_build_object(
            'version', 'deterministic_category_guard_v2',
            'old_category', rc.old_category,
            'reason', rc.reason
          )
        )
  FROM religious_candidates rc
  WHERE p.id = rc.id
    AND rc.reason IS NOT NULL
  RETURNING p.id
)
INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'podcast_category_guard_policy',
  jsonb_build_object(
    'version', 2,
    'religion_rule', 'Strong channel/publisher identity signals force Religion & Spirituality before/after AI categorization; weak single-title references do not.',
    'updated_rows', (SELECT count(*) FROM updated),
    'examples', jsonb_build_array('Zarándok.ma', 'A Mária Út Podcast csatornája', 'Baptista Egyházi Szociális Módszertan'),
    'updated_at', now()
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();
