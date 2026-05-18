CREATE TABLE public.episode_ai_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL,
  classification_status text NOT NULL DEFAULT 'needs_review'
    CHECK (classification_status IN ('classified','no_good_match','too_thin','needs_review','rejected')),
  primary_category text,
  secondary_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejected_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  reason_hu text,
  false_positive_risks text[] NOT NULL DEFAULT '{}',
  vector_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_hash text NOT NULL,
  taxonomy_version text NOT NULL DEFAULT 'v1',
  model_version text,
  reviewed_by text NOT NULL DEFAULT 'ai',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX eac_episode_unique ON public.episode_ai_classifications(episode_id);
CREATE INDEX eac_primary_category_idx ON public.episode_ai_classifications(primary_category) WHERE classification_status='classified';
CREATE INDEX eac_status_idx ON public.episode_ai_classifications(classification_status);
CREATE INDEX eac_source_hash_idx ON public.episode_ai_classifications(source_hash);
CREATE INDEX eac_updated_idx ON public.episode_ai_classifications(updated_at DESC);
CREATE INDEX eac_topics_gin ON public.episode_ai_classifications USING gin (topics);

ALTER TABLE public.episode_ai_classifications
  ADD CONSTRAINT eac_episode_fk FOREIGN KEY (episode_id)
  REFERENCES public.episodes(id) ON DELETE CASCADE;

ALTER TABLE public.episode_ai_classifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eac public read" ON public.episode_ai_classifications FOR SELECT USING (true);
CREATE POLICY "eac admin write" ON public.episode_ai_classifications FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER eac_set_updated_at
  BEFORE UPDATE ON public.episode_ai_classifications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE public.suggested_taxonomy_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('topic','category')),
  suggested_name_hu text NOT NULL,
  suggested_slug text NOT NULL,
  description_hu text,
  reason_hu text,
  episode_count integer NOT NULL DEFAULT 0,
  distinct_podcast_count integer NOT NULL DEFAULT 0,
  sample_episode_ids uuid[] NOT NULL DEFAULT '{}',
  sample_podcast_ids uuid[] NOT NULL DEFAULT '{}',
  search_demand_score numeric NOT NULL DEFAULT 0,
  overlap_with_existing_topics jsonb NOT NULL DEFAULT '[]'::jsonb,
  overlap_with_existing_categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  confidence numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'suggested'
    CHECK (status IN ('suggested','approved','rejected','merged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz
);
CREATE UNIQUE INDEX sti_type_slug_unique ON public.suggested_taxonomy_items(type, suggested_slug);
CREATE INDEX sti_status_idx ON public.suggested_taxonomy_items(status);

ALTER TABLE public.suggested_taxonomy_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sti public read" ON public.suggested_taxonomy_items FOR SELECT USING (true);
CREATE POLICY "sti admin write" ON public.suggested_taxonomy_items FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.episode_classifier_stats()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'hu_eligible_episodes', (
      SELECT count(*) FROM episodes e JOIN podcasts p ON p.id=e.podcast_id
      WHERE p.is_hungarian=true AND p.language_decision='accept_hungarian'
    ),
    'classified', (SELECT count(*) FROM episode_ai_classifications WHERE classification_status='classified'),
    'no_good_match', (SELECT count(*) FROM episode_ai_classifications WHERE classification_status='no_good_match'),
    'too_thin', (SELECT count(*) FROM episode_ai_classifications WHERE classification_status='too_thin'),
    'needs_review', (SELECT count(*) FROM episode_ai_classifications WHERE classification_status='needs_review'),
    'rejected', (SELECT count(*) FROM episode_ai_classifications WHERE classification_status='rejected'),
    'total_processed', (SELECT count(*) FROM episode_ai_classifications),
    'primary_category_distribution', (
      SELECT coalesce(jsonb_object_agg(primary_category, c), '{}'::jsonb) FROM (
        SELECT primary_category, count(*) AS c FROM episode_ai_classifications
        WHERE classification_status='classified' AND primary_category IS NOT NULL
        GROUP BY primary_category
      ) x
    ),
    'last_run_at', (SELECT max(updated_at) FROM episode_ai_classifications)
  );
$$;

CREATE OR REPLACE FUNCTION public.select_classifier_candidates(
  p_limit integer DEFAULT 100,
  p_taxonomy_version text DEFAULT 'v1'
)
RETURNS TABLE(episode_id uuid, podcast_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.id, e.podcast_id
  FROM episodes e
  JOIN podcasts p ON p.id = e.podcast_id
  LEFT JOIN episode_ai_classifications c
    ON c.episode_id = e.id AND c.taxonomy_version = p_taxonomy_version
  WHERE p.is_hungarian = true
    AND p.language_decision = 'accept_hungarian'
    AND c.id IS NULL
    AND e.ai_summary IS NOT NULL
    AND p.rank_label IN ('S','A','B','C')
  ORDER BY
    CASE p.rank_label WHEN 'S' THEN 1 WHEN 'A' THEN 2 WHEN 'B' THEN 3 ELSE 4 END,
    e.published_at DESC NULLS LAST
  LIMIT p_limit;
$$;