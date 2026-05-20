
-- Add topic-only / persona flags for people who are subjects/mentions in HU podcasts
-- but never participate themselves (e.g. Elon Musk, Donald Trump, Putin).

ALTER TABLE public.people
  ADD COLUMN IF NOT EXISTS persona text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS is_topic_only boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS topic_figure_seeded boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS topic_figure_origin text;

-- persona allowed: 'unknown' | 'participant' | 'topic_figure' | 'historical' | 'mixed'
ALTER TABLE public.people
  DROP CONSTRAINT IF EXISTS people_persona_chk;
ALTER TABLE public.people
  ADD CONSTRAINT people_persona_chk
  CHECK (persona IN ('unknown','participant','topic_figure','historical','mixed'));

CREATE INDEX IF NOT EXISTS idx_people_persona ON public.people(persona) WHERE persona <> 'unknown';
CREATE INDEX IF NOT EXISTS idx_people_is_topic_only ON public.people(is_topic_only) WHERE is_topic_only = true;

-- Recompute helper:
--  * is_topic_only = TRUE  when participant_count = 0 AND (subject_count + mention_count) >= 2
--  * persona derived from counts + historical flag + manual seed
CREATE OR REPLACE FUNCTION public.recompute_person_persona_flags()
RETURNS TABLE(updated_count int, topic_only_count int, topic_figure_count int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated int;
  v_topic_only int;
  v_topic_figure int;
BEGIN
  WITH upd AS (
    UPDATE public.people p
    SET
      is_topic_only = (
        COALESCE(p.participant_count,0) = 0
        AND (COALESCE(p.subject_count,0) + COALESCE(p.mention_count,0)) >= 2
      ),
      persona = CASE
        -- Manual seed always wins (don't downgrade seeded topic figures even if 1 participant appears, unless many)
        WHEN p.topic_figure_seeded = true AND COALESCE(p.participant_count,0) < 3 THEN 'topic_figure'
        WHEN p.is_historical = true THEN 'historical'
        WHEN COALESCE(p.participant_count,0) = 0
             AND (COALESCE(p.subject_count,0) + COALESCE(p.mention_count,0)) >= 2 THEN 'topic_figure'
        WHEN COALESCE(p.participant_count,0) >= 1
             AND (COALESCE(p.subject_count,0) + COALESCE(p.mention_count,0)) >= COALESCE(p.participant_count,0) * 3 THEN 'mixed'
        WHEN COALESCE(p.participant_count,0) >= 1 THEN 'participant'
        ELSE 'unknown'
      END,
      updated_at = now()
    WHERE TRUE
    RETURNING p.id, p.is_topic_only, p.persona
  )
  SELECT count(*)::int,
         count(*) FILTER (WHERE is_topic_only)::int,
         count(*) FILTER (WHERE persona = 'topic_figure')::int
    INTO v_updated, v_topic_only, v_topic_figure
  FROM upd;

  RETURN QUERY SELECT v_updated, v_topic_only, v_topic_figure;
END;
$$;

GRANT EXECUTE ON FUNCTION public.recompute_person_persona_flags() TO authenticated, anon;

-- Seed table for international topic figures (curated list, separate from editorial_people_seed
-- which is for HU participants we want to grow). Matching happens by normalized_name.
CREATE TABLE IF NOT EXISTS public.topic_figure_seed (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  normalized_name text NOT NULL UNIQUE,
  aliases text[] NOT NULL DEFAULT '{}',
  origin text,                -- 'us_politics','tech','sports','culture','world_leader' …
  short_label_hu text,        -- chip label e.g. 'amerikai politikus'
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.topic_figure_seed ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "topic_figure_seed admin write" ON public.topic_figure_seed;
CREATE POLICY "topic_figure_seed admin write"
  ON public.topic_figure_seed FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "topic_figure_seed public read" ON public.topic_figure_seed;
CREATE POLICY "topic_figure_seed public read"
  ON public.topic_figure_seed FOR SELECT
  USING (true);

-- Curated seed: international public figures frequently discussed in HU podcasts
-- but who do not appear themselves as guests. Conservative list.
INSERT INTO public.topic_figure_seed (name, normalized_name, aliases, origin, short_label_hu) VALUES
  ('Elon Musk',            'elon musk',            ARRAY['musk'],                       'tech',          'tech-vállalkozó'),
  ('Donald Trump',         'donald trump',         ARRAY['trump'],                      'us_politics',   'amerikai politikus'),
  ('Joe Biden',            'joe biden',            ARRAY['biden'],                      'us_politics',   'amerikai politikus'),
  ('Kamala Harris',        'kamala harris',        ARRAY['harris'],                     'us_politics',   'amerikai politikus'),
  ('Barack Obama',         'barack obama',         ARRAY['obama'],                      'us_politics',   'amerikai politikus'),
  ('Hillary Clinton',      'hillary clinton',      ARRAY['clinton'],                    'us_politics',   'amerikai politikus'),
  ('Vlagyimir Putyin',     'vlagyimir putyin',     ARRAY['putin','vladimir putin','putyin'], 'world_leader','orosz elnök'),
  ('Volodimir Zelenszkij', 'volodimir zelenszkij', ARRAY['zelensky','zelenskyy','zelenszkij'], 'world_leader','ukrán elnök'),
  ('Emmanuel Macron',      'emmanuel macron',      ARRAY['macron'],                     'world_leader',  'francia elnök'),
  ('Olaf Scholz',          'olaf scholz',          ARRAY['scholz'],                     'world_leader',  'német kancellár'),
  ('Angela Merkel',        'angela merkel',        ARRAY['merkel'],                     'world_leader',  'volt német kancellár'),
  ('Xi Jinping',           'xi jinping',           ARRAY['hszi csin-ping'],             'world_leader',  'kínai elnök'),
  ('Benjamin Netanjahu',   'benjamin netanjahu',   ARRAY['netanyahu','netanjahu'],      'world_leader',  'izraeli miniszterelnök'),
  ('Recep Tayyip Erdogan', 'recep tayyip erdogan', ARRAY['erdogan','erdoğan'],          'world_leader',  'török elnök'),
  ('Mark Zuckerberg',      'mark zuckerberg',      ARRAY['zuckerberg','zuck'],          'tech',          'tech-vállalkozó'),
  ('Jeff Bezos',           'jeff bezos',           ARRAY['bezos'],                      'tech',          'tech-vállalkozó'),
  ('Bill Gates',           'bill gates',           ARRAY['gates'],                      'tech',          'tech-vállalkozó'),
  ('Steve Jobs',           'steve jobs',           ARRAY['jobs'],                       'tech',          'tech-vállalkozó'),
  ('Sam Altman',           'sam altman',           ARRAY['altman'],                     'tech',          'OpenAI vezető'),
  ('Tim Cook',             'tim cook',             ARRAY['cook'],                       'tech',          'Apple-vezérigazgató'),
  ('Sundar Pichai',        'sundar pichai',        ARRAY['pichai'],                     'tech',          'Google-vezérigazgató'),
  ('Warren Buffett',       'warren buffett',       ARRAY['buffett'],                    'finance',       'amerikai befektető'),
  ('Ray Dalio',            'ray dalio',            ARRAY['dalio'],                      'finance',       'amerikai befektető'),
  ('Cristiano Ronaldo',    'cristiano ronaldo',    ARRAY['ronaldo'],                    'sports',        'portugál labdarúgó'),
  ('Lionel Messi',         'lionel messi',         ARRAY['messi'],                      'sports',        'argentin labdarúgó'),
  ('LeBron James',         'lebron james',         ARRAY['lebron'],                     'sports',        'amerikai kosárlabdázó'),
  ('Taylor Swift',         'taylor swift',         ARRAY['swift'],                      'culture',       'amerikai énekes'),
  ('Beyoncé',              'beyonce',              ARRAY['beyoncé'],                    'culture',       'amerikai énekes'),
  ('Kanye West',           'kanye west',           ARRAY['ye','kanye'],                 'culture',       'amerikai rapper'),
  ('Greta Thunberg',       'greta thunberg',       ARRAY['thunberg'],                   'activist',      'klímaaktivista'),
  ('Pope Francis',         'pope francis',         ARRAY['ferenc pápa','francis pope'], 'world_leader',  'katolikus egyházfő'),
  ('Jordan Peterson',      'jordan peterson',      ARRAY['peterson'],                   'intellectual',  'kanadai pszichológus'),
  ('Yuval Noah Harari',    'yuval noah harari',    ARRAY['harari'],                     'intellectual',  'izraeli történész'),
  ('Joe Rogan',            'joe rogan',            ARRAY['rogan'],                      'media',         'amerikai podcaster'),
  ('Lex Fridman',          'lex fridman',          ARRAY['fridman'],                    'media',         'amerikai podcaster')
ON CONFLICT (normalized_name) DO NOTHING;

-- Match seed → people and flag them.
WITH matched AS (
  UPDATE public.people p
  SET topic_figure_seeded = true,
      topic_figure_origin = s.origin,
      persona = 'topic_figure',
      updated_at = now()
  FROM public.topic_figure_seed s
  WHERE p.normalized_name = s.normalized_name
  RETURNING p.id
)
SELECT count(*) FROM matched;

-- Run the auto-compute now
SELECT * FROM public.recompute_person_persona_flags();
