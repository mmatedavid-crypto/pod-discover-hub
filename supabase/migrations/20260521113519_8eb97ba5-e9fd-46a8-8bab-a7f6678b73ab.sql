-- ============================================================
-- ORGANIZATIONS UMBRELLA (companies, parties, institutions, media, ngos)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  normalized_name text NOT NULL,
  org_type text NOT NULL DEFAULT 'company',
  -- Wikidata/Wikipedia enrichment
  wikidata_id text,
  wikipedia_url text,
  wikipedia_title text,
  wikipedia_extract text,
  wikipedia_description text,
  logo_url text,
  logo_source text,
  logo_storage_path text,
  logo_license text,
  logo_attribution text,
  short_description_hu text,
  ai_bio text,
  ai_bio_status text NOT NULL DEFAULT 'pending',
  ai_bio_generated_at timestamptz,
  ai_bio_model text,
  ai_bio_confidence numeric NOT NULL DEFAULT 0,
  -- type-specific
  ticker text,
  sector text,
  country text,
  founded date,
  headquarters text,
  political_color text,
  political_orientation text,
  -- gated counts
  episode_count integer NOT NULL DEFAULT 0,
  gated_episode_count integer NOT NULL DEFAULT 0,
  podcast_count integer NOT NULL DEFAULT 0,
  gated_podcast_count integer NOT NULL DEFAULT 0,
  mention_count integer NOT NULL DEFAULT 0,
  primary_count integer NOT NULL DEFAULT 0,
  latest_episode_at timestamptz,
  -- gating
  is_public boolean NOT NULL DEFAULT false,
  is_indexable boolean NOT NULL DEFAULT false,
  is_browsable_in_hub boolean NOT NULL DEFAULT false,
  browsable_reason text,
  -- enricher state
  wikipedia_match_status text NOT NULL DEFAULT 'unchecked',
  wikipedia_match_confidence numeric NOT NULL DEFAULT 0,
  wikipedia_match_evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  wiki_match_run_at timestamptz,
  wiki_match_reason text,
  -- editorial
  manually_seeded boolean NOT NULL DEFAULT false,
  editorial_priority boolean NOT NULL DEFAULT false,
  editorial_priority_level integer NOT NULL DEFAULT 0,
  editorial_notes text,
  -- timestamps
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_org_type_check CHECK (org_type IN ('company','party','institution','media','ngo','other'))
);

CREATE INDEX IF NOT EXISTS idx_organizations_type ON public.organizations(org_type);
CREATE INDEX IF NOT EXISTS idx_organizations_normalized ON public.organizations(normalized_name);
CREATE INDEX IF NOT EXISTS idx_organizations_public ON public.organizations(is_public, org_type);
CREATE INDEX IF NOT EXISTS idx_organizations_browsable ON public.organizations(is_browsable_in_hub, org_type) WHERE is_browsable_in_hub = true;
CREATE INDEX IF NOT EXISTS idx_organizations_wikipedia_status ON public.organizations(wikipedia_match_status);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "organizations public read" ON public.organizations FOR SELECT USING (true);
CREATE POLICY "organizations admin write" ON public.organizations FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- ALIASES
-- ============================================================

CREATE TABLE IF NOT EXISTS public.organization_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source text,
  confidence numeric NOT NULL DEFAULT 0.5,
  status text NOT NULL DEFAULT 'accepted',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_org_alias_norm ON public.organization_aliases(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_org_alias_org ON public.organization_aliases(organization_id);

ALTER TABLE public.organization_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org_aliases public read" ON public.organization_aliases FOR SELECT USING (true);
CREATE POLICY "org_aliases admin write" ON public.organization_aliases FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- EPISODE ↔ ORGANIZATION MAP
-- ============================================================

CREATE TABLE IF NOT EXISTS public.episode_organization_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id uuid NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  podcast_id uuid,
  role text NOT NULL DEFAULT 'mentioned',
  confidence numeric NOT NULL DEFAULT 0.5,
  source text NOT NULL DEFAULT 'ai',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eom_role_check CHECK (role IN ('primary','mentioned'))
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_eom ON public.episode_organization_map(episode_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_eom_org ON public.episode_organization_map(organization_id);
CREATE INDEX IF NOT EXISTS idx_eom_podcast ON public.episode_organization_map(podcast_id);

ALTER TABLE public.episode_organization_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eom public read" ON public.episode_organization_map FOR SELECT USING (true);
CREATE POLICY "eom admin write" ON public.episode_organization_map FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ============================================================
-- EPISODES — new entity arrays
-- ============================================================

ALTER TABLE public.episodes
  ADD COLUMN IF NOT EXISTS parties text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS institutions text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS media_outlets text[] NOT NULL DEFAULT '{}'::text[];

-- ============================================================
-- RPC: recompute gated counts
-- ============================================================

CREATE OR REPLACE FUNCTION public.recompute_org_gated_counts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH counts AS (
    SELECT
      m.organization_id,
      COUNT(DISTINCT m.episode_id) FILTER (WHERE p.is_hungarian = true) AS gated_eps,
      COUNT(DISTINCT m.podcast_id) FILTER (WHERE p.is_hungarian = true) AS gated_pods,
      COUNT(DISTINCT m.episode_id) AS total_eps,
      COUNT(DISTINCT m.podcast_id) AS total_pods,
      COUNT(*) FILTER (WHERE m.role = 'mentioned') AS mentions,
      COUNT(*) FILTER (WHERE m.role = 'primary') AS primaries,
      MAX(e.published_at) FILTER (WHERE p.is_hungarian = true) AS latest_ep
    FROM public.episode_organization_map m
    JOIN public.episodes e ON e.id = m.episode_id
    LEFT JOIN public.podcasts p ON p.id = COALESCE(m.podcast_id, e.podcast_id)
    GROUP BY m.organization_id
  )
  UPDATE public.organizations o
  SET
    episode_count = COALESCE(c.total_eps, 0),
    gated_episode_count = COALESCE(c.gated_eps, 0),
    podcast_count = COALESCE(c.total_pods, 0),
    gated_podcast_count = COALESCE(c.gated_pods, 0),
    mention_count = COALESCE(c.mentions, 0),
    primary_count = COALESCE(c.primaries, 0),
    latest_episode_at = c.latest_ep,
    is_public = CASE WHEN COALESCE(c.gated_eps, 0) >= 1 OR o.manually_seeded THEN true ELSE false END,
    is_indexable = CASE WHEN COALESCE(c.gated_eps, 0) >= 1 THEN true ELSE false END,
    is_browsable_in_hub = CASE WHEN COALESCE(c.gated_eps, 0) >= 1 THEN true ELSE false END,
    browsable_reason = CASE
      WHEN COALESCE(c.gated_eps, 0) >= 1 THEN 'has_hu_episodes'
      WHEN o.manually_seeded THEN 'editorial_seed'
      ELSE 'no_eps'
    END,
    updated_at = now()
  FROM counts c
  WHERE o.id = c.organization_id;

  -- Zero out orgs with no map rows (kept public only if manually_seeded)
  UPDATE public.organizations o
  SET episode_count = 0, gated_episode_count = 0, podcast_count = 0, gated_podcast_count = 0,
      mention_count = 0, primary_count = 0,
      is_public = o.manually_seeded,
      is_indexable = false,
      is_browsable_in_hub = false,
      browsable_reason = CASE WHEN o.manually_seeded THEN 'editorial_seed' ELSE 'no_eps' END,
      updated_at = now()
  WHERE NOT EXISTS (SELECT 1 FROM public.episode_organization_map m WHERE m.organization_id = o.id);
END;
$$;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.org_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_org_touch ON public.organizations;
CREATE TRIGGER trg_org_touch BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.org_touch_updated_at();