-- Platform / mail providers are never publishers (Zencastr, Proton, LinkedIn…).
CREATE OR REPLACE FUNCTION public.refresh_podcast_publishers_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' SET statement_timeout TO '60s' AS $$
DECLARE
  v_platforms text[] := ARRAY['anchor','spotify','spotifyforpodcasters','podcasters','soundcloud','apple','podcasts','rss','omnycontent','omny','buzzsprout','libsyn','podbean','spreaker','simplecast','megaphone','transistor','captivate','acast','youtube','youtu','facebook','instagram','tiktok','twitter','x','linktr','linktree','gmail','googlemail','freemail','citromail','yahoo','hotmail','outlook','icloud','me','live','t-online','google','blogspot','wordpress','substack','patreon','twitch','mixcloud','podigee','redcircle','audioboom','pinecast','castos','fireside','feedburner','feedpress','ivoox','podomatic','wix','wixsite','squarespace','weebly','github','gitlab','podcast','podcastok','inda','mailchimp','riverside','zencast','podhero','castbox','pocketcasts','deezer','amazon','audible','iheart','tunein','player','hearthis','archive','vimeo','rumble','telegram','discord','medium','notion','canva','webnode','blog','site','studio','media','radio','tv','fm','hu','com','info','online','mail','zencastr','protonmail','proton','pm','linkedin','tuta','tutanota','gmx','aol','msn','zoho','posteo','startmail','mailbox','fastmail','skype','whatsapp','threads','bsky','mastodon','squadcast','podpage','buymeacoffee','ko-fi','paypal','revolut','stripe','gumroad','shopify'];
  v_upserted int := 0; v_removed int := 0;
BEGIN
  DROP TABLE IF EXISTS _pp_new;
  CREATE TEMP TABLE _pp_new ON COMMIT DROP AS
  WITH pods AS (
    SELECT p.id, p.title, p.display_title, p.website_url, p.description,
           m.author, m.owner_name, m.owner_email_domain, m.copyright, m.channel_link,
           public.org_name_key_v1(p.title) AS t1, public.org_name_key_v1(p.display_title) AS t2
      FROM public.podcasts p LEFT JOIN public.podcast_channel_meta m ON m.podcast_id = p.id
     WHERE p.language_decision = 'accept_hungarian'
  ), keys AS (
    SELECT id AS pid, t1, t2, k.key, k.src, k.strength, k.is_domain FROM pods,
    LATERAL (VALUES
      (public.org_name_key_v1(author), 'rss_author', 3.0, false),
      (public.publisher_name_key_v1(author), 'rss_author', 3.0, false),
      (public.org_name_key_v1(owner_name), 'rss_owner', 3.0, false),
      (public.publisher_name_key_v1(owner_name), 'rss_owner', 3.0, false),
      (public.publisher_name_key_v1(regexp_replace(coalesce(copyright, ''), '[a-z0-9-]+\.(hu|com|net|org|eu)\M', ' ', 'gi')), 'rss_copyright', 3.0, false),
      (public.publisher_domain_label_v1(owner_email_domain), 'owner_email_domain', 2.5, true),
      (public.publisher_domain_label_v1(website_url), 'website', 2.5, true),
      (public.publisher_domain_label_v1(channel_link), 'channel_link', 2.5, true)
    ) AS k(key, src, strength, is_domain)
    UNION ALL
    SELECT id, t1, t2, public.org_name_key_v1(seg), 'title_segment', 2.0, false
      FROM pods, LATERAL regexp_split_to_table(coalesce(title, ''), '\s*\|\s*|\s+[–—-]\s+') AS seg
     WHERE coalesce(title, '') ~ '\s*\|\s*|\s+[–—-]\s+'
    UNION ALL
    SELECT id, t1, t2, public.publisher_domain_label_v1(mm[1]), 'description_email', 1.5, true
      FROM pods, LATERAL regexp_matches(coalesce(description, ''), '[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})', 'g') AS mm
  ), k2 AS (
    SELECT * FROM keys WHERE key IS NOT NULL AND length(key) >= 2 AND NOT (key = ANY (v_platforms))
  ), cand AS (
    SELECT COALESCE(o.ai_duplicate_of_organization_id, o.id) AS org_id, o.normalized_name AS key
      FROM public.organizations o WHERE o.normalized_name IS NOT NULL AND o.normalized_name NOT LIKE 'merged %'
    UNION
    SELECT COALESCE(o.ai_duplicate_of_organization_id, o.id), a.normalized_alias
      FROM public.organization_aliases a JOIN public.organizations o ON o.id = a.organization_id
     WHERE a.status IN ('accepted','verified')
  ), cand_ok AS (
    SELECT c.org_id, c.key, replace(c.key, ' ', '') AS key_ns, o.org_type, o.normalized_name AS org_key
      FROM cand c JOIN public.organizations o ON o.id = c.org_id
     WHERE o.org_type <> 'other' AND o.quality_hold_at IS NULL
       AND o.ai_duplicate_of_organization_id IS NULL
       AND COALESCE(o.ai_recommended_action, '') NOT IN ('hide','reject')
  ), matches AS (
    SELECT k2.pid, c.org_id, k2.src, k2.key, k2.strength, k2.t1, k2.t2, c.org_type, c.org_key
      FROM k2 JOIN cand_ok c ON c.key = k2.key
    UNION
    SELECT k2.pid, c.org_id, k2.src, k2.key, k2.strength, k2.t1, k2.t2, c.org_type, c.org_key
      FROM k2 JOIN cand_ok c ON k2.is_domain AND c.key_ns = k2.key
  ), scored AS (
    SELECT pid, org_id, src, key,
           CASE WHEN org_key = t1 OR org_key = t2 THEN 1.0 ELSE strength END AS s
      FROM matches
     WHERE src <> 'description_email' OR org_type IN ('media','radio_station')
  ), agg AS (
    SELECT pid, org_id, max(s) AS s, array_agg(DISTINCT src ORDER BY src) AS srcs,
           jsonb_agg(DISTINCT jsonb_build_object('source', src, 'key', key)) AS ev
      FROM scored GROUP BY pid, org_id
  ), ranked AS (
    SELECT *, max(s) OVER (PARTITION BY pid) AS top,
           count(*) OVER (PARTITION BY pid, s) AS n_at_s
      FROM agg
  )
  SELECT pid AS podcast_id, org_id AS organization_id,
         CASE WHEN n_at_s > 1 THEN 'ambiguous' ELSE 'accepted' END AS status,
         s AS strength, srcs AS sources, ev AS evidence
    FROM ranked WHERE s = top;

  WITH up AS (
    INSERT INTO public.podcast_publishers AS pp (podcast_id, organization_id, status, strength, sources, evidence)
    SELECT podcast_id, organization_id, status, strength, sources, evidence FROM _pp_new
    ON CONFLICT (podcast_id, organization_id) DO UPDATE
      SET status = EXCLUDED.status, strength = EXCLUDED.strength, sources = EXCLUDED.sources,
          evidence = EXCLUDED.evidence, updated_at = now()
      WHERE pp.status NOT LIKE 'manual%'
        AND (pp.status, pp.strength, pp.sources, pp.evidence) IS DISTINCT FROM (EXCLUDED.status, EXCLUDED.strength, EXCLUDED.sources, EXCLUDED.evidence)
    RETURNING 1)
  SELECT count(*) INTO v_upserted FROM up;

  WITH del AS (
    DELETE FROM public.podcast_publishers pp
     WHERE pp.status IN ('accepted','ambiguous')
       AND NOT EXISTS (SELECT 1 FROM _pp_new n WHERE n.podcast_id = pp.podcast_id AND n.organization_id = pp.organization_id)
    RETURNING 1)
  SELECT count(*) INTO v_removed FROM del;

  DROP TABLE IF EXISTS _pp_new;
  RETURN jsonb_build_object('upserted', v_upserted, 'removed', v_removed,
    'accepted', (SELECT count(*) FROM public.podcast_publishers WHERE status IN ('accepted','manual_accepted')),
    'ambiguous', (SELECT count(*) FROM public.podcast_publishers WHERE status = 'ambiguous'));
END;
$$;
REVOKE ALL ON FUNCTION public.refresh_podcast_publishers_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_podcast_publishers_v1() TO service_role;