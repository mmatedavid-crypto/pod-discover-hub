-- Source plus the authoritative md5(jsonb::text) hash used by claim/apply.
CREATE OR REPLACE FUNCTION public.person_judge_source_with_hash(_person uuid, _episode uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN s IS NULL THEN NULL ELSE jsonb_build_object('source_hash', md5(s::text), 'input', s) END
  FROM (SELECT public.person_judge_source(_person, _episode) AS s) x
$$;
REVOKE ALL ON FUNCTION public.person_judge_source_with_hash(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_judge_source_with_hash(uuid, uuid) TO service_role;