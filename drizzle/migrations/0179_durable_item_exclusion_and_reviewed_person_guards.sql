CREATE TABLE IF NOT EXISTS public.episode_ingest_exclusions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 podcast_id uuid NOT NULL REFERENCES public.podcasts(id),
 guid text,
 asset_id text CHECK (asset_id IS NULL OR asset_id ~ '^[A-Za-z0-9_-]+$'),
 old_slug text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (guid IS NOT NULL OR asset_id IS NOT NULL OR old_slug IS NOT NULL),
 UNIQUE (podcast_id, guid)
);
GRANT ALL ON public.episode_ingest_exclusions TO service_role;
ALTER TABLE public.episode_ingest_exclusions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.episode_ingest_exclusions FROM anon, authenticated;
INSERT INTO public.episode_ingest_exclusions(podcast_id,guid,asset_id,old_slug)
VALUES('2ebf836e-eaa3-40b2-8feb-0323295dba3b','02e72bdf-103f-5c74-8611-ec5c4a4d1228','RJb9HPpnlPY','valtozas-es-batorsag-coming-out-szelsokozep-produkcio')
ON CONFLICT(podcast_id,guid) DO UPDATE SET asset_id=EXCLUDED.asset_id,old_slug=EXCLUDED.old_slug;

CREATE OR REPLACE FUNCTION public.episode_ingest_excluded_v1(p_item jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM public.episode_ingest_exclusions x
 WHERE x.podcast_id::text=p_item->>'podcast_id' AND (
 (x.guid IS NOT NULL AND x.guid=p_item->>'guid') OR
 (x.old_slug IS NOT NULL AND x.old_slug=p_item->>'slug') OR
 (x.asset_id IS NOT NULL AND (x.asset_id=p_item->>'youtube_video_id' OR
 EXISTS(SELECT 1 FROM unnest(ARRAY[p_item->>'audio_url',p_item->>'episode_url',p_item->>'youtube_url']) u
 WHERE u ~ ('(^|/|[?&]v=)'||x.asset_id||'([./?&#]|$)'))))));
$$;
REVOKE ALL ON FUNCTION public.episode_ingest_excluded_v1(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.episode_ingest_excluded_v1(jsonb) TO service_role;
CREATE OR REPLACE FUNCTION public.guard_episode_ingest_exclusion_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF public.episode_ingest_excluded_v1(to_jsonb(NEW)) THEN RETURN NULL; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_episode_ingest_exclusion_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.guard_episode_ingest_exclusion_v1() TO service_role;
CREATE TRIGGER a_guard_episode_ingest_exclusion BEFORE INSERT OR UPDATE ON public.episodes
 FOR EACH ROW EXECUTE FUNCTION public.guard_episode_ingest_exclusion_v1();

CREATE OR REPLACE FUNCTION public.resolve_person_redirect_v1(p_slug text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT c.slug FROM public.people s JOIN public.person_identity_merge_rules r ON r.source_person_id=s.id AND r.active
 JOIN public.people c ON c.id=r.canonical_person_id AND c.is_public
 WHERE s.slug=p_slug AND NOT EXISTS(SELECT 1 FROM public.person_identity_merge_rules r2 WHERE r2.source_person_id=c.id AND r2.active)
 LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.resolve_person_redirect_v1(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_person_redirect_v1(text) TO anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.preserve_reviewed_person_mention_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF current_setting('podiverzum.reviewed_person_undo',true)='on' THEN RETURN NEW; END IF;
 IF COALESCE(OLD.validation_source,'') ~ '^(manual|human|chatgpt|external_review)' AND
 COALESCE(NEW.validation_source,'') !~ '^(manual|human|chatgpt|external_review)' THEN
  NEW.mention_type:=OLD.mention_type; NEW.relevance_status:=OLD.relevance_status;
  NEW.validation_source:=OLD.validation_source; NEW.final_relevance_score:=OLD.final_relevance_score;
  NEW.role_type:=OLD.role_type; NEW.role_confidence:=OLD.role_confidence;
  NEW.role_reason:=OLD.role_reason; NEW.source_evidence:=OLD.source_evidence;
  NEW.evidence:=OLD.evidence; NEW.confidence:=OLD.confidence; NEW.source:=OLD.source;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.preserve_reviewed_person_mention_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preserve_reviewed_person_mention_v1() TO service_role;
CREATE TRIGGER zzz_preserve_reviewed_person_mention BEFORE UPDATE ON public.person_episode_mentions
 FOR EACH ROW EXECUTE FUNCTION public.preserve_reviewed_person_mention_v1();
CREATE OR REPLACE FUNCTION public.preserve_reviewed_person_disposition_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF current_setting('podiverzum.reviewed_person_undo',true)='on' THEN RETURN NEW; END IF;
 IF OLD.decided_by LIKE 'human:%' AND COALESCE(NEW.decided_by,'') NOT LIKE 'human:%' THEN
  NEW.disposition:=OLD.disposition; NEW.reason_code:=OLD.reason_code;
  NEW.decided_by:=OLD.decided_by; NEW.policy_version:=OLD.policy_version;
  NEW.detail:=OLD.detail; NEW.reopen_on_source_change:=OLD.reopen_on_source_change;
  NEW.source_fingerprint:=OLD.source_fingerprint;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.preserve_reviewed_person_disposition_v1() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.preserve_reviewed_person_disposition_v1() TO service_role;
CREATE TRIGGER zzz_preserve_reviewed_person_disposition BEFORE UPDATE ON public.person_pair_dispositions
 FOR EACH ROW EXECUTE FUNCTION public.preserve_reviewed_person_disposition_v1();
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='readonly_codex') THEN
  REVOKE ALL ON FUNCTION public.guard_episode_ingest_exclusion_v1(), public.episode_ingest_excluded_v1(jsonb),public.preserve_reviewed_person_mention_v1(),public.preserve_reviewed_person_disposition_v1() FROM readonly_codex;
 END IF;
 IF EXISTS(SELECT 1 FROM public.episodes e WHERE e.podcast_id='2ebf836e-eaa3-40b2-8feb-0323295dba3b' AND public.episode_ingest_excluded_v1(to_jsonb(e))) THEN RAISE EXCEPTION 'Removed item must already be absent; never restore'; END IF;
END $$;