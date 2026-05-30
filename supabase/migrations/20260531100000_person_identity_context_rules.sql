-- Automatic person-name disambiguation.
-- Same normalized name can represent multiple people. The extractor now uses
-- context buckets for collision-prone Hungarian names, so e.g. an entrepreneur
-- and a sport/lifestyle guest with the same name do not collapse into one page.

CREATE TABLE IF NOT EXISTS public.person_identity_context_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  context_bucket text UNIQUE NOT NULL,
  display_label text NOT NULL,
  normalized_keywords text[] NOT NULL DEFAULT '{}',
  priority integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS people_canonical_identity_key_idx
  ON public.people(canonical_identity_key)
  WHERE canonical_identity_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS people_normalized_context_idx
  ON public.people(normalized_name, disambiguation_context)
  WHERE disambiguation_context IS NOT NULL;

ALTER TABLE public.person_identity_context_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "person_identity_context_rules public read" ON public.person_identity_context_rules;
CREATE POLICY "person_identity_context_rules public read"
  ON public.person_identity_context_rules FOR SELECT
  USING (status = 'active');

DROP POLICY IF EXISTS "person_identity_context_rules admin write" ON public.person_identity_context_rules;
CREATE POLICY "person_identity_context_rules admin write"
  ON public.person_identity_context_rules FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.person_identity_context_rules (
  context_bucket, display_label, normalized_keywords, priority, updated_at
)
VALUES
  ('business', 'üzlet/gazdaság', ARRAY['vallalkozas','cegepites','uzlet','business','startup','marketing','sales','vezetes','gazdasag','penzugy','befektetes','tozsde','ingatlan','kripto'], 10, now()),
  ('sport_lifestyle', 'sport/életmód', ARRAY['sport','foci','futball','labdarugas','edzes','eletmod','fitness','mozgas','teljesitmeny','taplalkozas','crossfit','futas','maraton'], 20, now()),
  ('religion', 'vallás', ARRAY['vallas','hit','biblia','kereszteny','baptista','katolikus','reformatus','gyulekezet','ige','ima','teologia','lelki'], 30, now()),
  ('politics', 'közélet/politika', ARRAY['politika','kozelet','kormany','ellenzek','parlament','valasztas','part','geopolitika','kulpolitika'], 40, now()),
  ('culture', 'kultúra', ARRAY['kultura','film','szinhaz','konyv','irodalom','zene','muveszet','media','popkultura'], 50, now()),
  ('tech', 'technológia', ARRAY['technologia','tech','informatika','szoftver','ai','mi','mesterseges intelligencia','chatgpt','digitalis'], 60, now()),
  ('health', 'egészség', ARRAY['egeszseg','pszichologia','mentalis','terapia','orvos','gyogyitas','parkapcsolat','onismeret'], 70, now())
ON CONFLICT (context_bucket) DO UPDATE
SET display_label = EXCLUDED.display_label,
    normalized_keywords = EXCLUDED.normalized_keywords,
    priority = EXCLUDED.priority,
    status = 'active',
    updated_at = now();

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'person_identity_context_policy',
  jsonb_build_object(
    'version', 'person_identity_context_v1',
    'mode', 'automatic_context_split_for_collision_prone_names',
    'context_table', 'person_identity_context_rules',
    'collision_name_examples', jsonb_build_array('Lakatos Péter', 'Kiss István', 'Nagy Zoltán'),
    'slug_policy', 'base slug for first known identity; context suffix when needed',
    'note', 'Same names are split by normalized_name + context bucket when surname collision risk is high.'
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

UPDATE public.app_settings
SET value = value
  || jsonb_build_object(
    'enabled', true,
    'consecutive_errors', 0,
    'run_person_entity_extractor', true,
    'person_entity_limit', 20000,
    'run_entity_backfill', false,
    'run_organizations_backfill', false,
    'note', '2026-05-31: person identity context split enabled; keep fast lane focused on person canonicalization.'
  ),
  updated_at = now()
WHERE key = 'database_quality_fast_lane';
