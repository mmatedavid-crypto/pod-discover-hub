
-- ============================================================
-- PHASE 1: Person + Topic SEO entity data model
-- ============================================================

-- ---------- PEOPLE ----------
CREATE TABLE IF NOT EXISTS public.people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  normalized_name text NOT NULL,
  short_bio text,
  ai_bio text,
  ai_bio_status text NOT NULL DEFAULT 'pending',
  ai_bio_generated_at timestamptz,
  ai_bio_model text,
  wikipedia_title text,
  wikidata_id text,
  wikipedia_url text,
  image_url text,
  image_storage_path text,
  image_source text,
  image_license text,
  image_license_url text,
  image_author text,
  image_attribution text,
  image_original_url text,
  image_checked_at timestamptz,
  is_public boolean NOT NULL DEFAULT false,
  is_indexable boolean NOT NULL DEFAULT false,
  confidence numeric NOT NULL DEFAULT 0,
  episode_count integer NOT NULL DEFAULT 0,
  podcast_count integer NOT NULL DEFAULT 0,
  latest_episode_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_people_normalized_name ON public.people(normalized_name);
CREATE INDEX IF NOT EXISTS idx_people_public_indexable ON public.people(is_public, is_indexable);
CREATE INDEX IF NOT EXISTS idx_people_latest_episode ON public.people(latest_episode_at DESC NULLS LAST);
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "people public read" ON public.people FOR SELECT USING (true);
CREATE POLICY "people admin write" ON public.people FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.person_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  source text,
  confidence numeric NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(person_id, normalized_alias)
);
CREATE INDEX IF NOT EXISTS idx_person_aliases_norm ON public.person_aliases(normalized_alias);
ALTER TABLE public.person_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "person_aliases public read" ON public.person_aliases FOR SELECT USING (true);
CREATE POLICY "person_aliases admin write" ON public.person_aliases FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.person_episode_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  mention_type text NOT NULL DEFAULT 'mentioned',
  confidence numeric NOT NULL DEFAULT 0,
  evidence text,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(person_id, episode_id, mention_type)
);
CREATE INDEX IF NOT EXISTS idx_pem_person ON public.person_episode_mentions(person_id);
CREATE INDEX IF NOT EXISTS idx_pem_episode ON public.person_episode_mentions(episode_id);
CREATE INDEX IF NOT EXISTS idx_pem_podcast ON public.person_episode_mentions(podcast_id);
ALTER TABLE public.person_episode_mentions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pem public read" ON public.person_episode_mentions FOR SELECT USING (true);
CREATE POLICY "pem admin write" ON public.person_episode_mentions FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.person_podcast_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'mentioned',
  confidence numeric NOT NULL DEFAULT 0,
  episode_count integer NOT NULL DEFAULT 0,
  latest_episode_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(person_id, podcast_id, role)
);
CREATE INDEX IF NOT EXISTS idx_ppm_person ON public.person_podcast_map(person_id);
CREATE INDEX IF NOT EXISTS idx_ppm_podcast ON public.person_podcast_map(podcast_id);
ALTER TABLE public.person_podcast_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ppm public read" ON public.person_podcast_map FOR SELECT USING (true);
CREATE POLICY "ppm admin write" ON public.person_podcast_map FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.entity_extraction_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_type text NOT NULL DEFAULT 'people',
  status text NOT NULL DEFAULT 'running',
  scanned_episode_count integer NOT NULL DEFAULT 0,
  extracted_person_count integer NOT NULL DEFAULT 0,
  created_person_count integer NOT NULL DEFAULT 0,
  updated_person_count integer NOT NULL DEFAULT 0,
  error_message text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
ALTER TABLE public.entity_extraction_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "eer public read" ON public.entity_extraction_runs FOR SELECT USING (true);
CREATE POLICY "eer admin write" ON public.entity_extraction_runs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ---------- GENERIC ENTITIES (orgs/places — internal only for now) ----------
CREATE TABLE IF NOT EXISTS public.entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL,
  name text NOT NULL,
  slug text NOT NULL,
  normalized_name text NOT NULL,
  wikidata_id text,
  is_public boolean NOT NULL DEFAULT false,
  is_indexable boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  episode_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, slug)
);
CREATE INDEX IF NOT EXISTS idx_entities_type_norm ON public.entities(entity_type, normalized_name);
ALTER TABLE public.entities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "entities public read" ON public.entities FOR SELECT USING (true);
CREATE POLICY "entities admin write" ON public.entities FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ---------- TOPICS ----------
CREATE TABLE IF NOT EXISTS public.topics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  short_name text,
  description text,
  seo_title text,
  seo_description text,
  h1 text,
  intro_text text,
  parent_topic_id uuid REFERENCES public.topics(id) ON DELETE SET NULL,
  topic_type text NOT NULL DEFAULT 'seo',
  priority integer NOT NULL DEFAULT 100,
  is_public boolean NOT NULL DEFAULT true,
  is_indexable boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  episode_count integer NOT NULL DEFAULT 0,
  podcast_count integer NOT NULL DEFAULT 0,
  domain text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_topics_domain ON public.topics(domain);
CREATE INDEX IF NOT EXISTS idx_topics_public_indexable ON public.topics(is_public, is_indexable);
ALTER TABLE public.topics ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topics public read" ON public.topics FOR SELECT USING (true);
CREATE POLICY "topics admin write" ON public.topics FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.topic_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  alias text NOT NULL,
  normalized_alias text NOT NULL,
  weight integer NOT NULL DEFAULT 1,
  UNIQUE(topic_id, normalized_alias)
);
CREATE INDEX IF NOT EXISTS idx_topic_aliases_norm ON public.topic_aliases(normalized_alias);
ALTER TABLE public.topic_aliases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "topic_aliases public read" ON public.topic_aliases FOR SELECT USING (true);
CREATE POLICY "topic_aliases admin write" ON public.topic_aliases FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.episode_topic_map (
  episode_id uuid NOT NULL REFERENCES public.episodes(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  confidence numeric NOT NULL DEFAULT 0.5,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (episode_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_etm_topic ON public.episode_topic_map(topic_id);
ALTER TABLE public.episode_topic_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "etm public read" ON public.episode_topic_map FOR SELECT USING (true);
CREATE POLICY "etm admin write" ON public.episode_topic_map FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE IF NOT EXISTS public.podcast_topic_map (
  podcast_id uuid NOT NULL REFERENCES public.podcasts(id) ON DELETE CASCADE,
  topic_id uuid NOT NULL REFERENCES public.topics(id) ON DELETE CASCADE,
  confidence numeric NOT NULL DEFAULT 0.5,
  source text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (podcast_id, topic_id)
);
CREATE INDEX IF NOT EXISTS idx_ptm_topic ON public.podcast_topic_map(topic_id);
ALTER TABLE public.podcast_topic_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ptm public read" ON public.podcast_topic_map FOR SELECT USING (true);
CREATE POLICY "ptm admin write" ON public.podcast_topic_map FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- ---------- STORAGE: entity-images bucket ----------
INSERT INTO storage.buckets (id, name, public)
VALUES ('entity-images', 'entity-images', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "entity-images public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'entity-images');

CREATE POLICY "entity-images admin write"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'entity-images' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "entity-images admin update"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'entity-images' AND has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "entity-images admin delete"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'entity-images' AND has_role(auth.uid(), 'admin'::app_role));

-- ---------- updated_at triggers ----------
CREATE OR REPLACE FUNCTION public.tg_set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS people_updated_at ON public.people;
CREATE TRIGGER people_updated_at BEFORE UPDATE ON public.people
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS topics_updated_at ON public.topics;
CREATE TRIGGER topics_updated_at BEFORE UPDATE ON public.topics
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

DROP TRIGGER IF EXISTS entities_updated_at ON public.entities;
CREATE TRIGGER entities_updated_at BEFORE UPDATE ON public.entities
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- ---------- SEED TOPICS ----------
-- Domains: economy, business, tech, politics, psychology, health, culture, knowledge, sport, spirituality, society
INSERT INTO public.topics (slug, name, short_name, domain, seo_title, seo_description, h1, intro_text, priority, sort_order, topic_type) VALUES
-- Economy / pénz
('magyar-gazdasag','Magyar gazdaság','Gazdaság','economy','Magyar gazdaság podcastok és epizódok | Podiverzum','Magyar gazdasággal foglalkozó podcast epizódok, beszélgetések és elemzések egy helyen.','Magyar gazdaság podcastok magyarul','Friss magyar podcast epizódok a hazai gazdaságról: infláció, MNB, költségvetés, vállalati helyzetkép.',95,10,'seo'),
('gazdasag','Gazdaság','Gazdaság','economy','Gazdaság podcastok magyarul | Podiverzum','Hazai és nemzetközi gazdasági témájú magyar podcast epizódok.','Gazdaság podcastok','Magyar nyelvű gazdasági beszélgetések, elemzések és interjúk.',90,11,'seo'),
('penzugy','Pénzügy','Pénzügy','economy','Pénzügyi podcastok magyarul | Podiverzum','Pénzügyi témájú magyar podcast epizódok: megtakarítás, befektetés, hitelek.','Pénzügyi podcastok','Magyar pénzügyi podcastok megtakarításról, befektetésről és személyes pénzügyekről.',90,12,'seo'),
('befektetes','Befektetés','Befektetés','economy','Befektetési podcastok magyarul | Podiverzum','Befektetési stratégiák, részvények, ETF-ek magyar podcast epizódokban.','Befektetési podcastok magyarul','Magyar podcast epizódok a befektetésről: részvények, ETF, állampapír, ingatlan.',95,13,'seo'),
('tozsde','Tőzsde','Tőzsde','economy','Tőzsde podcastok magyarul | Podiverzum','Magyar tőzsdei elemzések, részvényhírek és piaci beszélgetések.','Tőzsde podcastok','Magyar tőzsde, BÉT, OTP, MOL és nemzetközi piacok podcastokban.',88,14,'seo'),
('allampapir','Állampapír','Állampapír','economy','Állampapír podcastok magyarul | Podiverzum','MÁP+, PMÁP és lakossági állampapírok magyar podcast epizódokban.','Állampapír podcastok','Magyar podcastok az állampapírokról: MÁP+, PMÁP, hozamok.',92,15,'seo'),
('kripto','Kripto','Kripto','economy','Kripto podcastok magyarul | Podiverzum','Bitcoin, Ethereum és kriptopénz témájú magyar podcast epizódok.','Kripto podcastok magyarul','Magyar nyelvű beszélgetések a kriptopiacról.',85,16,'seo'),
('ingatlan','Ingatlan','Ingatlan','economy','Ingatlan podcastok magyarul | Podiverzum','Magyar ingatlanpiac, lakásárak, bérleti díjak podcastokban.','Ingatlan podcastok','Hazai ingatlanpiaci elemzések és beszélgetések.',85,17,'seo'),
('makrogazdasag','Makrogazdaság','Makró','economy','Makrogazdaság podcastok magyarul | Podiverzum','Makrogazdasági folyamatok, GDP, infláció magyar podcastokban.','Makrogazdaság podcastok','Globális és magyar makrogazdasági elemzések.',80,18,'seo'),
('inflacio','Infláció','Infláció','economy','Infláció podcastok magyarul | Podiverzum','Magyar infláció, áremelkedés és reálbér témájú podcast epizódok.','Infláció podcastok','Magyar nyelvű beszélgetések az inflációról és a vásárlóerőről.',82,19,'seo'),
('mnb','MNB','MNB','economy','Magyar Nemzeti Bank podcastok | Podiverzum','MNB kamatdöntés, monetáris politika magyar podcastokban.','MNB podcastok','Magyar Nemzeti Bank, kamat és monetáris politika.',75,20,'seo'),
('adozas','Adózás','Adózás','economy','Adózás podcastok magyarul | Podiverzum','SZJA, KATA, áfa és vállalati adózás magyar podcastokban.','Adózás podcastok','Magyar adózási útmutató, KATA, SZJA, áfa podcastokban.',78,21,'seo'),
-- Business
('vallalkozas','Vállalkozás','Vállalkozás','business','Vállalkozói podcastok magyarul | Podiverzum','Vállalkozóknak szóló magyar podcast epizódok és interjúk.','Vállalkozói podcastok magyarul','Magyar vállalkozók sztorijai, tanulságai és gyakorlati tippek.',95,30,'seo'),
('cegepites','Cégépítés','Cégépítés','business','Cégépítés podcastok magyarul | Podiverzum','Cégépítés, skálázás és kilépés magyar podcastokban.','Cégépítés podcastok','Magyar cégépítési sztorik, growth és exit.',82,31,'seo'),
('marketing','Marketing','Marketing','business','Marketing podcastok magyarul | Podiverzum','Marketing, brand és kommunikáció magyar podcastokban.','Marketing podcastok magyarul','Magyar marketinges beszélgetések brandről, kreatívról és növekedésről.',88,32,'seo'),
('online-marketing','Online marketing','Online marketing','business','Online marketing podcastok magyarul | Podiverzum','SEO, Google Ads, közösségi média magyar podcastokban.','Online marketing podcastok','SEO, fizetett hirdetés és tartalommarketing magyarul.',85,33,'seo'),
('sales','Sales','Sales','business','Sales podcastok magyarul | Podiverzum','Értékesítés és B2B sales magyar podcastokban.','Sales podcastok','Magyar nyelvű értékesítési és sales beszélgetések.',78,34,'seo'),
('startup','Startup','Startup','business','Startup podcastok magyarul | Podiverzum','Magyar startup ökoszisztéma, alapítói sztorik és VC.','Startup podcastok magyarul','Magyar startup interjúk, kockázati tőke és skálázás.',90,35,'seo'),
('vezetes','Vezetés','Vezetés','business','Vezetés podcastok magyarul | Podiverzum','Leadership, csapatépítés és vezetői fejlődés magyarul.','Vezetés podcastok','Magyar vezetői beszélgetések leadershipről és menedzsmentről.',82,36,'seo'),
('generaciovaltas','Generációváltás','Generációváltás','business','Generációváltás podcastok | Podiverzum','Családi cégek generációváltása magyar podcastokban.','Generációváltás podcastok','Családi cégek és generációváltási sztorik.',70,37,'seo'),
('mesterseges-intelligencia-uzletben','MI az üzletben','MI az üzletben','business','MI az üzletben podcastok magyarul | Podiverzum','Mesterséges intelligencia üzleti alkalmazása magyar podcastokban.','MI az üzletben podcastok','Hogyan használják a cégek a mesterséges intelligenciát.',80,38,'seo'),
-- Tech / AI
('mesterseges-intelligencia','Mesterséges intelligencia','MI','tech','Mesterséges intelligencia podcastok magyarul | Podiverzum','MI, ChatGPT, gépi tanulás magyar podcast epizódokban.','Mesterséges intelligencia podcastok magyarul','Magyar nyelvű podcastok a mesterséges intelligenciáról és hatásairól.',98,40,'seo'),
('ai','AI','AI','tech','AI podcastok magyarul | Podiverzum','AI, LLM és generatív modellek magyar podcastokban.','AI podcastok','Magyar AI beszélgetések szakértőkkel.',95,41,'seo'),
('technologia','Technológia','Tech','tech','Technológia podcastok magyarul | Podiverzum','Tech, IT és digitális trendek magyar podcastokban.','Technológia podcastok magyarul','Magyar tech beszélgetések trendekről, eszközökről, szoftverekről.',92,42,'seo'),
('digitalizacio','Digitalizáció','Digitalizáció','tech','Digitalizáció podcastok magyarul | Podiverzum','Vállalati digitális transzformáció magyar podcastokban.','Digitalizáció podcastok','Magyar nyelvű beszélgetések a digitális transzformációról.',75,43,'seo'),
('kiberbiztonsag','Kiberbiztonság','Kiberbiztonság','tech','Kiberbiztonság podcastok magyarul | Podiverzum','IT biztonság, adatvédelem és kiberbűnözés magyar podcastokban.','Kiberbiztonság podcastok','Magyar IT biztonsági beszélgetések.',82,44,'seo'),
('startup-tech','Startup tech','Startup tech','tech','Startup tech podcastok magyarul | Podiverzum','Tech startupok és termékfejlesztés magyar podcastokban.','Startup tech podcastok','Magyar tech startupok és termékfejlesztés.',75,45,'seo'),
('szoftver','Szoftverfejlesztés','Szoftver','tech','Szoftverfejlesztés podcastok magyarul | Podiverzum','Szoftverfejlesztés, programozás magyar podcastokban.','Szoftverfejlesztés podcastok','Magyar fejlesztői beszélgetések kódról és architektúráról.',85,46,'seo'),
('adat','Adat','Adat','tech','Adat podcastok magyarul | Podiverzum','Data, analitika és BI magyar podcast epizódokban.','Adat podcastok','Magyar adat- és analitikai beszélgetések.',70,47,'seo'),
('robotika','Robotika','Robotika','tech','Robotika podcastok magyarul | Podiverzum','Robotika és automatizálás magyar podcastokban.','Robotika podcastok','Magyar nyelvű beszélgetések robotikáról.',65,48,'seo'),
-- Politics
('magyar-politika','Magyar politika','Politika','politics','Magyar politika podcastok | Podiverzum','Magyar belpolitika, választások és kormányzat podcastokban.','Magyar politika podcastok','Magyar belpolitikai elemzések és beszélgetések.',95,50,'seo'),
('kozelet','Közélet','Közélet','politics','Közélet podcastok magyarul | Podiverzum','Közéleti témák magyar podcast epizódokban.','Közélet podcastok','Magyar közéleti beszélgetések és elemzések.',88,51,'seo'),
('valasztas','Választás','Választás','politics','Választás podcastok magyarul | Podiverzum','Magyar és nemzetközi választások podcastokban.','Választás podcastok','Választási kampányok, eredmények, elemzések magyarul.',82,52,'seo'),
('kormany','Kormány','Kormány','politics','Kormány podcastok magyarul | Podiverzum','Magyar kormány döntései és politikája podcastokban.','Kormány podcastok','Magyar kormányzati döntések elemzése.',78,53,'seo'),
('ellenzek','Ellenzék','Ellenzék','politics','Ellenzék podcastok magyarul | Podiverzum','Magyar ellenzéki politika podcast epizódokban.','Ellenzék podcastok','Magyar ellenzéki pártok és politikusok podcastokban.',72,54,'seo'),
('kulpolitika','Külpolitika','Külpolitika','politics','Külpolitika podcastok magyarul | Podiverzum','Magyar és nemzetközi külpolitika podcastokban.','Külpolitika podcastok','Külpolitikai elemzések magyar podcastokban.',82,55,'seo'),
('ukrajna-oroszorszag','Ukrajna–Oroszország','Ukrajna–Oroszország','politics','Ukrajna–Oroszország podcastok | Podiverzum','Ukrán–orosz háború és geopolitika magyar podcastokban.','Ukrajna–Oroszország podcastok','Az orosz–ukrán háború elemzése magyar podcastokban.',85,56,'seo'),
('europai-unio','Európai Unió','EU','politics','Európai Unió podcastok magyarul | Podiverzum','EU politika, intézmények és Magyarország magyar podcastokban.','Európai Unió podcastok','Magyar EU-s politikai elemzések.',78,57,'seo'),
('nato','NATO','NATO','politics','NATO podcastok magyarul | Podiverzum','NATO, biztonságpolitika magyar podcastokban.','NATO podcastok','NATO és magyar biztonságpolitika podcastokban.',70,58,'seo'),
('haboru','Háború','Háború','politics','Háború podcastok magyarul | Podiverzum','Háborúk, konfliktusok elemzése magyar podcastokban.','Háború podcastok','Háborús konfliktusok elemzése magyar podcastokban.',75,59,'seo'),
-- Psychology
('pszichologia','Pszichológia','Pszichológia','psychology','Pszichológia podcastok magyarul | Podiverzum','Pszichológiai témák magyar podcast epizódokban.','Pszichológia podcastok magyarul','Magyar pszichológiai beszélgetések szakértőkkel.',95,70,'seo'),
('onismeret','Önismeret','Önismeret','psychology','Önismeret podcastok magyarul | Podiverzum','Önismeret és személyes fejlődés magyar podcastokban.','Önismeret podcastok','Magyar önismereti beszélgetések.',88,71,'seo'),
('mentalis-egeszseg','Mentális egészség','Mentális egészség','psychology','Mentális egészség podcastok magyarul | Podiverzum','Mentális egészség és terápia magyar podcastokban.','Mentális egészség podcastok','Magyar mentálhigiénés beszélgetések.',90,72,'seo'),
('trauma','Trauma','Trauma','psychology','Trauma podcastok magyarul | Podiverzum','Trauma feldolgozás magyar podcastokban.','Trauma podcastok','Magyar nyelvű beszélgetések traumáról és feldolgozásáról.',75,73,'seo'),
('parkapcsolat','Párkapcsolat','Párkapcsolat','psychology','Párkapcsolat podcastok magyarul | Podiverzum','Párkapcsolatok és kommunikáció magyar podcastokban.','Párkapcsolat podcastok magyarul','Magyar párkapcsolati beszélgetések.',92,74,'seo'),
('csalad','Család','Család','psychology','Család podcastok magyarul | Podiverzum','Családi élet és kapcsolatok magyar podcastokban.','Család podcastok','Magyar családi témájú beszélgetések.',82,75,'seo'),
('gyerekneveles','Gyereknevelés','Gyereknevelés','psychology','Gyereknevelés podcastok magyarul | Podiverzum','Gyereknevelési tippek és pszichológia magyar podcastokban.','Gyereknevelés podcastok magyarul','Magyar gyereknevelési podcastok szülőknek.',85,76,'seo'),
('nok','Nők','Nők','psychology','Női témájú podcastok magyarul | Podiverzum','Női témák és perspektívák magyar podcastokban.','Női témájú podcastok','Magyar női hangok podcastokban.',70,77,'seo'),
('ferfiak','Férfiak','Férfiak','psychology','Férfi témájú podcastok magyarul | Podiverzum','Férfi témák és férfiasság magyar podcastokban.','Férfi témájú podcastok','Magyar férfiakról szóló beszélgetések.',65,78,'seo'),
('eletmodvaltas','Életmódváltás','Életmódváltás','psychology','Életmódváltás podcastok magyarul | Podiverzum','Életmód- és szokásváltás magyar podcastokban.','Életmódváltás podcastok','Magyar nyelvű életmódváltási beszélgetések.',78,79,'seo'),
-- Health
('egeszseg','Egészség','Egészség','health','Egészség podcastok magyarul | Podiverzum','Egészséggel foglalkozó magyar podcast epizódok.','Egészség podcastok magyarul','Magyar egészségügyi beszélgetések.',92,90,'seo'),
('egeszseges-eletmod','Egészséges életmód','Egészséges életmód','health','Egészséges életmód podcastok magyarul | Podiverzum','Egészséges életmód magyar podcastokban.','Egészséges életmód podcastok','Magyar életmód- és wellness-beszélgetések.',88,91,'seo'),
('taplalkozas','Táplálkozás','Táplálkozás','health','Táplálkozás podcastok magyarul | Podiverzum','Táplálkozás, diéta magyar podcastokban.','Táplálkozás podcastok magyarul','Magyar dietetikai és táplálkozási beszélgetések.',82,92,'seo'),
('fitness','Fitness','Fitness','health','Fitness podcastok magyarul | Podiverzum','Edzés, erőfejlesztés magyar podcastokban.','Fitness podcastok','Magyar fitness és edzés podcastok.',78,93,'seo'),
('sport-egeszseg','Sport és egészség','Sport és egészség','health','Sport és egészség podcastok | Podiverzum','Sport, mozgás és egészség magyar podcastokban.','Sport és egészség podcastok','Magyar sportegészségügyi beszélgetések.',70,94,'seo'),
('alvas','Alvás','Alvás','health','Alvás podcastok magyarul | Podiverzum','Alvás minősége és pihenés magyar podcastokban.','Alvás podcastok','Magyar nyelvű alvás-tudományos beszélgetések.',68,95,'seo'),
('longevity','Longevity','Longevity','health','Longevity podcastok magyarul | Podiverzum','Hosszú élet és anti-aging magyar podcastokban.','Longevity podcastok','Magyar longevity beszélgetések.',65,96,'seo'),
('termeszetes-gyogymodok','Természetes gyógymódok','Természetes gyógymódok','health','Természetes gyógymódok podcastok | Podiverzum','Alternatív és kiegészítő gyógymódok magyar podcastokban.','Természetes gyógymódok podcastok','Magyar nyelvű természetgyógyászati beszélgetések.',60,97,'seo'),
-- Culture
('film','Film','Film','culture','Film podcastok magyarul | Podiverzum','Filmkritika és mozi magyar podcastokban.','Film podcastok magyarul','Magyar filmes beszélgetések, kritikák és ajánlók.',90,110,'seo'),
('sorozatok','Sorozatok','Sorozatok','culture','Sorozat podcastok magyarul | Podiverzum','Sorozatkritika és streaming magyar podcastokban.','Sorozat podcastok magyarul','Magyar sorozatos beszélgetések, kritikák, ajánlók.',85,111,'seo'),
('konyvek','Könyvek','Könyvek','culture','Könyv podcastok magyarul | Podiverzum','Könyvajánló és irodalom magyar podcastokban.','Könyv podcastok magyarul','Magyar könyves beszélgetések, írókkal készült interjúk.',85,112,'seo'),
('popkultura','Popkultúra','Popkultúra','culture','Popkultúra podcastok magyarul | Podiverzum','Popkultúra magyar podcast epizódokban.','Popkultúra podcastok','Magyar popkulturális beszélgetések.',78,113,'seo'),
('zene','Zene','Zene','culture','Zene podcastok magyarul | Podiverzum','Zene, zenekarok, zeneipar magyar podcastokban.','Zene podcastok magyarul','Magyar zenei beszélgetések és interjúk.',82,114,'seo'),
('szinhaz','Színház','Színház','culture','Színház podcastok magyarul | Podiverzum','Színház és előadóművészet magyar podcastokban.','Színház podcastok magyarul','Magyar színházi beszélgetések.',68,115,'seo'),
('media','Média','Média','culture','Média podcastok magyarul | Podiverzum','Média, sajtó, újságírás magyar podcastokban.','Média podcastok','Magyar média- és sajtóbeszélgetések.',72,116,'seo'),
('magyar-kultura','Magyar kultúra','Magyar kultúra','culture','Magyar kultúra podcastok | Podiverzum','Magyar kultúra, művészet, irodalom podcastokban.','Magyar kultúra podcastok','Magyar kulturális beszélgetések.',75,117,'seo'),
-- Knowledge
('tortenelem','Történelem','Történelem','knowledge','Történelem podcastok magyarul | Podiverzum','Magyar és nemzetközi történelem magyar podcastokban.','Történelem podcastok magyarul','Magyar történelmi beszélgetések, dokumentumok, sztorik.',92,130,'seo'),
('tudomany','Tudomány','Tudomány','knowledge','Tudomány podcastok magyarul | Podiverzum','Tudomány és kutatás magyar podcastokban.','Tudomány podcastok magyarul','Magyar tudományos beszélgetések, kutatókkal készült interjúk.',88,131,'seo'),
('oktatas','Oktatás','Oktatás','knowledge','Oktatás podcastok magyarul | Podiverzum','Magyar oktatásügy és pedagógia podcastokban.','Oktatás podcastok','Magyar oktatási beszélgetések.',75,132,'seo'),
('tanulas','Tanulás','Tanulás','knowledge','Tanulás podcastok magyarul | Podiverzum','Tanulás, learning hacks magyar podcastokban.','Tanulás podcastok','Magyar tanulási tippek és módszerek.',70,133,'seo'),
('nyelvtanulas','Nyelvtanulás','Nyelvtanulás','knowledge','Nyelvtanulás podcastok magyarul | Podiverzum','Nyelvtanulási tippek és módszerek magyar podcastokban.','Nyelvtanulás podcastok','Magyar nyelvtanulási podcastok.',72,134,'seo'),
('ismeretterjesztes','Ismeretterjesztés','Ismeretterjesztés','knowledge','Ismeretterjesztő podcastok magyarul | Podiverzum','Ismeretterjesztő magyar podcast epizódok.','Ismeretterjesztő podcastok magyarul','Magyar ismeretterjesztő beszélgetések minden területről.',80,135,'seo'),
-- Sport
('foci','Foci','Foci','sport','Foci podcastok magyarul | Podiverzum','Magyar foci és nemzetközi futball magyar podcastokban.','Foci podcastok magyarul','Magyar focis beszélgetések, mérkőzéselemzések.',92,150,'seo'),
('futball','Futball','Futball','sport','Futball podcastok magyarul | Podiverzum','Magyar és nemzetközi futball podcastokban.','Futball podcastok','Magyar nyelvű futball beszélgetések.',88,151,'seo'),
('forma-1','Forma–1','Forma–1','sport','Forma-1 podcastok magyarul | Podiverzum','Forma-1 magyar podcast epizódokban.','Forma-1 podcastok magyarul','Magyar F1 beszélgetések, futamelemzések.',85,152,'seo'),
('sport','Sport','Sport','sport','Sport podcastok magyarul | Podiverzum','Sport általában magyar podcastokban.','Sport podcastok magyarul','Magyar sportos beszélgetések és interjúk.',85,153,'seo'),
('futas','Futás','Futás','sport','Futás podcastok magyarul | Podiverzum','Futás és állóképesség magyar podcastokban.','Futás podcastok','Magyar nyelvű futás beszélgetések.',70,154,'seo'),
('kosarlabda','Kosárlabda','Kosárlabda','sport','Kosárlabda podcastok magyarul | Podiverzum','Magyar és nemzetközi kosárlabda podcastokban.','Kosárlabda podcastok','Magyar kosárlabda beszélgetések.',68,155,'seo'),
-- Spirituality
('vallas','Vallás','Vallás','spirituality','Vallás podcastok magyarul | Podiverzum','Vallás és hit magyar podcast epizódokban.','Vallás podcastok','Magyar vallási beszélgetések.',72,170,'seo'),
('spiritualitas','Spiritualitás','Spiritualitás','spirituality','Spiritualitás podcastok magyarul | Podiverzum','Spiritualitás és belső út magyar podcastokban.','Spiritualitás podcastok magyarul','Magyar spirituális beszélgetések.',70,171,'seo'),
('keresztenyseg','Kereszténység','Kereszténység','spirituality','Kereszténység podcastok magyarul | Podiverzum','Kereszténység és bibliai téma magyar podcastokban.','Kereszténység podcastok','Magyar keresztény beszélgetések.',68,172,'seo'),
('biblia','Biblia','Biblia','spirituality','Biblia podcastok magyarul | Podiverzum','Bibliamagyarázat és teológia magyar podcastokban.','Biblia podcastok','Magyar bibliai beszélgetések.',60,173,'seo'),
('meditacio','Meditáció','Meditáció','spirituality','Meditáció podcastok magyarul | Podiverzum','Meditáció és mindfulness magyar podcastokban.','Meditáció podcastok','Magyar meditációs beszélgetések.',72,174,'seo'),
-- Society / Crime
('true-crime','True crime','True crime','society','True crime podcastok magyarul | Podiverzum','Magyar true crime podcastok és bűnügyi esetek.','True crime podcastok magyarul','Magyar true crime epizódok és bűnügyi sztorik.',95,190,'seo'),
('bunugy','Bűnügy','Bűnügy','society','Bűnügyi podcastok magyarul | Podiverzum','Bűnügyek és nyomozások magyar podcastokban.','Bűnügyi podcastok','Magyar bűnügyi esetelemzések.',85,191,'seo'),
('tarsadalom','Társadalom','Társadalom','society','Társadalmi podcastok magyarul | Podiverzum','Társadalmi témák magyar podcastokban.','Társadalom podcastok','Magyar társadalmi beszélgetések.',80,192,'seo'),
('jog','Jog','Jog','society','Jogi podcastok magyarul | Podiverzum','Jog, jogi tanácsadás magyar podcastokban.','Jogi podcastok magyarul','Magyar jogi beszélgetések.',72,193,'seo'),
('ugyved','Ügyvéd','Ügyvéd','society','Ügyvéd podcastok magyarul | Podiverzum','Magyar ügyvédek és jogi témák podcastokban.','Ügyvéd podcastok','Magyar ügyvédes beszélgetések.',62,194,'seo'),
('bantalmazo-kapcsolat','Bántalmazó kapcsolat','Bántalmazó kapcsolat','society','Bántalmazó kapcsolat podcastok magyarul | Podiverzum','Bántalmazó kapcsolatok témája magyar podcastokban.','Bántalmazó kapcsolat podcastok','Magyar nyelvű beszélgetések bántalmazó kapcsolatokról.',75,195,'seo')
ON CONFLICT (slug) DO NOTHING;

-- Seed primary alias = topic name (normalized)
INSERT INTO public.topic_aliases (topic_id, alias, normalized_alias, weight)
SELECT id, name, lower(translate(name, 'áéíóöőúüűÁÉÍÓÖŐÚÜŰ', 'aeiooouuuaeiooouuu')), 3
FROM public.topics
ON CONFLICT DO NOTHING;

-- Also add the slug as alias
INSERT INTO public.topic_aliases (topic_id, alias, normalized_alias, weight)
SELECT id, slug, replace(slug, '-', ' '), 2
FROM public.topics
ON CONFLICT DO NOTHING;
