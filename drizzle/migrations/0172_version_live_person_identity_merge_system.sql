-- Triggers are created only when missing (no lock on the live tables).
-- Versions, verbatim from the live database (pg_get_functiondef / catalog, 2026-11-14 23:30 UTC), the person identity
-- merge system, Hungarian name-variant rules and the owner's credit-policy correction that another session applied
-- directly. Idempotent: CREATE IF NOT EXISTS / guarded constraints / CREATE OR REPLACE / triggers created only when missing. No data changes.

-- person_identity_repair_runs
CREATE TABLE IF NOT EXISTS public.person_identity_repair_runs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  version text NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  summary jsonb DEFAULT '{}'::jsonb NOT NULL
);
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_repair_runs_pkey' AND conrelid='public.person_identity_repair_runs'::regclass) THEN ALTER TABLE public.person_identity_repair_runs ADD CONSTRAINT person_identity_repair_runs_pkey PRIMARY KEY (id); END IF; END $c$;

ALTER TABLE public.person_identity_repair_runs ENABLE ROW LEVEL SECURITY;
-- no policies

-- person_identity_merge_rules
CREATE TABLE IF NOT EXISTS public.person_identity_merge_rules (
  source_person_id uuid NOT NULL,
  canonical_person_id uuid NOT NULL,
  evidence text NOT NULL,
  version text DEFAULT 'verified_identity_merge_v1'::text NOT NULL,
  run_id uuid NOT NULL,
  active boolean DEFAULT true NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_merge_rules_pkey' AND conrelid='public.person_identity_merge_rules'::regclass) THEN ALTER TABLE public.person_identity_merge_rules ADD CONSTRAINT person_identity_merge_rules_pkey PRIMARY KEY (source_person_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_merge_rules_check' AND conrelid='public.person_identity_merge_rules'::regclass) THEN ALTER TABLE public.person_identity_merge_rules ADD CONSTRAINT person_identity_merge_rules_check CHECK ((source_person_id <> canonical_person_id)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_merge_rules_canonical_person_id_fkey' AND conrelid='public.person_identity_merge_rules'::regclass) THEN ALTER TABLE public.person_identity_merge_rules ADD CONSTRAINT person_identity_merge_rules_canonical_person_id_fkey FOREIGN KEY (canonical_person_id) REFERENCES people(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_merge_rules_run_id_fkey' AND conrelid='public.person_identity_merge_rules'::regclass) THEN ALTER TABLE public.person_identity_merge_rules ADD CONSTRAINT person_identity_merge_rules_run_id_fkey FOREIGN KEY (run_id) REFERENCES person_identity_repair_runs(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_merge_rules_source_person_id_fkey' AND conrelid='public.person_identity_merge_rules'::regclass) THEN ALTER TABLE public.person_identity_merge_rules ADD CONSTRAINT person_identity_merge_rules_source_person_id_fkey FOREIGN KEY (source_person_id) REFERENCES people(id); END IF; END $c$;
CREATE INDEX IF NOT EXISTS person_identity_merge_rules_target ON public.person_identity_merge_rules USING btree (canonical_person_id) WHERE active;
ALTER TABLE public.person_identity_merge_rules ENABLE ROW LEVEL SECURITY;
-- no policies

-- person_identity_separation_rules
CREATE TABLE IF NOT EXISTS public.person_identity_separation_rules (
  person_id uuid NOT NULL,
  other_person_id uuid NOT NULL,
  reason text NOT NULL,
  run_id uuid NOT NULL
);
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_separation_rules_pkey' AND conrelid='public.person_identity_separation_rules'::regclass) THEN ALTER TABLE public.person_identity_separation_rules ADD CONSTRAINT person_identity_separation_rules_pkey PRIMARY KEY (person_id, other_person_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_separation_rules_check' AND conrelid='public.person_identity_separation_rules'::regclass) THEN ALTER TABLE public.person_identity_separation_rules ADD CONSTRAINT person_identity_separation_rules_check CHECK ((person_id <> other_person_id)); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_separation_rules_other_person_id_fkey' AND conrelid='public.person_identity_separation_rules'::regclass) THEN ALTER TABLE public.person_identity_separation_rules ADD CONSTRAINT person_identity_separation_rules_other_person_id_fkey FOREIGN KEY (other_person_id) REFERENCES people(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_separation_rules_person_id_fkey' AND conrelid='public.person_identity_separation_rules'::regclass) THEN ALTER TABLE public.person_identity_separation_rules ADD CONSTRAINT person_identity_separation_rules_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_separation_rules_run_id_fkey' AND conrelid='public.person_identity_separation_rules'::regclass) THEN ALTER TABLE public.person_identity_separation_rules ADD CONSTRAINT person_identity_separation_rules_run_id_fkey FOREIGN KEY (run_id) REFERENCES person_identity_repair_runs(id); END IF; END $c$;

ALTER TABLE public.person_identity_separation_rules ENABLE ROW LEVEL SECURITY;
-- no policies

-- person_identity_repair_backup
CREATE TABLE IF NOT EXISTS public.person_identity_repair_backup (
  id bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
  run_id uuid NOT NULL,
  table_name text NOT NULL,
  row_data jsonb NOT NULL
);
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_repair_backup_pkey' AND conrelid='public.person_identity_repair_backup'::regclass) THEN ALTER TABLE public.person_identity_repair_backup ADD CONSTRAINT person_identity_repair_backup_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_repair_backup_run_id_fkey' AND conrelid='public.person_identity_repair_backup'::regclass) THEN ALTER TABLE public.person_identity_repair_backup ADD CONSTRAINT person_identity_repair_backup_run_id_fkey FOREIGN KEY (run_id) REFERENCES person_identity_repair_runs(id); END IF; END $c$;
CREATE INDEX IF NOT EXISTS person_identity_repair_backup_run ON public.person_identity_repair_backup USING btree (run_id, table_name);
ALTER TABLE public.person_identity_repair_backup ENABLE ROW LEVEL SECURITY;
-- no policies

-- person_identity_repair_events
CREATE TABLE IF NOT EXISTS public.person_identity_repair_events (
  id bigint NOT NULL GENERATED ALWAYS AS IDENTITY,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  kind text NOT NULL,
  source_person_id uuid,
  canonical_person_id uuid,
  table_name text,
  incoming jsonb,
  retained jsonb
);
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_identity_repair_events_pkey' AND conrelid='public.person_identity_repair_events'::regclass) THEN ALTER TABLE public.person_identity_repair_events ADD CONSTRAINT person_identity_repair_events_pkey PRIMARY KEY (id); END IF; END $c$;

ALTER TABLE public.person_identity_repair_events ENABLE ROW LEVEL SECURITY;
-- no policies

-- person_name_variant_rules
CREATE TABLE IF NOT EXISTS public.person_name_variant_rules (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  person_id uuid NOT NULL,
  base_name text NOT NULL,
  scope text NOT NULL,
  evidence text NOT NULL,
  active boolean DEFAULT true NOT NULL,
  run_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL
);
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_name_variant_rules_pkey' AND conrelid='public.person_name_variant_rules'::regclass) THEN ALTER TABLE public.person_name_variant_rules ADD CONSTRAINT person_name_variant_rules_pkey PRIMARY KEY (id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_name_variant_rules_person_id_base_name_key' AND conrelid='public.person_name_variant_rules'::regclass) THEN ALTER TABLE public.person_name_variant_rules ADD CONSTRAINT person_name_variant_rules_person_id_base_name_key UNIQUE (person_id, base_name); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_name_variant_rules_scope_check' AND conrelid='public.person_name_variant_rules'::regclass) THEN ALTER TABLE public.person_name_variant_rules ADD CONSTRAINT person_name_variant_rules_scope_check CHECK ((scope = ANY (ARRAY['global'::text, 'context'::text]))); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_name_variant_rules_person_id_fkey' AND conrelid='public.person_name_variant_rules'::regclass) THEN ALTER TABLE public.person_name_variant_rules ADD CONSTRAINT person_name_variant_rules_person_id_fkey FOREIGN KEY (person_id) REFERENCES people(id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_name_variant_rules_run_id_fkey' AND conrelid='public.person_name_variant_rules'::regclass) THEN ALTER TABLE public.person_name_variant_rules ADD CONSTRAINT person_name_variant_rules_run_id_fkey FOREIGN KEY (run_id) REFERENCES person_identity_repair_runs(id); END IF; END $c$;

ALTER TABLE public.person_name_variant_rules ENABLE ROW LEVEL SECURITY;
-- no policies

-- person_name_variant_forms
CREATE TABLE IF NOT EXISTS public.person_name_variant_forms (
  rule_id uuid NOT NULL,
  normalized_form text NOT NULL
);
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_name_variant_forms_pkey' AND conrelid='public.person_name_variant_forms'::regclass) THEN ALTER TABLE public.person_name_variant_forms ADD CONSTRAINT person_name_variant_forms_pkey PRIMARY KEY (rule_id, normalized_form); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_name_variant_forms_rule_id_fkey' AND conrelid='public.person_name_variant_forms'::regclass) THEN ALTER TABLE public.person_name_variant_forms ADD CONSTRAINT person_name_variant_forms_rule_id_fkey FOREIGN KEY (rule_id) REFERENCES person_name_variant_rules(id) ON DELETE CASCADE; END IF; END $c$;
CREATE INDEX IF NOT EXISTS person_name_variant_forms_lookup ON public.person_name_variant_forms USING btree (normalized_form);
ALTER TABLE public.person_name_variant_forms ENABLE ROW LEVEL SECURITY;
-- no policies

-- person_credit_policy_repairs
CREATE TABLE IF NOT EXISTS public.person_credit_policy_repairs (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  completed_at timestamp with time zone,
  reason text NOT NULL,
  before_rules jsonb NOT NULL,
  before_functions jsonb NOT NULL,
  summary jsonb DEFAULT '{}'::jsonb NOT NULL
);
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_credit_policy_repairs_pkey' AND conrelid='public.person_credit_policy_repairs'::regclass) THEN ALTER TABLE public.person_credit_policy_repairs ADD CONSTRAINT person_credit_policy_repairs_pkey PRIMARY KEY (id); END IF; END $c$;

ALTER TABLE public.person_credit_policy_repairs ENABLE ROW LEVEL SECURITY;
-- no policies

-- person_name_matching_revisions
CREATE TABLE IF NOT EXISTS public.person_name_matching_revisions (
  run_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  previous_definitions jsonb NOT NULL,
  summary jsonb DEFAULT '{}'::jsonb NOT NULL
);
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_name_matching_revisions_pkey' AND conrelid='public.person_name_matching_revisions'::regclass) THEN ALTER TABLE public.person_name_matching_revisions ADD CONSTRAINT person_name_matching_revisions_pkey PRIMARY KEY (run_id); END IF; END $c$;
DO $c$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='person_name_matching_revisions_run_id_fkey' AND conrelid='public.person_name_matching_revisions'::regclass) THEN ALTER TABLE public.person_name_matching_revisions ADD CONSTRAINT person_name_matching_revisions_run_id_fkey FOREIGN KEY (run_id) REFERENCES person_identity_repair_runs(id); END IF; END $c$;

ALTER TABLE public.person_name_matching_revisions ENABLE ROW LEVEL SECURITY;
-- no policies

-- Access: service-role only (no policies => locked for clients); readonly_codex may read audit/rule tables.
REVOKE ALL ON public.person_identity_repair_runs FROM anon, authenticated;
GRANT ALL ON public.person_identity_repair_runs TO service_role;
REVOKE ALL ON public.person_identity_merge_rules FROM anon, authenticated;
GRANT ALL ON public.person_identity_merge_rules TO service_role;
REVOKE ALL ON public.person_identity_separation_rules FROM anon, authenticated;
GRANT ALL ON public.person_identity_separation_rules TO service_role;
REVOKE ALL ON public.person_identity_repair_backup FROM anon, authenticated;
GRANT ALL ON public.person_identity_repair_backup TO service_role;
REVOKE ALL ON public.person_identity_repair_events FROM anon, authenticated;
GRANT ALL ON public.person_identity_repair_events TO service_role;
REVOKE ALL ON public.person_name_variant_rules FROM anon, authenticated;
GRANT ALL ON public.person_name_variant_rules TO service_role;
REVOKE ALL ON public.person_name_variant_forms FROM anon, authenticated;
GRANT ALL ON public.person_name_variant_forms TO service_role;
REVOKE ALL ON public.person_credit_policy_repairs FROM anon, authenticated;
GRANT ALL ON public.person_credit_policy_repairs TO service_role;
REVOKE ALL ON public.person_name_matching_revisions FROM anon, authenticated;
GRANT ALL ON public.person_name_matching_revisions TO service_role;
DO $g$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='readonly_codex') THEN
  GRANT SELECT ON public.person_identity_repair_runs TO readonly_codex;
  GRANT SELECT ON public.person_identity_merge_rules TO readonly_codex;
  GRANT SELECT ON public.person_identity_separation_rules TO readonly_codex;
  GRANT SELECT ON public.person_identity_repair_backup TO readonly_codex;
  GRANT SELECT ON public.person_identity_repair_events TO readonly_codex;
  GRANT SELECT ON public.person_name_variant_rules TO readonly_codex;
  GRANT SELECT ON public.person_name_variant_forms TO readonly_codex;
  GRANT SELECT ON public.person_credit_policy_repairs TO readonly_codex;
  GRANT SELECT ON public.person_name_matching_revisions TO readonly_codex;
END IF; END $g$;

CREATE OR REPLACE FUNCTION public.person_name_forms_hu_v1(_name text)
 RETURNS TABLE(form text)
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE f text:=public.person_text_fold_v1(_name); vals text[]; s text; ending text; sound text; doubled text; root text;
BEGIN
 IF length(f)<3 OR f !~ '[a-z]' THEN RETURN; END IF;
 vals:=ARRAY[f];
 FOREACH s IN ARRAY ARRAY['t','ot','et','at','nak','nek','hoz','hez','ban','ben','ba','be','ra','re','rol','bol','tol','nal','nel','ert','ig','kent','n','on','en'] LOOP
  IF right(f,2) IN('bb','cc','dd','ff','gg','hh','jj','kk','ll','mm','nn','pp','rr','ss','tt','vv','zz') AND left(s,1)=right(f,1) THEN
   vals:=array_append(vals,f||'-'||s);
  ELSE vals:=array_append(vals,f||s); END IF;
 END LOOP;
 IF f ~ '[aeiouy]$' AND f !~ '(gy|ly|ny|ty)$' THEN
  vals:=vals||ARRAY[f||'val',f||'vel'];
 ELSE
  SELECT v.e,v.s INTO ending,sound FROM (VALUES('ddzs','dzs'),('ccs','cs'),('ddz','dz'),('ggy','gy'),('lly','ly'),('nny','ny'),('ssz','sz'),('tty','ty'),('zzs','zs'),
   ('bb','b'),('cc','c'),('dd','d'),('ff','f'),('gg','g'),('hh','h'),('jj','j'),('kk','k'),('ll','l'),('mm','m'),('nn','n'),('pp','p'),('rr','r'),('ss','s'),('tt','t'),('vv','v'),('zz','z'))v(e,s)
   WHERE right(f,length(v.e))=v.e ORDER BY length(v.e) DESC LIMIT 1;
  IF ending IS NOT NULL THEN
   vals:=vals||ARRAY[f||'-'||sound||'al',f||'-'||sound||'el'];
  ELSE
   SELECT v.e,v.s INTO ending,sound FROM (VALUES('th','t'),('gh','g'),('ch','cs'),('cz','c'),('tz','c'),('ts','cs'),('x','sz'))v(e,s)
   WHERE right(f,length(v.e))=v.e ORDER BY length(v.e) DESC LIMIT 1;
   IF ending IS NOT NULL THEN vals:=vals||ARRAY[f||sound||'al',f||sound||'el'];
   ELSE
    SELECT v.e,v.d INTO ending,doubled FROM (VALUES('dzs','ddzs'),('cs','ccs'),('dz','ddz'),('gy','ggy'),('ly','lly'),('ny','nny'),('sz','ssz'),('ty','tty'),('zs','zzs'))v(e,d)
    WHERE right(f,length(v.e))=v.e ORDER BY length(v.e) DESC LIMIT 1;
    IF ending IS NOT NULL THEN root:=left(f,length(f)-length(ending))||doubled;
    ELSE root:=f||right(f,1); END IF;
    vals:=vals||ARRAY[root||'al',root||'el'];
   END IF;
  END IF;
 END IF;
 RETURN QUERY SELECT DISTINCT x FROM unnest(vals)x ORDER BY x;
END $function$
;

CREATE OR REPLACE FUNCTION public.person_name_in_text_hu_v1(_name text, _text text, _allow_single boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT CASE WHEN _text IS NULL OR length(public.person_text_fold_v1(_name))<3
  OR (NOT _allow_single AND position(' ' IN public.person_text_fold_v1(_name))=0) THEN false
 ELSE public.person_text_fold_v1(_text) ~ (
 '(^|[^a-z0-9])('||(SELECT string_agg(regexp_replace(regexp_replace(form,'([.^$*+?()\[\]{}|\\])','\\\1','g'),'\s+','\\s+','g'),'|')
 FROM public.person_name_forms_hu_v1(_name))||')($|[^a-z0-9])') END
$function$
;

CREATE OR REPLACE FUNCTION public.person_canonical_identity_id_v1(p_id uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT COALESCE((SELECT canonical_person_id FROM person_identity_merge_rules WHERE source_person_id=p_id AND active),p_id)
$function$
;

CREATE OR REPLACE FUNCTION public.person_name_variant_context_ok_v1(_person uuid, _episode uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT EXISTS(
  SELECT 1 FROM people p JOIN episodes e ON e.id=_episode JOIN podcasts po ON po.id=e.podcast_id
  WHERE p.id=_person AND (
    public.person_name_in_text_hu_v1(p.name,concat_ws(' ',e.title,e.description),false)
    OR (
      (public.match_person_host_rule_v1(_person,_episode) IS NOT NULL
       OR public.person_name_in_text_hu_v1(p.name,po.title,false)
       OR public.person_name_in_text_hu_v1(p.name,po.description,false))
      AND NOT EXISTS(SELECT 1 FROM people o WHERE o.id<>p.id AND o.identity_status IS DISTINCT FROM 'merged_into'
       AND split_part(public.person_text_fold_v1(o.name),' ',1)=split_part(public.person_text_fold_v1(p.name),' ',1)
       AND public.person_name_in_text_hu_v1(o.name,concat_ws(' ',e.title,e.description),false))
    )
  )
 )
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_person_name_variant_v1(_name text, _episode uuid DEFAULT NULL::uuid)
 RETURNS TABLE(person_id uuid, canonical_name text, canonical_slug text, match_scope text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 WITH c AS(
 SELECT DISTINCT p.id,p.name,p.slug,r.scope FROM person_name_variant_forms f JOIN person_name_variant_rules r ON r.id=f.rule_id
 JOIN people p ON p.id=r.person_id WHERE f.normalized_form=public.person_text_fold_v1(_name) AND r.active
 AND p.identity_status IS DISTINCT FROM 'merged_into' AND (r.scope='global' OR public.person_name_variant_context_ok_v1(p.id,_episode))
 )
 SELECT id,name,slug,scope FROM c WHERE (SELECT count(DISTINCT id) FROM c)=1 ORDER BY scope DESC LIMIT 1
$function$
;

CREATE OR REPLACE FUNCTION public.person_context_alias_in_text_v1(_person uuid, _text text, _episode uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT EXISTS(SELECT 1 FROM person_name_variant_rules r WHERE r.person_id=_person AND r.active
 AND public.person_name_in_text_hu_v1(r.base_name,_text,r.scope='context')
 AND (r.scope='global' OR public.person_name_variant_context_ok_v1(_person,_episode)))
$function$
;

CREATE OR REPLACE FUNCTION public.apply_person_role_label_v1(_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '120s'
AS $function$
DECLARE it jsonb; res jsonb := '[]'::jsonb; pid uuid; eid uuid; e record; pe record; blk text; anc jsonb; fld text; ftxt text;
  q text; fq text; nm text; role text; sh text; aliases text[]; page text; snip text; total_eps integer; rep integer; descr text;
  mrow record; mid uuid; inserted boolean; busy boolean; aud bigint; ev jsonb; before jsonb; dbefore jsonb;
BEGIN
  FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(_items, '[]'::jsonb)) LOOP
    anc := NULL; rep := NULL; total_eps := NULL; page := NULL;
    pid := (it->>'person_id')::uuid; eid := (it->>'episode_id')::uuid;
    role := it->>'role'; fld := it->>'field'; q := it->>'quote'; nm := it->>'matched_name'; snip := it->>'snippet';
    descr := COALESCE(it->>'descriptor', '');
    SELECT * INTO e FROM episodes WHERE id = eid;
    SELECT * INTO pe FROM people WHERE id = pid;
    IF e.id IS NULL OR pe.id IS NULL OR role NOT IN ('guest','host') OR fld NOT IN ('episode_title','episode_description','episode_page')
       OR COALESCE(q,'') = '' OR COALESCE(nm,'') = '' OR COALESCE(snip,'') = '' THEN
      res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'invalid_item'); CONTINUE;
    END IF;
    PERFORM pg_advisory_xact_lock(hashtext('person_pair:' || pid::text || ':' || eid::text));
    busy := false;
    BEGIN
      PERFORM 1 FROM person_pair_dispositions d WHERE d.person_id = pid AND d.episode_id = eid FOR UPDATE NOWAIT;
      PERFORM 1 FROM person_episode_mentions m WHERE m.person_id = pid AND m.episode_id = eid FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN busy := true;
    END;
    IF busy THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'busy_retry'); CONTINUE; END IF;
    blk := public.person_role_label_block_v1(pid, eid);
    IF blk IS NOT NULL THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'blocked_' || blk); CONTINUE; END IF;
    aliases := ARRAY(SELECT a.alias FROM person_aliases a WHERE a.person_id = pid AND a.status = 'accepted' AND a.alias ~ '\S\s+\S'
        AND ((a.scope = 'global' AND a.source = 'owner_verified_name_variant_v1') OR (a.scope = 'podcast' AND a.scope_podcast_id = e.podcast_id) OR (a.scope = 'episode' AND a.scope_episode_id = e.id)) ORDER BY a.alias);
    SELECT g.page_description INTO page FROM episode_public_page_evidence g WHERE g.episode_id = eid AND g.status = 'ok';
    sh := public.person_role_label_source_hash_v1(pe.name, aliases, e.title, e.description, page);
    IF sh IS DISTINCT FROM it->>'source_hash' THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'source_changed'); CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.person_name_forms_hu_v1(pe.name) f WHERE f.form=public.person_text_fold_v1(nm))
       AND NOT EXISTS (SELECT 1 FROM unnest(aliases) a CROSS JOIN LATERAL public.person_name_forms_hu_v1(a) f WHERE f.form=public.person_text_fold_v1(nm)) THEN
      res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'name_not_person'); CONTINUE;
    END IF;
    ftxt := public.person_text_fold_v1(CASE fld WHEN 'episode_title' THEN e.title WHEN 'episode_description' THEN e.description ELSE page END);
    fq := public.person_text_fold_v1(q);
    IF position(fq IN ftxt) = 0 OR position(public.person_text_fold_v1(snip) IN fq) = 0
       OR position(public.person_text_fold_v1(nm) IN public.person_text_fold_v1(snip)) = 0
       OR public.person_text_fold_v1(snip) !~ '(vendeg|beszelgetotars|interjualany|musorvezeto|hazigazd)'
       OR (descr <> '' AND position(public.person_text_fold_v1(descr) IN fq) = 0) THEN
      res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'quote_verify_failed'); CONTINUE;
    END IF;
    anc := public.person_role_label_anchor_v1(pid, e.podcast_id, NULLIF(descr, ''));
    IF anc IS NULL THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'identity_unanchored'); CONTINUE; END IF;
    IF fld <> 'episode_title' THEN
      SELECT count(*) FILTER (WHERE x.description IS NOT NULL),
             count(*) FILTER (WHERE x.id <> eid AND position(public.person_text_fold_v1(snip) IN public.person_text_fold_v1(x.description)) > 0)
        INTO total_eps, rep FROM (SELECT y.id, y.description FROM episodes y WHERE y.podcast_id = e.podcast_id
          ORDER BY y.published_at DESC NULLS LAST LIMIT 400) x;
      IF rep >= 3 AND rep::numeric >= 0.2 * GREATEST(total_eps, 1) THEN
        res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'series_footer_credit', 'repeat_episodes', rep, 'show_episodes', total_eps);
        CONTINUE;
      END IF;
    END IF;
    ev := jsonb_build_object('rule', 'role-label-v1', 'role', role, 'field', fld, 'quote', left(q, 400), 'label_snippet', left(snip, 200),
      'descriptor', NULLIF(descr, ''), 'matched_name', nm, 'source_hash', sh, 'identity', anc, 'repeat_episodes', COALESCE(rep, 0), 'applied_at', now());
    SELECT * INTO mrow FROM person_episode_mentions m WHERE m.person_id = pid AND m.episode_id = eid AND m.mention_type = role LIMIT 1;
    inserted := mrow.id IS NULL;
    SELECT to_jsonb(d) INTO dbefore FROM person_pair_dispositions d WHERE d.person_id = pid AND d.episode_id = eid;
    IF inserted THEN
      INSERT INTO person_episode_mentions (person_id, episode_id, podcast_id, mention_type, confidence, evidence, source, relevance_status,
        final_relevance_score, validation_source, role_type, role_confidence, role_reason, source_evidence)
      VALUES (pid, eid, e.podcast_id, role, 0.99, left(q, 500), 'role_label_v1', 'accepted', 0.99, 'deterministic_role_label_v1',
        'participant', 0.99, 'Az epizód saját leírása szerepcímkével nevezi meg (' || role || ').', jsonb_build_object('role_label_v1', ev))
      RETURNING id INTO mid;
      before := jsonb_build_object('inserted', true);
    ELSE
      IF mrow.relevance_status NOT IN ('pending','needs_review') THEN
        res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'mention_state_changed'); CONTINUE;
      END IF;
      before := jsonb_build_object('inserted', false, 'relevance_status', mrow.relevance_status, 'validation_source', mrow.validation_source,
        'final_relevance_score', mrow.final_relevance_score, 'role_type', mrow.role_type, 'role_confidence', mrow.role_confidence,
        'role_reason', mrow.role_reason, 'source_evidence', mrow.source_evidence);
      UPDATE person_episode_mentions SET relevance_status = 'accepted', validation_source = 'deterministic_role_label_v1', final_relevance_score = 0.99,
        role_type = 'participant', role_confidence = 0.99, role_reason = 'Az epizód saját leírása szerepcímkével nevezi meg (' || role || ').',
        source_evidence = COALESCE(source_evidence, '{}'::jsonb) || jsonb_build_object('role_label_v1', ev)
      WHERE id = mrow.id AND relevance_status = mrow.relevance_status
        AND COALESCE(validation_source,'') !~* 'manual|chatgpt|external_review';
      IF NOT FOUND THEN res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'mention_state_changed'); CONTINUE; END IF;
      mid := mrow.id;
    END IF;
    UPDATE person_pair_dispositions SET disposition = 'decided_accepted', reason_code = 'accepted_link', decided_by = 'deterministic:role-label-v1',
      policy_version = 'role-label-v1', detail = detail || jsonb_build_object('role_label', ev->'identity'->>'anchor'), updated_at = now()
    WHERE person_id = pid AND episode_id = eid AND decided_by NOT LIKE 'human:%';
    UPDATE person_relevance_work w SET lease_until = now(), updated_at = now()
    WHERE w.person_id = pid AND w.episode_id = eid AND w.lease_until > now()
      AND NOT EXISTS (SELECT 1 FROM person_relevance_batch_jobs j WHERE j.id = w.claim_token);
    INSERT INTO person_pair_lane_audit (lane, action, person_id, episode_id, mention_id, rule_version, before_state, after_state, evidence)
    VALUES ('role_label', 'accept', pid, eid, mid, 'role-label-v1', before || jsonb_build_object('disposition', dbefore),
      jsonb_build_object('relevance_status', 'accepted', 'mention_type', role, 'validation_source', 'deterministic_role_label_v1'), ev)
    RETURNING id INTO aud;
    res := res || jsonb_build_object('person_id', pid, 'episode_id', eid, 'outcome', 'applied', 'audit_id', aud, 'anchor', anc->>'anchor', 'role', role);
  END LOOP;
  RETURN res;
END $function$
;

CREATE OR REPLACE FUNCTION public.canonicalize_person_disposition_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE src uuid:=NEW.person_id;canonical uuid;prior person_pair_dispositions%ROWTYPE;
BEGIN
 canonical:=person_canonical_identity_id_v1(src);
 IF canonical=src THEN RETURN NEW; END IF;
 NEW.person_id:=canonical;
 SELECT * INTO prior FROM person_pair_dispositions WHERE person_id=canonical AND episode_id=NEW.episode_id FOR UPDATE;
 INSERT INTO person_identity_repair_events(kind,source_person_id,canonical_person_id,table_name,incoming,retained)
 VALUES('canonicalize_disposition',src,canonical,TG_TABLE_NAME,to_jsonb(NEW),CASE WHEN prior.person_id IS NOT NULL THEN to_jsonb(prior) END);
 IF prior.person_id IS NULL THEN RETURN NEW; END IF;
 IF prior.decided_by NOT LIKE 'human:%' AND prior.disposition NOT IN('decided_accepted','decided_rejected','resolved_show_host')
 AND NEW.disposition IN('decided_accepted','decided_rejected','resolved_show_host') THEN
  UPDATE person_pair_dispositions SET disposition=NEW.disposition,reason_code=NEW.reason_code,source_fingerprint=NEW.source_fingerprint,
  policy_version=NEW.policy_version,detail=NEW.detail,decided_by=NEW.decided_by,reopen_on_source_change=NEW.reopen_on_source_change,updated_at=now()
  WHERE person_id=canonical AND episode_id=NEW.episode_id;
 END IF;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.canonicalize_person_mention_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE src uuid:=NEW.person_id; canonical uuid; prior person_episode_mentions%ROWTYPE; new_rank int;old_rank int;
BEGIN
 canonical:=person_canonical_identity_id_v1(src);
 IF canonical=src THEN RETURN NEW; END IF;
 NEW.person_id:=canonical;
 PERFORM pg_advisory_xact_lock(hashtextextended(canonical::text||NEW.episode_id::text||NEW.mention_type,0));
 SELECT * INTO prior FROM person_episode_mentions WHERE person_id=canonical AND episode_id=NEW.episode_id AND mention_type=NEW.mention_type FOR UPDATE;
 INSERT INTO person_identity_repair_events(kind,source_person_id,canonical_person_id,table_name,incoming,retained)
 VALUES('canonicalize_mention',src,canonical,TG_TABLE_NAME,to_jsonb(NEW),CASE WHEN prior.id IS NOT NULL THEN to_jsonb(prior) END);
 IF prior.id IS NULL THEN RETURN NEW; END IF;
 new_rank:=(CASE WHEN NEW.validation_source ~ '^(manual|human|chatgpt|external_review)' THEN 1000 ELSE 0 END)+(CASE WHEN NEW.relevance_status IN('accepted','rejected','resolved_show_host') THEN 100 ELSE 0 END);
 old_rank:=(CASE WHEN prior.validation_source ~ '^(manual|human|chatgpt|external_review)' THEN 1000 ELSE 0 END)+(CASE WHEN prior.relevance_status IN('accepted','rejected','resolved_show_host') THEN 100 ELSE 0 END);
 IF new_rank>old_rank THEN
  UPDATE person_episode_mentions SET relevance_status=NEW.relevance_status,final_relevance_score=NEW.final_relevance_score,
  validation_source=NEW.validation_source,ai_identity_match=NEW.ai_identity_match,ai_reason=NEW.ai_reason,ai_evidence_phrases=NEW.ai_evidence_phrases,
  ai_judged_at=NEW.ai_judged_at,ai_model=NEW.ai_model,role_type=NEW.role_type,role_confidence=NEW.role_confidence,
  role_reason=NEW.role_reason,source_evidence=NEW.source_evidence,evidence=NEW.evidence,confidence=NEW.confidence,source=NEW.source
  WHERE id=prior.id;
 END IF;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.canonicalize_person_name_disposition_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE src uuid:=NEW.person_id;canonical uuid;prior person_pair_dispositions%ROWTYPE;
BEGIN
 SELECT r.person_id INTO canonical FROM people p CROSS JOIN LATERAL public.resolve_person_name_variant_v1(p.name,NEW.episode_id) r WHERE p.id=src;
 IF canonical IS NULL OR canonical=src THEN RETURN NEW; END IF;
 NEW.person_id:=canonical;
 SELECT * INTO prior FROM person_pair_dispositions WHERE person_id=canonical AND episode_id=NEW.episode_id FOR UPDATE;
 INSERT INTO person_identity_repair_events(kind,source_person_id,canonical_person_id,table_name,incoming,retained)
 VALUES('canonicalize_name_variant_disposition',src,canonical,TG_TABLE_NAME,to_jsonb(NEW),CASE WHEN prior.person_id IS NOT NULL THEN to_jsonb(prior) END);
 IF prior.person_id IS NULL THEN RETURN NEW; END IF;
 IF prior.decided_by NOT LIKE 'human:%' AND prior.disposition NOT IN('decided_accepted','decided_rejected','resolved_show_host')
 AND NEW.disposition IN('decided_accepted','decided_rejected','resolved_show_host') THEN
  UPDATE person_pair_dispositions SET disposition=NEW.disposition,reason_code=NEW.reason_code,source_fingerprint=NEW.source_fingerprint,
  policy_version=NEW.policy_version,detail=NEW.detail,decided_by=NEW.decided_by,reopen_on_source_change=NEW.reopen_on_source_change,updated_at=now()
  WHERE person_id=canonical AND episode_id=NEW.episode_id;
 END IF;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.canonicalize_person_name_mention_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE src uuid:=NEW.person_id; canonical uuid; prior person_episode_mentions%ROWTYPE; new_rank int;old_rank int;
BEGIN
 SELECT r.person_id INTO canonical FROM people p CROSS JOIN LATERAL public.resolve_person_name_variant_v1(p.name,NEW.episode_id) r WHERE p.id=src;
 IF canonical IS NULL OR canonical=src THEN RETURN NEW; END IF;
 NEW.person_id:=canonical;
 PERFORM pg_advisory_xact_lock(hashtextextended(canonical::text||NEW.episode_id::text||NEW.mention_type,0));
 SELECT * INTO prior FROM person_episode_mentions WHERE person_id=canonical AND episode_id=NEW.episode_id AND mention_type=NEW.mention_type FOR UPDATE;
 INSERT INTO person_identity_repair_events(kind,source_person_id,canonical_person_id,table_name,incoming,retained)
 VALUES('canonicalize_name_variant_mention',src,canonical,TG_TABLE_NAME,to_jsonb(NEW),CASE WHEN prior.id IS NOT NULL THEN to_jsonb(prior) END);
 IF prior.id IS NULL THEN RETURN NEW; END IF;
 new_rank:=(CASE WHEN NEW.validation_source ~ '^(manual|human|chatgpt|external_review)' THEN 1000 ELSE 0 END)+(CASE WHEN NEW.relevance_status IN('accepted','rejected','resolved_show_host') THEN 100 ELSE 0 END);
 old_rank:=(CASE WHEN prior.validation_source ~ '^(manual|human|chatgpt|external_review)' THEN 1000 ELSE 0 END)+(CASE WHEN prior.relevance_status IN('accepted','rejected','resolved_show_host') THEN 100 ELSE 0 END);
 IF new_rank>old_rank THEN
  UPDATE person_episode_mentions SET relevance_status=NEW.relevance_status,final_relevance_score=NEW.final_relevance_score,
  validation_source=NEW.validation_source,ai_identity_match=NEW.ai_identity_match,ai_reason=NEW.ai_reason,ai_evidence_phrases=NEW.ai_evidence_phrases,
  ai_judged_at=NEW.ai_judged_at,ai_model=NEW.ai_model,role_type=NEW.role_type,role_confidence=NEW.role_confidence,
  role_reason=NEW.role_reason,source_evidence=NEW.source_evidence,evidence=NEW.evidence,confidence=NEW.confidence,source=NEW.source
  WHERE id=prior.id;
 END IF;
 RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.canonicalize_person_relation_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE src uuid:=NEW.person_id;canonical uuid;keys text[];k text;match_json jsonb;collision boolean;
BEGIN
 canonical:=person_canonical_identity_id_v1(src);
 IF canonical=src THEN RETURN NEW; END IF;
 NEW.person_id:=canonical;
 keys:=CASE TG_TABLE_NAME WHEN 'person_podcast_map' THEN ARRAY['podcast_id','role']
 WHEN 'person_aliases' THEN ARRAY['normalized_alias']
 WHEN 'person_show_credits' THEN ARRAY['podcast_id','credit_kind']
 WHEN 'person_external_sources' THEN ARRAY['source_url'] ELSE ARRAY[]::text[] END;
 match_json:=jsonb_build_object('person_id',canonical);
 FOREACH k IN ARRAY keys LOOP match_json:=match_json||jsonb_build_object(k,to_jsonb(NEW)->k); END LOOP;
 IF cardinality(keys)>0 THEN
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I t WHERE t.person_id=$1 AND to_jsonb(t) @> $2)',TG_TABLE_NAME) INTO collision USING canonical,match_json;
  IF collision THEN
   INSERT INTO person_identity_repair_events(kind,source_person_id,canonical_person_id,table_name,incoming) VALUES('deduplicate_relation',src,canonical,TG_TABLE_NAME,to_jsonb(NEW));
   RETURN NULL;
  END IF;
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.classify_person_pair_dispositions_v1(_after_person uuid, _after_episode uuid, _limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '170s'
AS $function$
DECLARE lim integer := LEAST(GREATEST(COALESCE(_limit, 1000), 1), 20000); scanned integer; written integer; lp uuid; le uuid;
BEGIN
  DROP TABLE IF EXISTS pg_temp._ppd_keys;
  CREATE TEMP TABLE _ppd_keys ON COMMIT DROP AS
    SELECT DISTINCT m.person_id, m.episode_id FROM person_episode_mentions m
     WHERE (m.person_id, m.episode_id) > (COALESCE(_after_person, '00000000-0000-0000-0000-000000000000'::uuid),
                                          COALESCE(_after_episode, '00000000-0000-0000-0000-000000000000'::uuid))
     ORDER BY 1, 2 LIMIT lim;
  SELECT count(*) INTO scanned FROM _ppd_keys;
  SELECT person_id, episode_id INTO lp, le FROM _ppd_keys ORDER BY person_id DESC, episode_id DESC LIMIT 1;

  WITH pr AS (
    SELECT k.person_id, k.episode_id,
      bool_or(m.relevance_status = 'accepted') acc, bool_or(m.relevance_status = 'rejected') rej,
      bool_or(m.relevance_status = 'needs_review') nr, bool_or(m.relevance_status = 'pending') pend,
      bool_or(m.relevance_status = 'in_progress') inp, bool_or(m.relevance_status = 'waiting_clean_text') wct,
      bool_or(m.relevance_status = 'resolved_show_host') shr,
      bool_or(COALESCE(m.validation_source,'') ~* 'manual|chatgpt|external_review') man,
      bool_or(m.validation_source = 'person_openai_escalation_v1') esc,
      count(*) nrows, count(*) FILTER (WHERE m.relevance_status = 'needs_review') nr_rows,
      bool_or(m.ai_identity_match IN ('different_person_same_name','substring_false_positive')) namesake,
      bool_or(m.source = 'rss_author') rss_author
    FROM _ppd_keys k JOIN person_episode_mentions m ON m.person_id = k.person_id AND m.episode_id = k.episode_id
    GROUP BY 1, 2),
  x AS (
    SELECT pr.*, person.name pname, person.disambiguation_label, person.disambiguation_context,
      (COALESCE(person.identity_ambiguous, false) OR EXISTS (SELECT 1 FROM people o WHERE o.normalized_name = person.normalized_name
         AND o.id <> person.id AND o.is_public)) idrisk,
      e.title, e.description, e.summary, ct.cleaned_text, tr.transcript, tr.content_hash, pg.page_description,
      p.title ptitle, p.description pdesc,
      EXISTS (SELECT 1 FROM person_relevance_work w JOIN person_relevance_batch_jobs j ON j.id = w.claim_token
        WHERE w.person_id = pr.person_id AND w.episode_id = pr.episode_id AND w.lease_until > now()
          AND j.status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','cancelling','ingesting')) open_lease,
      (SELECT i.decision->>'ai_suggested_status' FROM person_relevance_batch_items i WHERE i.tier = 'primary' AND i.person_id = pr.person_id
         AND i.episode_id = pr.episode_id AND i.status = 'applied' ORDER BY i.created_at DESC LIMIT 1) psug,
      (SELECT i.decision->>'ai_suggested_status' FROM person_relevance_batch_items i WHERE i.tier = 'escalation' AND i.person_id = pr.person_id
         AND i.episode_id = pr.episode_id AND i.status = 'applied' ORDER BY i.created_at DESC LIMIT 1) esug,
      (SELECT i.status FROM person_relevance_batch_items i WHERE i.person_id = pr.person_id AND i.episode_id = pr.episode_id
         AND i.tier IN ('primary','escalation') ORDER BY i.created_at DESC LIMIT 1) last_item,
      ARRAY(SELECT DISTINCT s.n FROM (
          SELECT public.unaccent(lower(person.name)) n UNION ALL
          SELECT public.unaccent(lower(a.alias)) FROM person_aliases a WHERE a.person_id = pr.person_id AND a.status = 'accepted'
            AND (a.scope = 'global' OR (a.scope = 'podcast' AND a.scope_podcast_id = e.podcast_id) OR (a.scope = 'episode' AND a.scope_episode_id = e.id))
        ) s WHERE length(s.n) >= 3) names
    FROM pr JOIN people person ON person.id = pr.person_id
    JOIN episodes e ON e.id = pr.episode_id
    JOIN podcasts p ON p.id = e.podcast_id AND p.language_decision = 'accept_hungarian'
    LEFT JOIN episode_clean_text ct ON ct.episode_id = e.id AND ct.cleaner_method LIKE 'deterministic_v4%'
    LEFT JOIN episode_public_page_evidence pg ON pg.episode_id = e.id AND pg.status = 'ok'
    LEFT JOIN LATERAL (SELECT t.transcript, t.content_hash FROM episode_transcripts t WHERE t.episode_id = e.id AND t.status = 'ok'
      ORDER BY length(t.transcript) DESC LIMIT 1) tr ON true),
  y AS (
    SELECT x.*,
      EXISTS (SELECT 1 FROM (SELECT public.unaccent(lower(concat_ws(' ', title, description, summary, cleaned_text, transcript, page_description))) h) hh,
        unnest(names) n WHERE public.person_name_in_text_hu_v1(n, hh.h, true)) OR public.person_context_alias_in_text_v1(x.person_id,concat_ws(' ',title,description,summary,cleaned_text,transcript,page_description),x.episode_id) AS name_in_episode,
      EXISTS (SELECT 1 FROM (SELECT public.unaccent(lower(concat_ws(' ', ptitle, pdesc))) h) hh, unnest(names) n WHERE public.person_name_in_text_hu_v1(n, hh.h, true)) name_in_show,
      length(btrim(regexp_replace(regexp_replace(concat_ws(' ', title, cleaned_text, summary), 'https?://\S+', '', 'g'), '\s+', ' ', 'g'))) useful_len
    FROM x),
  c AS (
    SELECT y.person_id, y.episode_id,
      CASE
        WHEN acc THEN 'decided_accepted|accepted_link'
        WHEN shr THEN 'resolved_show_host|verified_show_host_rule'
        WHEN rej AND NOT nr AND NOT pend AND NOT inp AND NOT wct THEN 'decided_rejected|rejected_link'
        WHEN open_lease THEN 'in_progress|active_batch_or_lease'
        WHEN inp THEN 'technical_retry|stale_mention_claim'
        WHEN man THEN 'human_contradiction_review|manual_review_conflict'
        WHEN (pend OR nr) AND NOT name_in_episode THEN
          CASE WHEN rss_author AND name_in_show THEN 'insufficient_evidence|rss_author_credit_show_confirmed'
               WHEN rss_author THEN 'insufficient_evidence|rss_author_credit_only'
               ELSE 'insufficient_evidence|name_not_in_available_sources' END
        WHEN pend AND useful_len < 100 THEN 'source_needed|short_source_parked'
        WHEN pend THEN 'first_round_pending|first_round_not_done'
        WHEN wct THEN 'source_needed|waiting_clean_text'
        WHEN nr AND cleaned_text IS NULL AND transcript IS NULL AND page_description IS NULL
             AND length(COALESCE(description,'') || COALESCE(summary,'')) < 200 THEN 'source_needed|no_usable_source_text'
        WHEN nr AND idrisk THEN 'human_identity_review|same_name_or_ambiguous_person'
        WHEN nr AND ((psug = 'accepted' AND esug = 'rejected') OR (psug = 'rejected' AND esug = 'accepted')) THEN 'human_contradiction_review|ai_opinions_conflict'
        WHEN nr AND last_item IN ('failed','invalid','refused','expired') AND psug IS NULL AND esug IS NULL THEN 'technical_retry|last_request_failed'
        WHEN nr THEN 'evidence_pending|needs_targeted_evidence'
        ELSE 'other|unclassified_state' END dr,
      md5(concat_ws('|', 'pair-disposition-v5', array_to_string(names, ','), md5(COALESCE(title,'')), md5(COALESCE(description,'')),
        md5(COALESCE(summary,'')), md5(COALESCE(cleaned_text,'')), COALESCE(content_hash, md5(COALESCE(transcript,''))), md5(COALESCE(page_description,'')))) fp,
      jsonb_strip_nulls(jsonb_build_object('rows', nrows, 'dup_rows', CASE WHEN acc THEN nr_rows END,
        'after_escalation', NULLIF(esc, false), 'missing_disambiguation', CASE WHEN disambiguation_label IS NULL AND disambiguation_context IS NULL THEN true END,
        'long_text', CASE WHEN length(cleaned_text) > 6000 THEN true END, 'no_clean_text', CASE WHEN cleaned_text IS NULL THEN true END,
        'has_transcript', CASE WHEN transcript IS NOT NULL THEN true END, 'has_page_evidence', CASE WHEN page_description IS NOT NULL THEN true END,
        'primary_suggested', psug, 'escalation_suggested', esug,
        'namesake_suggested', NULLIF(namesake, false), 'rss_author', NULLIF(rss_author, false), 'identity_risk', NULLIF(idrisk, false))) detail
    FROM y)
  INSERT INTO person_pair_dispositions AS d (person_id, episode_id, disposition, reason_code, source_fingerprint, policy_version, detail, decided_by)
  SELECT person_id, episode_id, split_part(dr, '|', 1), split_part(dr, '|', 2), fp, 'pair-disposition-v5', detail, 'deterministic:pair-disposition-v5'
    FROM c
  ON CONFLICT (person_id, episode_id) DO UPDATE SET disposition = EXCLUDED.disposition, reason_code = EXCLUDED.reason_code,
    source_fingerprint = EXCLUDED.source_fingerprint, policy_version = EXCLUDED.policy_version, detail = EXCLUDED.detail,
    decided_by = EXCLUDED.decided_by, updated_at = now()
  -- Only rows this classifier (or the role-label lane) wrote are rewritten; other deciders keep their rows.
  WHERE ((d.decided_by IS NULL OR d.decided_by LIKE 'deterministic:pair-disposition-%' OR d.decided_by = 'deterministic:role-label-v1')
         AND (d.disposition, d.reason_code, COALESCE(d.source_fingerprint,''), d.detail) IS DISTINCT FROM
             (EXCLUDED.disposition, EXCLUDED.reason_code, COALESCE(EXCLUDED.source_fingerprint,''), EXCLUDED.detail))
     OR (d.decided_by LIKE 'human:%' AND d.reopen_on_source_change AND d.source_fingerprint IS DISTINCT FROM EXCLUDED.source_fingerprint);
  GET DIAGNOSTICS written = ROW_COUNT;
  RETURN jsonb_build_object('scanned', scanned, 'written', written, 'last_person', lp, 'last_episode', le);
END $function$
;

CREATE OR REPLACE FUNCTION public.normalize_new_person_name_variant_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;can people%ROWTYPE;
BEGIN
 SELECT * INTO r FROM resolve_person_name_variant_v1(NEW.name,NULL);
 IF r.person_id IS NULL THEN
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM person_name_variant_forms f JOIN person_name_variant_rules nr ON nr.id=f.rule_id
    WHERE nr.active AND nr.scope='context' AND f.normalized_form=person_text_fold_v1(NEW.name)) THEN
   NEW.identity_status:='needs_context';NEW.identity_ambiguous:=true;NEW.needs_human_review_identity:=true;
   NEW.is_public:=false;NEW.is_indexable:=false;NEW.is_browsable_in_people_hub:=false;
  END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO can FROM people WHERE id=r.person_id;
 IF NEW.id=can.id OR NEW.slug=can.slug THEN
  NEW.name:=can.name;NEW.normalized_name:=can.normalized_name;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN RETURN NEW; END IF;
 IF NEW.manual_approved OR (NEW.wikidata_id IS NOT NULL AND NEW.wikidata_id IS DISTINCT FROM can.wikidata_id) THEN RETURN NEW; END IF;
 NEW.identity_status:='merged_into';NEW.ai_duplicate_of_person_id:=can.id;NEW.identity_ambiguous:=false;NEW.duplicate_candidate:=false;
 NEW.needs_human_review_identity:=false;NEW.is_public:=false;NEW.is_indexable:=false;NEW.is_browsable_in_people_hub:=false;
 NEW.activation_status:='inactive';NEW.activation_reason:='Verified grammatical or nickname variant of '||can.id::text;
 NEW.ai_review_status:='reviewed';NEW.ai_recommended_action:='hide';
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.person_credit_name_in_text_v1(_name text, _folded text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT public.person_name_in_text_hu_v1(_name,_folded,false)
$function$
;

CREATE OR REPLACE FUNCTION public.person_credit_name_in_text_v1(_name text, _folded text, _any_suffix boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
 SELECT public.person_name_in_text_hu_v1(_name,_folded,false)
$function$
;

CREATE OR REPLACE FUNCTION public.person_episode_credit_decide_v1(_person uuid, _episode uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r record; names text[]; fq text; hit boolean; oc text; full_text text;
BEGIN
  FOR r IN SELECT ru.*, e.title, e.description, e.podcast_id AS ep_podcast,
             public.person_episode_credit_capture_v1(ru.credit_pattern, ru.title_pattern, e.title, e.description) q
           FROM person_episode_credit_rules ru JOIN episodes e ON e.id = _episode AND e.podcast_id = ru.podcast_id
           WHERE ru.active ORDER BY ru.rule_key LOOP
    CONTINUE WHEN r.q IS NULL OR length(r.q) < 3;
    IF names IS NULL THEN
      names := ARRAY(SELECT pe.name FROM people pe WHERE pe.id = _person
        UNION SELECT a.alias FROM person_aliases a WHERE a.person_id = _person AND a.status = 'accepted'
          AND (a.scope = 'global' OR (a.scope = 'podcast' AND a.scope_podcast_id = r.ep_podcast)));
    END IF;
    fq := public.person_text_fold_v1(r.q);
    hit := EXISTS (SELECT 1 FROM unnest(names) n WHERE public.person_credit_name_in_text_v1(n, fq));
    oc := NULL;
    IF hit THEN
      IF r.match_action <> 'accept_participant' THEN CONTINUE; END IF;
      IF _person = ANY (r.anchor_person_ids) OR EXISTS (
           SELECT 1 FROM people p WHERE p.id = _person AND NOT COALESCE(p.identity_ambiguous, false)
             AND COALESCE(p.identity_status, 'normal') IN ('normal', 'confirmed', 'context_resolved')
             AND NOT EXISTS (SELECT 1 FROM people o WHERE o.normalized_name = p.normalized_name AND o.id <> p.id AND o.is_public)
             AND NOT EXISTS (SELECT 1 FROM person_episode_mentions x WHERE x.person_id = _person AND x.relevance_status = 'accepted'
                               AND x.podcast_id IS DISTINCT FROM r.ep_podcast)) THEN
        oc := 'credited_role';
      ELSE
        oc := 'credit_identity_unanchored';
      END IF;

    END IF;
    IF oc IS NOT NULL THEN
      RETURN jsonb_build_object('rule_id', r.id, 'outcome', oc, 'quote', r.q, 'role', r.credit_role, 'version', r.version,
        'source_url', r.source_url, 'source_hash', r.source_hash, 'provenance', r.provenance);
    END IF;
  END LOOP;
  RETURN NULL;
END $function$
;

CREATE OR REPLACE FUNCTION public.person_episode_credit_pair_ok_v1(_person uuid, _episode uuid, _outcome text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT _outcome = 'credited_role'
    AND NOT EXISTS (SELECT 1 FROM person_episode_mentions m WHERE m.person_id = _person AND m.episode_id = _episode
      AND (m.relevance_status IN ('accepted','rejected') OR COALESCE(m.validation_source,'') ~* 'manual|chatgpt|external_review'
        OR (_outcome = 'credited_role' AND m.ai_identity_match IN ('different_person_same_name','substring_false_positive'))
        OR m.relevance_status NOT IN ('pending','needs_review','waiting_clean_text','in_progress','resolved_show_host')
        OR (_outcome = 'feed_credit_not_episode' AND (m.relevance_status = 'resolved_show_host' OR COALESCE(m.source,'') <> 'rss_author'))))
    AND NOT EXISTS (SELECT 1 FROM person_pair_dispositions d WHERE d.person_id = _person AND d.episode_id = _episode
      AND (d.disposition IN ('decided_accepted','decided_rejected','human_contradiction_review') OR COALESCE(d.decided_by,'') LIKE 'human:%'))
    AND NOT EXISTS (SELECT 1 FROM person_relevance_work w JOIN person_relevance_batch_jobs j ON j.id = w.claim_token
      WHERE w.person_id = _person AND w.episode_id = _episode AND w.lease_until > now()
        AND j.status IN ('claimed','uploading','submitted','validating','in_progress','finalizing','cancelling','ingesting','completed'))
$function$
;

CREATE OR REPLACE FUNCTION public.person_identity_rule_validate_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF NEW.active AND (
 NEW.source_person_id=NEW.canonical_person_id
 OR EXISTS(SELECT 1 FROM person_identity_merge_rules WHERE active AND source_person_id=NEW.canonical_person_id)
 OR EXISTS(SELECT 1 FROM person_identity_merge_rules WHERE active AND canonical_person_id=NEW.source_person_id AND source_person_id<>NEW.source_person_id)
 OR EXISTS(SELECT 1 FROM person_identity_separation_rules WHERE person_id=NEW.source_person_id AND other_person_id=NEW.canonical_person_id)
 ) THEN RAISE EXCEPTION 'Identity rule would create a chain, cycle or known namesake merge'; END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.person_role_label_candidates_v1(_after_person uuid, _after_episode uuid, _limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
DECLARE lim integer := LEAST(GREATEST(COALESCE(_limit, 500), 1), 1000); out jsonb; lp uuid; le uuid; scanned integer;
BEGIN
  DROP TABLE IF EXISTS pg_temp._rl_keys;
  CREATE TEMP TABLE _rl_keys ON COMMIT DROP AS
    SELECT d.person_id, d.episode_id, d.disposition FROM person_pair_dispositions d
    WHERE (d.person_id, d.episode_id) > (COALESCE(_after_person, '00000000-0000-0000-0000-000000000000'::uuid),
                                         COALESCE(_after_episode, '00000000-0000-0000-0000-000000000000'::uuid))
      AND d.disposition IN ('evidence_pending','first_round_pending','source_needed','technical_retry','in_progress','insufficient_evidence')
    ORDER BY d.person_id, d.episode_id LIMIT lim;
  SELECT count(*) INTO scanned FROM _rl_keys;
  SELECT person_id, episode_id INTO lp, le FROM _rl_keys ORDER BY person_id DESC, episode_id DESC LIMIT 1;
  WITH b AS (
    SELECT k.person_id, k.episode_id, k.disposition, e.podcast_id, pe.name, e.title, e.description, g.page_description,
      ARRAY(SELECT a.alias FROM person_aliases a WHERE a.person_id = k.person_id AND a.status = 'accepted' AND a.alias ~ '\S\s+\S'
        AND ((a.scope = 'global' AND a.source = 'owner_verified_name_variant_v1') OR (a.scope = 'podcast' AND a.scope_podcast_id = e.podcast_id) OR (a.scope = 'episode' AND a.scope_episode_id = e.id))
        ORDER BY a.alias) aliases
    FROM _rl_keys k JOIN episodes e ON e.id = k.episode_id JOIN people pe ON pe.id = k.person_id
    LEFT JOIN episode_public_page_evidence g ON g.episode_id = e.id AND g.status = 'ok'
    WHERE k.disposition <> 'insufficient_evidence' OR g.page_description IS NOT NULL),
  h AS (SELECT b.*, public.person_role_label_source_hash_v1(b.name, b.aliases, b.title, b.description, b.page_description) sh FROM b)
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'person_id', h.person_id, 'episode_id', h.episode_id, 'podcast_id', h.podcast_id, 'disposition', h.disposition,
      'name', h.name, 'aliases', to_jsonb(h.aliases), 'source_hash', h.sh,
      'has_label', concat_ws(' ', h.title, h.description, h.page_description) ~* '(vend[eé]g|besz[eé]lget[oő]t[aá]rs|interj[uú]alany|m[uű]sorvezet[oő]|h[aá]zigazd)',
      'title', h.title,
      'description', CASE WHEN concat_ws(' ', h.title, h.description, h.page_description) ~* '(vend[eé]g|besz[eé]lget[oő]t[aá]rs|interj[uú]alany|m[uű]sorvezet[oő]|h[aá]zigazd)' THEN left(h.description, 8000) END,
      'page_description', h.page_description,
      'block', public.person_role_label_block_v1(h.person_id, h.episode_id))), '[]'::jsonb)
  INTO out
  FROM h
  WHERE NOT EXISTS (SELECT 1 FROM person_role_label_results r WHERE r.person_id = h.person_id AND r.episode_id = h.episode_id
    AND r.rule_version = 'role-label-v1' AND r.source_hash = h.sh);
  RETURN jsonb_build_object('rows', out, 'scanned', scanned, 'last_person', lp, 'last_episode', le);
END $function$
;

CREATE OR REPLACE FUNCTION public.protect_verified_person_identity_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE canonical uuid; why text;
BEGIN
 SELECT canonical_person_id INTO canonical FROM person_identity_merge_rules WHERE source_person_id=NEW.id AND active;
 IF canonical IS NOT NULL THEN
  IF NEW.identity_status IS DISTINCT FROM 'merged_into' OR NEW.is_public OR NEW.is_indexable OR NEW.ai_duplicate_of_person_id IS DISTINCT FROM canonical THEN
   INSERT INTO person_identity_repair_events(kind,source_person_id,canonical_person_id,table_name,incoming) VALUES('prevent_alias_reactivation',NEW.id,canonical,TG_TABLE_NAME,to_jsonb(NEW));
  END IF;
  NEW.identity_status:='merged_into'; NEW.ai_duplicate_of_person_id:=canonical; NEW.is_public:=false;NEW.is_indexable:=false;NEW.is_browsable_in_people_hub:=false;
  NEW.activation_status:='inactive';NEW.ai_recommended_action:='hide';NEW.duplicate_candidate:=false;NEW.needs_human_review_identity:=false;
  RETURN NEW;
 END IF;
 IF NEW.ai_duplicate_of_person_id=NEW.id THEN why:='prevent_self_duplicate';
 ELSIF NEW.ai_duplicate_of_person_id IS NOT NULL AND EXISTS(SELECT 1 FROM person_identity_merge_rules WHERE canonical_person_id=NEW.id AND active) THEN why:='protect_verified_canonical';
 ELSIF EXISTS(SELECT 1 FROM person_identity_separation_rules WHERE person_id=NEW.id AND other_person_id=NEW.ai_duplicate_of_person_id) THEN why:='protect_distinct_namesakes';
 END IF;
 IF why IS NOT NULL THEN
  INSERT INTO person_identity_repair_events(kind,source_person_id,canonical_person_id,table_name,incoming) VALUES(why,NEW.id,NEW.ai_duplicate_of_person_id,TG_TABLE_NAME,to_jsonb(NEW));
  NEW.ai_duplicate_of_person_id:=NULL;
  IF TG_OP='UPDATE' AND NEW.ai_recommended_action IN('hide','reject','duplicate') THEN
   NEW.ai_recommended_action:=OLD.ai_recommended_action;NEW.is_public:=OLD.is_public;NEW.is_indexable:=OLD.is_indexable;
   NEW.activation_status:=OLD.activation_status;NEW.activation_reason:=OLD.activation_reason;
  END IF;
 END IF;
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.register_new_person_name_variant_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;
BEGIN
 IF NEW.identity_status<>'merged_into' OR NEW.ai_duplicate_of_person_id IS NULL THEN RETURN NEW; END IF;
 SELECT nr.* INTO r FROM person_name_variant_forms f JOIN person_name_variant_rules nr ON nr.id=f.rule_id
 WHERE nr.active AND nr.scope='global' AND f.normalized_form=person_text_fold_v1(NEW.name) AND nr.person_id=NEW.ai_duplicate_of_person_id LIMIT 1;
 IF r.id IS NULL THEN RETURN NEW; END IF;
 INSERT INTO person_identity_merge_rules(source_person_id,canonical_person_id,evidence,version,run_id)
 VALUES(NEW.id,r.person_id,'Verified name variant: '||NEW.name||'. '||r.evidence,'hungarian_name_forms_v1',r.run_id);
 INSERT INTO person_identity_repair_events(kind,source_person_id,canonical_person_id,table_name,incoming)
 VALUES('register_name_variant_alias',NEW.id,r.person_id,'people',to_jsonb(NEW));
 RETURN NEW;
END $function$
;

CREATE OR REPLACE FUNCTION public.skip_merged_person_work_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF person_canonical_identity_id_v1(NEW.person_id)<>NEW.person_id THEN RETURN NULL; END IF;
 RETURN NEW;
END $function$
;

DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='a_canonicalize_person_alias' AND tgrelid='public.person_aliases'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER a_canonicalize_person_alias BEFORE INSERT OR UPDATE ON public.person_aliases FOR EACH ROW EXECUTE FUNCTION canonicalize_person_relation_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='a_canonicalize_person_credit' AND tgrelid='public.person_show_credits'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER a_canonicalize_person_credit BEFORE INSERT OR UPDATE ON public.person_show_credits FOR EACH ROW EXECUTE FUNCTION canonicalize_person_relation_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='a_canonicalize_person_disposition' AND tgrelid='public.person_pair_dispositions'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER a_canonicalize_person_disposition BEFORE INSERT OR UPDATE ON public.person_pair_dispositions FOR EACH ROW EXECUTE FUNCTION canonicalize_person_disposition_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='a_canonicalize_person_faq' AND tgrelid='public.person_faqs'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER a_canonicalize_person_faq BEFORE INSERT OR UPDATE ON public.person_faqs FOR EACH ROW EXECUTE FUNCTION canonicalize_person_relation_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='a_canonicalize_person_map' AND tgrelid='public.person_podcast_map'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER a_canonicalize_person_map BEFORE INSERT OR UPDATE ON public.person_podcast_map FOR EACH ROW EXECUTE FUNCTION canonicalize_person_relation_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='a_canonicalize_person_mention' AND tgrelid='public.person_episode_mentions'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER a_canonicalize_person_mention BEFORE INSERT OR UPDATE ON public.person_episode_mentions FOR EACH ROW EXECUTE FUNCTION canonicalize_person_mention_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='a_canonicalize_person_source' AND tgrelid='public.person_external_sources'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER a_canonicalize_person_source BEFORE INSERT OR UPDATE ON public.person_external_sources FOR EACH ROW EXECUTE FUNCTION canonicalize_person_relation_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='a_protect_verified_person_identity' AND tgrelid='public.people'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER a_protect_verified_person_identity BEFORE INSERT OR UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION protect_verified_person_identity_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='a_skip_merged_person_candidate' AND tgrelid='public.person_openai_batch_candidate_pool'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER a_skip_merged_person_candidate BEFORE INSERT OR UPDATE ON public.person_openai_batch_candidate_pool FOR EACH ROW EXECUTE FUNCTION skip_merged_person_work_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='a_skip_merged_person_work' AND tgrelid='public.person_relevance_work'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER a_skip_merged_person_work BEFORE INSERT OR UPDATE ON public.person_relevance_work FOR EACH ROW EXECUTE FUNCTION skip_merged_person_work_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='b_canonicalize_person_name_disposition' AND tgrelid='public.person_pair_dispositions'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER b_canonicalize_person_name_disposition BEFORE INSERT OR UPDATE ON public.person_pair_dispositions FOR EACH ROW EXECUTE FUNCTION canonicalize_person_name_disposition_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='b_canonicalize_person_name_mention' AND tgrelid='public.person_episode_mentions'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER b_canonicalize_person_name_mention BEFORE INSERT OR UPDATE ON public.person_episode_mentions FOR EACH ROW EXECUTE FUNCTION canonicalize_person_name_mention_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='b_normalize_person_name_variant' AND tgrelid='public.people'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER b_normalize_person_name_variant BEFORE INSERT OR UPDATE OF name, slug ON public.people FOR EACH ROW EXECUTE FUNCTION normalize_new_person_name_variant_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='register_person_name_variant' AND tgrelid='public.people'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER register_person_name_variant AFTER INSERT ON public.people FOR EACH ROW EXECUTE FUNCTION register_new_person_name_variant_v1();
END IF; END $tg$;
DO $tg$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='validate_person_identity_merge_rule' AND tgrelid='public.person_identity_merge_rules'::regclass AND NOT tgisinternal) THEN
  CREATE TRIGGER validate_person_identity_merge_rule BEFORE INSERT OR UPDATE ON public.person_identity_merge_rules FOR EACH ROW EXECUTE FUNCTION person_identity_rule_validate_v1();
END IF; END $tg$;

-- Trigger functions and identity resolvers: never callable by clients.
REVOKE ALL ON FUNCTION public.canonicalize_person_disposition_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonicalize_person_disposition_v1() TO service_role;
REVOKE ALL ON FUNCTION public.canonicalize_person_mention_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonicalize_person_mention_v1() TO service_role;
REVOKE ALL ON FUNCTION public.canonicalize_person_name_disposition_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonicalize_person_name_disposition_v1() TO service_role;
REVOKE ALL ON FUNCTION public.canonicalize_person_name_mention_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonicalize_person_name_mention_v1() TO service_role;
REVOKE ALL ON FUNCTION public.canonicalize_person_relation_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.canonicalize_person_relation_v1() TO service_role;
REVOKE ALL ON FUNCTION public.person_identity_rule_validate_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_identity_rule_validate_v1() TO service_role;
REVOKE ALL ON FUNCTION public.protect_verified_person_identity_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_verified_person_identity_v1() TO service_role;
REVOKE ALL ON FUNCTION public.skip_merged_person_work_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.skip_merged_person_work_v1() TO service_role;
REVOKE ALL ON FUNCTION public.normalize_new_person_name_variant_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_new_person_name_variant_v1() TO service_role;
REVOKE ALL ON FUNCTION public.register_new_person_name_variant_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.register_new_person_name_variant_v1() TO service_role;
REVOKE ALL ON FUNCTION public.person_canonical_identity_id_v1(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_canonical_identity_id_v1(uuid) TO service_role;
REVOKE ALL ON FUNCTION public.person_name_variant_context_ok_v1(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_name_variant_context_ok_v1(uuid, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.resolve_person_name_variant_v1(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_person_name_variant_v1(text, uuid) TO service_role;
REVOKE ALL ON FUNCTION public.person_context_alias_in_text_v1(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.person_context_alias_in_text_v1(uuid, text, uuid) TO service_role;
DO $g$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='readonly_codex') THEN
  REVOKE ALL ON FUNCTION public.canonicalize_person_disposition_v1() FROM readonly_codex;
  REVOKE ALL ON FUNCTION public.canonicalize_person_mention_v1() FROM readonly_codex;
  REVOKE ALL ON FUNCTION public.canonicalize_person_name_disposition_v1() FROM readonly_codex;
  REVOKE ALL ON FUNCTION public.canonicalize_person_name_mention_v1() FROM readonly_codex;
  REVOKE ALL ON FUNCTION public.canonicalize_person_relation_v1() FROM readonly_codex;
  REVOKE ALL ON FUNCTION public.person_identity_rule_validate_v1() FROM readonly_codex;
  REVOKE ALL ON FUNCTION public.protect_verified_person_identity_v1() FROM readonly_codex;
  REVOKE ALL ON FUNCTION public.skip_merged_person_work_v1() FROM readonly_codex;
  REVOKE ALL ON FUNCTION public.normalize_new_person_name_variant_v1() FROM readonly_codex;
  REVOKE ALL ON FUNCTION public.register_new_person_name_variant_v1() FROM readonly_codex;
END IF; END $g$;

-- Admin summary of the verified identity merge system (read-only; admins and service_role).
CREATE OR REPLACE FUNCTION public.get_person_identity_status_v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '30s'
AS $function$
BEGIN
  IF NOT (COALESCE(auth.role(), '') = 'service_role' OR public.has_role(auth.uid(), 'admin')) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN jsonb_build_object(
    'generated_at', now(),
    'totals', jsonb_build_object(
      'merge_rules_active', (SELECT count(*) FROM person_identity_merge_rules WHERE active),
      'merge_rules_inactive', (SELECT count(*) FROM person_identity_merge_rules WHERE NOT active),
      'canonical_people', (SELECT count(DISTINCT canonical_person_id) FROM person_identity_merge_rules WHERE active),
      'separation_rules', (SELECT count(*) FROM person_identity_separation_rules),
      'name_variant_rules', (SELECT count(*) FROM person_name_variant_rules WHERE active),
      'name_variant_forms', (SELECT count(*) FROM person_name_variant_forms f JOIN person_name_variant_rules r ON r.id = f.rule_id WHERE r.active),
      'backup_rows', (SELECT count(*) FROM person_identity_repair_backup),
      'guard_events', (SELECT count(*) FROM person_identity_repair_events)),
    'merges', (SELECT COALESCE(jsonb_agg(x ORDER BY x.sources DESC, x.name), '[]'::jsonb) FROM (
        SELECT c.name, c.slug, count(*) sources, array_agg(s.name ORDER BY s.name) source_names,
               min(m.evidence) evidence, min(m.version) version
          FROM person_identity_merge_rules m JOIN people c ON c.id = m.canonical_person_id JOIN people s ON s.id = m.source_person_id
         WHERE m.active GROUP BY c.name, c.slug) x),
    'separations', (SELECT COALESCE(jsonb_agg(jsonb_build_object('person', a.name, 'other', b.name, 'reason', r.reason) ORDER BY a.name, b.name), '[]'::jsonb)
        FROM person_identity_separation_rules r JOIN people a ON a.id = r.person_id JOIN people b ON b.id = r.other_person_id),
    'name_variants', (SELECT COALESCE(jsonb_agg(jsonb_build_object('person', p.name, 'base_name', r.base_name, 'scope', r.scope, 'evidence', r.evidence,
          'forms', (SELECT count(*) FROM person_name_variant_forms f WHERE f.rule_id = r.id)) ORDER BY p.name, r.base_name), '[]'::jsonb)
        FROM person_name_variant_rules r JOIN people p ON p.id = r.person_id WHERE r.active),
    'runs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'version', version, 'created_at', created_at, 'completed_at', completed_at, 'summary', summary) ORDER BY created_at), '[]'::jsonb)
        FROM person_identity_repair_runs),
    'events', (SELECT COALESCE(jsonb_object_agg(kind, n), '{}'::jsonb) FROM (SELECT kind, count(*) n FROM person_identity_repair_events GROUP BY kind) e),
    'credit_policy_repairs', (SELECT COALESCE(jsonb_agg(jsonb_build_object('created_at', created_at, 'reason', reason, 'summary', summary) ORDER BY created_at), '[]'::jsonb)
        FROM person_credit_policy_repairs));
END $function$;
REVOKE ALL ON FUNCTION public.get_person_identity_status_v1() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_person_identity_status_v1() TO authenticated, service_role;