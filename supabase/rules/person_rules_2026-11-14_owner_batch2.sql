-- Owner batch 2 (2026-11-14 22:24 UTC): source metadata for live show-host rules + explicit episode-credit rules.
-- Data only; idempotent (ON CONFLICT / guarded UPDATE). Applied with supabase--run_sql.

-- 1) Show-host rules already live: owner-checked sources, exact quotes, hash, verification time.
UPDATE public.person_host_rules h SET source_url = v.url, source_quote = v.quote, provenance = 'owner_and_publisher', owner_confirmed = true,
  source_hash = md5(v.url || '|' || v.quote), verified_at = '2026-11-14 22:24:00+00', notes = v.notes
FROM (VALUES
  ('7terito-tilos-radio-podcast', 'https://tilos.hu/show/7terito',
   'A 7térítő a Tilos Rádió hétfő reggeli közéleti típusú kibeszélő műsora. Vé Ügynök, dr. bzmg, DubSmile és Melyik Feri a házban',
   'Show roster role on this feed only; not proof of speaking in every episode since 2007. DubSmile has no catalog profile/pairs.'),
  ('haza-es-haladas-tilos-radio-podcast', 'https://tilos.hu/show/haza-es-haladas',
   '1996-ban alapította Bojtár B. Endre, Czabán György, Pálos György és Végső Zoltán.',
   'Show roster (founders) on this feed; Végső Zoltán has no host pairs on this show, so no rule.'),
  ('kaoszkapitany-kalandjai-a-szemlelodes-osvenyen-tilos-radio-podcast', 'https://tilos.hu/show/kaoszkapitany-kalandjai',
   'Káoszkapitány kalandjai a szemlélődés ösvényén – Káosz Kapitány a műsor készítője (Tilos hivatalos műsorprofil).',
   'Show roster credit; never replaces the named performer of a guest mix.'),
  ('csukas-meseradio', 'https://anchor.fm/s/faf63b28/podcast/rss',
   'Mikó István műsorvezetésével szombat délelőtt hallható a Csukás Meseposta című interaktív műsor a Csukás Meserádióban.',
   'Only titles containing "Csukás Meseposta" (collection channel; no blanket rule).'),
  ('partizan', 'https://media.rss.com/partizan-podcast/feed.xml',
   'Nincs az a komment, ami felérne egy kézfogással ❌ Vétó Ruff Bálinttal és Vida Kamillával #87 — A személyes találkozások fontosságáról beszélgetett Ruff Bálint és Vida Kamilla. #91: Véget ért ... a Vétó utolsó adása ... Bálint és Kamilla értékeli...',
   'Only titles with the whole word Vétó ("A Vétón túl" excluded); never the whole Partizán channel.')
) v(slug, url, quote, notes)
JOIN public.podcasts p ON p.slug = v.slug
WHERE h.podcast_id = p.id AND h.role_type = 'host' AND (h.source_hash IS DISTINCT FROM md5(v.url || '|' || v.quote) OR NOT h.owner_confirmed);

UPDATE public.person_host_rules h SET notes = 'Show roster only (A labda [SZÖGLETES], FanTTasy etc. are sub-shows); an episode appearance comes only from the episode''s 🗣️ speaker list (episode-credit rule tt-extra:speaker-list).',
  owner_confirmed = true, verified_at = '2026-11-14 22:24:00+00'
FROM public.podcasts p WHERE p.slug = 'tt-extra' AND h.podcast_id = p.id AND NOT h.owner_confirmed;

-- 2) Explicit episode-credit rules. Every pattern starts with a non-greedy quantifier: in PostgreSQL the first quantifier sets the
--    greediness of the whole RE, and a greedy capture swallowed the author (Szerző) or later names.
INSERT INTO public.person_episode_credit_rules (rule_key, podcast_id, title_pattern, credit_pattern, credit_role, match_action, correct_feed_credits,
  feed_credit_person_ids, anchor_person_ids, source_url, source_quote, source_hash, provenance, owner_confirmed, verified_at, notes)
SELECT v.rule_key, p.id, v.title_pattern, v.credit_pattern, v.role, 'accept_participant', v.correct, v.feed::uuid[], v.anchors::uuid[],
  p.rss_url, v.quote, md5(p.rss_url || '|' || v.credit_pattern || '|' || v.quote), v.prov, v.owner, '2026-11-14 22:24:00+00', v.notes
FROM (VALUES
  ('csukas-meseradio', 'csukas-meseradio:esti-mese:meselo', '^\s*Esti mese', 'Mesélő:\s*?(.{3,80}?)\s*?\.?\s*?(?:A történetmesélés|$)', 'narrator', true,
   '{d41e4b7e-d809-4d04-bb2f-2f2a5b9c000e,fa69c5c5-d649-4af2-a0f4-2095e9723042,9cf35360-0c62-4bca-92a7-2710dfabd834,579c2893-18b4-4eb1-92d0-30275ed754b0}',
   '{d41e4b7e-d809-4d04-bb2f-2f2a5b9c000e,fa69c5c5-d649-4af2-a0f4-2095e9723042,9cf35360-0c62-4bca-92a7-2710dfabd834,579c2893-18b4-4eb1-92d0-30275ed754b0,37802a25-94ec-4838-b8ad-e9981e9d6491}',
   'Esti mese epizódleírás eleje: "Mesélő: Morvai Noémi." / "Mesélő: Banner Géza."', 'owner_and_publisher', true,
   'Narrator only from the Mesélő field (never the tale author); other RSS host-field credits on these episodes are corrected.'),
  ('csukas-meseradio', 'csukas-meseradio:petra-mese:eloado', '^\s*Petra mese', 'Előadó:\s*?(.{3,40}?)\s*?(?:,|Szerző|$)', 'performer', true,
   '{d41e4b7e-d809-4d04-bb2f-2f2a5b9c000e,fa69c5c5-d649-4af2-a0f4-2095e9723042,9cf35360-0c62-4bca-92a7-2710dfabd834,579c2893-18b4-4eb1-92d0-30275ed754b0}',
   '{37802a25-94ec-4838-b8ad-e9981e9d6491}',
   'Petra mese epizódleírás: "Előadó: Gubik Petra Szerző: Gévai Csilla"', 'publisher_episode', false,
   'Performer only from the Előadó field; Szerző (author) is never an appearance.'),
  ('csukas-meseradio', 'csukas-meseradio:meseora:vendeg', 'Csukás Meseóra', 'vendége volt\s+?(.{3,60}?)\s*?(?:[,–.;]|\s-\s|\s+a\s+Csukás|$)', 'guest', false,
   '{}', '{37802a25-94ec-4838-b8ad-e9981e9d6491}',
   'Csukás Meseóra epizódleírás: "A Petőfi Rádió vendége volt Gubik Petra, a Csukás Meserádió hangja."', 'publisher_episode', false,
   'Guest named in the episode; no feed-credit correction on Meseóra (tales by the regular narrators may be heard).'),
  ('csukas-meseradio', 'csukas-meseradio:meseora:beszelget', 'Meseóra', 'beszélget\s+?(.{3,40}?)\s+?szakértő', 'host', false,
   '{}', '{fa69c5c5-d649-4af2-a0f4-2095e9723042}',
   'Meseóra régi leírás: "családi témákról beszélget Király Kitti szakértőkkel" (később Korcsog Laura; nincs állandó szabály).', 'owner_and_publisher', true,
   'Host credit only where the episode text names her; no permanent Király Kitti rule (host changed to Korcsog Laura).'),
  ('a-reformatus-podcast', 'a-reformatus-podcast:igeido:igehirdeto', '^\s*Igeidő', 'igeszakaszról\s+?(.{3,60}?)\s*?,?\s+?az?\s', 'preacher', true,
   '{0a81c75a-76a7-4c27-b60b-ff9b2c0379af,04559bd4-4770-4faf-b030-95ce24de63b4,1ca6abce-84d2-41e8-a573-97d18004a08e,20139394-0fe5-49ff-8907-258299f44a80}',
   '{0a81c75a-76a7-4c27-b60b-ff9b2c0379af,04559bd4-4770-4faf-b030-95ce24de63b4,1ca6abce-84d2-41e8-a573-97d18004a08e,20139394-0fe5-49ff-8907-258299f44a80}',
   'Igeidő: "A mai bibliai igeszakaszról Bakos Istvánt ... lelkipásztorát hallják."', 'owner_and_publisher', true,
   'The four hosts-field names appear only in their own Igeidő; RSS-author credits on other preachers'' episodes are corrected, never accepted as show hosts.'),
  ('tt-extra', 'tt-extra:speaker-list', NULL, '(🗣.*?)(?:📘|$)', 'speaker', false,
   '{}', '{b103fec6-c560-4378-943d-dbc90f1e0dd9,277b8fed-8886-4dbf-8c26-1c92fda9f5e4,672dc4d5-cd04-4dfc-8ab5-a40f53c3da18}',
   'TT Extra epizódleírás vége: "🗣️ Haraszti Ádám 🗣️ Brodarics Tamás ..." / "🗣️ Csutak Levente, Bognár Domokos, Vályi Bence"', 'owner_and_publisher', true,
   'Episode speakers only from the 🗣️ list; roster hosts not listed stay show-roster only.')
) v(slug, rule_key, title_pattern, credit_pattern, role, correct, feed, anchors, quote, prov, owner, notes)
JOIN public.podcasts p ON p.slug = v.slug
ON CONFLICT (rule_key) DO UPDATE SET credit_pattern = EXCLUDED.credit_pattern, source_hash = EXCLUDED.source_hash
  WHERE person_episode_credit_rules.credit_pattern IS DISTINCT FROM EXCLUDED.credit_pattern;
