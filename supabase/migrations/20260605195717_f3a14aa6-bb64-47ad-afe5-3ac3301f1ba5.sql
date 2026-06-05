-- 1. Ütközés-napló
CREATE TABLE IF NOT EXISTS public.canonical_alias_backfill_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  entity_kind text NOT NULL,
  entity_id uuid NOT NULL,
  current_name text NOT NULL,
  current_slug text,
  canonical_name text NOT NULL,
  canonical_slug text NOT NULL,
  action text NOT NULL CHECK (action IN ('renamed','collision_skipped','noop')),
  note text
);

GRANT SELECT ON public.canonical_alias_backfill_log TO authenticated;
GRANT ALL ON public.canonical_alias_backfill_log TO service_role;

ALTER TABLE public.canonical_alias_backfill_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "canonical_alias_backfill_log admin read"
  ON public.canonical_alias_backfill_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS canonical_alias_backfill_log_run_idx
  ON public.canonical_alias_backfill_log (run_at DESC, entity_kind);

-- 2. Dry-run riport
CREATE OR REPLACE FUNCTION public.canonical_alias_backfill_dryrun(p_kinds text[] DEFAULT ARRAY['person','organization','topic'])
RETURNS TABLE (
  entity_kind text,
  total_rows bigint,
  would_rename bigint,
  would_collide bigint,
  sample jsonb
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
BEGIN
  FOREACH k IN ARRAY p_kinds LOOP
    IF k = 'person' THEN
      RETURN QUERY
      WITH res AS (
        SELECT p.id, p.name AS current_name, p.slug AS current_slug,
               r.canonical_name, r.canonical_slug
        FROM public.people p
        LEFT JOIN LATERAL public.resolve_canonical_entity_alias('person', p.name) r ON TRUE
        WHERE r.canonical_name IS NOT NULL
          AND r.canonical_name <> p.name
      ),
      tagged AS (
        SELECT r.*,
               EXISTS (
                 SELECT 1 FROM public.people p2
                 WHERE p2.id <> r.id AND lower(p2.name) = lower(r.canonical_name)
               ) AS collides
        FROM res r
      )
      SELECT
        'person'::text,
        (SELECT count(*) FROM public.people),
        (SELECT count(*) FROM tagged WHERE NOT collides),
        (SELECT count(*) FROM tagged WHERE collides),
        COALESCE((SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.current_name) FROM (SELECT * FROM tagged LIMIT 20) t), '[]'::jsonb);

    ELSIF k = 'organization' THEN
      RETURN QUERY
      WITH res AS (
        SELECT o.id, o.name AS current_name, o.slug AS current_slug,
               r.canonical_name, r.canonical_slug
        FROM public.organizations o
        LEFT JOIN LATERAL public.resolve_canonical_entity_alias('organization', o.name) r ON TRUE
        WHERE r.canonical_name IS NOT NULL
          AND r.canonical_name <> o.name
      ),
      tagged AS (
        SELECT r.*,
               EXISTS (
                 SELECT 1 FROM public.organizations o2
                 WHERE o2.id <> r.id AND lower(o2.name) = lower(r.canonical_name)
               ) AS collides
        FROM res r
      )
      SELECT
        'organization'::text,
        (SELECT count(*) FROM public.organizations),
        (SELECT count(*) FROM tagged WHERE NOT collides),
        (SELECT count(*) FROM tagged WHERE collides),
        COALESCE((SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.current_name) FROM (SELECT * FROM tagged LIMIT 20) t), '[]'::jsonb);

    ELSIF k = 'topic' THEN
      RETURN QUERY
      WITH res AS (
        SELECT t.id, t.name AS current_name, t.slug AS current_slug,
               r.canonical_name, r.canonical_slug
        FROM public.topics t
        LEFT JOIN LATERAL public.resolve_canonical_entity_alias('topic', t.name) r ON TRUE
        WHERE r.canonical_name IS NOT NULL
          AND r.canonical_name <> t.name
      ),
      tagged AS (
        SELECT r.*,
               EXISTS (
                 SELECT 1 FROM public.topics t2
                 WHERE t2.id <> r.id AND lower(t2.name) = lower(r.canonical_name)
               ) AS collides
        FROM res r
      )
      SELECT
        'topic'::text,
        (SELECT count(*) FROM public.topics),
        (SELECT count(*) FROM tagged WHERE NOT collides),
        (SELECT count(*) FROM tagged WHERE collides),
        COALESCE((SELECT jsonb_agg(to_jsonb(t.*) ORDER BY t.current_name) FROM (SELECT * FROM tagged LIMIT 20) t), '[]'::jsonb);
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.canonical_alias_backfill_dryrun(text[]) TO authenticated, service_role;

-- 3. Apply (rename, no merge — collisions logged)
CREATE OR REPLACE FUNCTION public.canonical_alias_backfill_apply(
  p_kinds text[] DEFAULT ARRAY['person','organization','topic'],
  p_dry boolean DEFAULT TRUE
)
RETURNS TABLE (
  entity_kind text,
  renamed bigint,
  collisions bigint,
  noop bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
  v_renamed bigint;
  v_collisions bigint;
BEGIN
  FOREACH k IN ARRAY p_kinds LOOP
    v_renamed := 0;
    v_collisions := 0;

    IF k = 'person' THEN
      WITH res AS (
        SELECT p.id, p.name AS current_name, p.slug AS current_slug,
               r.canonical_name, r.canonical_slug
        FROM public.people p
        JOIN LATERAL public.resolve_canonical_entity_alias('person', p.name) r ON TRUE
        WHERE r.canonical_name <> p.name
      ),
      tagged AS (
        SELECT r.*,
               EXISTS (SELECT 1 FROM public.people p2 WHERE p2.id <> r.id AND lower(p2.name) = lower(r.canonical_name)) AS collides
        FROM res r
      ),
      log_rows AS (
        INSERT INTO public.canonical_alias_backfill_log
          (entity_kind, entity_id, current_name, current_slug, canonical_name, canonical_slug, action, note)
        SELECT 'person', t.id, t.current_name, t.current_slug, t.canonical_name, t.canonical_slug,
               CASE WHEN p_dry THEN 'noop'
                    WHEN t.collides THEN 'collision_skipped'
                    ELSE 'renamed' END,
               CASE WHEN p_dry THEN 'dry_run' ELSE NULL END
        FROM tagged t
        RETURNING action
      ),
      upd AS (
        UPDATE public.people p
        SET name = t.canonical_name, updated_at = now()
        FROM tagged t
        WHERE p.id = t.id AND NOT t.collides AND NOT p_dry
        RETURNING 1
      )
      SELECT
        (SELECT count(*) FROM upd),
        (SELECT count(*) FROM tagged WHERE collides)
      INTO v_renamed, v_collisions;

      RETURN QUERY SELECT 'person'::text, v_renamed, v_collisions, 0::bigint;

    ELSIF k = 'organization' THEN
      WITH res AS (
        SELECT o.id, o.name AS current_name, o.slug AS current_slug,
               r.canonical_name, r.canonical_slug
        FROM public.organizations o
        JOIN LATERAL public.resolve_canonical_entity_alias('organization', o.name) r ON TRUE
        WHERE r.canonical_name <> o.name
      ),
      tagged AS (
        SELECT r.*,
               EXISTS (SELECT 1 FROM public.organizations o2 WHERE o2.id <> r.id AND lower(o2.name) = lower(r.canonical_name)) AS collides
        FROM res r
      ),
      log_rows AS (
        INSERT INTO public.canonical_alias_backfill_log
          (entity_kind, entity_id, current_name, current_slug, canonical_name, canonical_slug, action, note)
        SELECT 'organization', t.id, t.current_name, t.current_slug, t.canonical_name, t.canonical_slug,
               CASE WHEN p_dry THEN 'noop'
                    WHEN t.collides THEN 'collision_skipped'
                    ELSE 'renamed' END,
               CASE WHEN p_dry THEN 'dry_run' ELSE NULL END
        FROM tagged t
        RETURNING action
      ),
      upd AS (
        UPDATE public.organizations o
        SET name = t.canonical_name, updated_at = now()
        FROM tagged t
        WHERE o.id = t.id AND NOT t.collides AND NOT p_dry
        RETURNING 1
      )
      SELECT
        (SELECT count(*) FROM upd),
        (SELECT count(*) FROM tagged WHERE collides)
      INTO v_renamed, v_collisions;

      RETURN QUERY SELECT 'organization'::text, v_renamed, v_collisions, 0::bigint;

    ELSIF k = 'topic' THEN
      WITH res AS (
        SELECT t.id, t.name AS current_name, t.slug AS current_slug,
               r.canonical_name, r.canonical_slug
        FROM public.topics t
        JOIN LATERAL public.resolve_canonical_entity_alias('topic', t.name) r ON TRUE
        WHERE r.canonical_name <> t.name
      ),
      tagged AS (
        SELECT r.*,
               EXISTS (SELECT 1 FROM public.topics t2 WHERE t2.id <> r.id AND lower(t2.name) = lower(r.canonical_name)) AS collides
        FROM res r
      ),
      log_rows AS (
        INSERT INTO public.canonical_alias_backfill_log
          (entity_kind, entity_id, current_name, current_slug, canonical_name, canonical_slug, action, note)
        SELECT 'topic', t.id, t.current_name, t.current_slug, t.canonical_name, t.canonical_slug,
               CASE WHEN p_dry THEN 'noop'
                    WHEN t.collides THEN 'collision_skipped'
                    ELSE 'renamed' END,
               CASE WHEN p_dry THEN 'dry_run' ELSE NULL END
        FROM tagged t
        RETURNING action
      ),
      upd AS (
        UPDATE public.topics tp
        SET name = t.canonical_name, updated_at = now()
        FROM tagged t
        WHERE tp.id = t.id AND NOT t.collides AND NOT p_dry
        RETURNING 1
      )
      SELECT
        (SELECT count(*) FROM upd),
        (SELECT count(*) FROM tagged WHERE collides)
      INTO v_renamed, v_collisions;

      RETURN QUERY SELECT 'topic'::text, v_renamed, v_collisions, 0::bigint;
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.canonical_alias_backfill_apply(text[], boolean) TO service_role;