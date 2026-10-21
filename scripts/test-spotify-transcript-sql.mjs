// Isolated PostgreSQL/WASM regression test for migration 0069: Spotify meta
// content-only updated_at, staged Spotify targets, and the internal lexical
// transcript index (rights/class gate, idempotent refresh, strict phrase lookup,
// read-only person evidence, no grants to anon/authenticated). No production connection.
// bun add --cwd /tmp/person-sql-test @electric-sql/pglite
// PGLITE_DIR=/tmp/person-sql-test/node_modules/@electric-sql/pglite/dist node scripts/test-spotify-transcript-sql.mjs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const base = process.env.PGLITE_DIR || '@electric-sql/pglite/dist';
const { PGlite } = await import(`${base}/index.js`);
const { unaccent } = await import(`${base}/contrib/unaccent.js`);

const dir = new URL('../drizzle/migrations/', import.meta.url);
const file = process.env.MIGRATION_FILE
  || new URL((await readdir(dir)).find((f) => /^\d{4}_spotify_source_transcript_lexical_index\.sql$/.test(f)), dir);
const db = new PGlite({ extensions: { unaccent } });
await db.exec(`
 CREATE EXTENSION unaccent;
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
 CREATE TYPE public.app_role AS ENUM ('admin','user');
 CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql AS 'SELECT false';
 CREATE TABLE podcasts(id uuid PRIMARY KEY, language_decision text);
 CREATE TABLE episodes(id uuid PRIMARY KEY, podcast_id uuid, description text);
 CREATE TABLE episode_spotify_meta(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), episode_id uuid UNIQUE, podcast_id uuid,
   spotify_episode_id text, spotify_url text, duration_ms integer, release_date date, release_date_precision text,
   spotify_description text, spotify_html_description text, spotify_image_url_640 text, spotify_image_url_300 text,
   spotify_image_url_64 text, spotify_explicit boolean, audio_preview_url text, spotify_language text, spotify_languages text[],
   is_playable boolean, restrictions jsonb, match_method text, match_confidence numeric, raw jsonb, last_synced_at timestamptz,
   created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
 CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN NEW.updated_at = now(); RETURN NEW; END';
 CREATE TRIGGER trg_episode_spotify_meta_set_updated_at BEFORE UPDATE ON episode_spotify_meta FOR EACH ROW EXECUTE FUNCTION set_updated_at();
 CREATE TABLE episode_transcripts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), episode_id uuid, model text, transcript text,
   content_hash text, status text, rights_status text, public_display boolean DEFAULT false, updated_at timestamptz DEFAULT now());
 CREATE TABLE people(id uuid PRIMARY KEY, name text, identity_ambiguous boolean DEFAULT false);
 CREATE TABLE person_episode_mentions(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), person_id uuid, episode_id uuid,
   relevance_status text, role_type text, mention_type text);
`);
const HU = '33333333-3333-4333-8333-333333333333';
const EN = '55555555-5555-4555-8555-555555555555';
const E = (n) => `0000000${n}-1111-4111-8111-111111111111`;
const long = (extra) => `${'Bevezető beszélgetés a gazdaságról és a hétköznapokról. '.repeat(40)} ${extra} ${'Zárásként a hallgatói kérdésekről volt szó. '.repeat(40)}`;
await db.exec(`
 INSERT INTO podcasts VALUES('${HU}','accept_hungarian'),('${EN}','reject_foreign');
 INSERT INTO episodes VALUES('${E(1)}','${HU}','rövid'),('${E(2)}','${HU}','rövid leírás'),('${E(3)}','${HU}','x'),('${E(4)}','${EN}','x'),('${E(5)}','${HU}','x');
 INSERT INTO episode_spotify_meta(episode_id,podcast_id,spotify_episode_id,spotify_description,match_method,match_confidence,updated_at)
   VALUES('${E(1)}','${HU}','sp1','${'Hosszú érdemi leírás. '.repeat(30)}','name_date',0.95,'2026-01-01'),
         ('${E(2)}','${HU}','sp2','rövid','name_date',0.95,'2026-01-01');
`);
await db.exec(await readFile(file, 'utf8'));

// Spotify meta: a no-op re-sync does not move updated_at; a description change does.
let r = (await db.query(`SELECT updated_at FROM episode_spotify_meta WHERE episode_id=$1`, [E(1)])).rows[0];
const seeded = r.updated_at.toISOString();
assert.equal(seeded.slice(0, 10), '2026-01-01');
await db.exec(`UPDATE episode_spotify_meta SET last_synced_at=now(), spotify_description=spotify_description WHERE episode_id='${E(1)}'`);
r = (await db.query(`SELECT updated_at FROM episode_spotify_meta WHERE episode_id=$1`, [E(1)])).rows[0];
assert.equal(r.updated_at.toISOString(), seeded, 'no-op re-sync must not bump updated_at');
await db.exec(`UPDATE episode_spotify_meta SET spotify_description='Új leírás' WHERE episode_id='${E(1)}'`);
r = (await db.query(`SELECT updated_at FROM episode_spotify_meta WHERE episode_id=$1`, [E(1)])).rows[0];
assert.notEqual(r.updated_at.toISOString(), seeded, 'content change must bump updated_at');

// Staged Spotify targets: only HU rows with ≥300 more chars (seeded before the change above).
const tg = (await db.query(`SELECT episode_id FROM best_source_spotify_targets_v1(NULL, 10)`)).rows.map((x) => x.episode_id);
assert.deepEqual(tg, [E(1)]);

// Transcripts: YouTube caption (index-only) on E1, publisher RSS transcript on E2,
// public-display-forbidden rights on E3 ('unknown' rights), foreign podcast E4, short E5.
await db.exec(`
 INSERT INTO episode_transcripts(episode_id,model,transcript,content_hash,status,rights_status) VALUES
  ('${E(1)}','supadata-youtube','${long('Ma Hajós András volt a vendégünk, aki a lemezéről mesélt.')}','h1','ok','rss_public_index_only'),
  ('${E(2)}','rss_podcast_transcript_tag:text/vtt','${long('Szó esett Miller Andrásról és Hajós Szilárdról is.')}','h2','ok','rss_public_index_only'),
  ('${E(3)}','supadata-youtube','${long('Hajós András titkos adás.')}','h3','ok','unknown'),
  ('${E(4)}','supadata-youtube','${long('Hajós András külföldi adás.')}','h4','ok','rss_public_index_only'),
  ('${E(5)}','supadata-youtube','túl rövid','h5','ok','rss_public_index_only');
 INSERT INTO people VALUES('99999999-9999-4999-8999-999999999991','Hajós András',true),('99999999-9999-4999-8999-999999999992','Madonna',false);
 INSERT INTO person_episode_mentions(person_id,episode_id,relevance_status,role_type) VALUES
  ('99999999-9999-4999-8999-999999999991','${E(1)}','pending','guest'),
  ('99999999-9999-4999-8999-999999999991','${E(2)}','pending','mention'),
  ('99999999-9999-4999-8999-999999999992','${E(1)}','rejected','mention');
`);
const targets = (await db.query(`SELECT episode_id FROM transcript_lexical_index_targets_v1(50)`)).rows.map((x) => x.episode_id).sort();
assert.deepEqual(targets, [E(1), E(2)], 'only HU, index-allowed rights, ≥900 chars');

const ids = `ARRAY['${E(1)}','${E(2)}','${E(3)}','${E(4)}','${E(5)}']::uuid[]`;
// Class gate: only publisher transcripts allowed → E1 (YouTube caption) skipped.
let res = (await db.query(`SELECT index_transcript_lexical_v1(${ids}, ARRAY['publisher_rss_transcript']) r`)).rows[0].r;
assert.equal(res.indexed_episodes, 1); assert.equal(res.skipped_source_class, 1);
res = (await db.query(`SELECT index_transcript_lexical_v1(${ids}) r`)).rows[0].r;
assert.equal(res.indexed_episodes, 1, 'E1 newly indexed'); assert.equal(res.unchanged, 1, 'E2 unchanged');
res = (await db.query(`SELECT index_transcript_lexical_v1(${ids}) r`)).rows[0].r;
assert.equal(res.indexed_episodes, 0); assert.equal(res.unchanged, 2, 'idempotent');
const text = (await db.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_name='episode_transcript_lexical_chunks' AND data_type='text' AND column_name NOT IN ('transcript_content_hash','source_class','rights_status')`)).rows[0].n;
assert.equal(text, 0, 'no transcript text stored');

// Strict phrase: accent/case-insensitive, adjacent words, homonym collision excluded.
const q = async (s, prefix = false) => (await db.query(`SELECT episode_id FROM search_transcript_lexical_v1($1, 50, NULL, $2)`, [s, prefix])).rows.map((x) => x.episode_id);
assert.deepEqual(await q('Hajós András'), [E(1)]);
assert.deepEqual(await q('hajos andras'), [E(1)], 'accent-insensitive');
assert.deepEqual(await q('Miller András'), [], 'strict: inflected form is not the exact phrase');
assert.deepEqual(await q('Miller András', true), [E(2)], 'suffix-tolerant last word');
assert.deepEqual(await q('Hajós András', true), [E(1)], 'Hajós Szilárd + Miller András never match');
assert.deepEqual(await q('ab'), [], 'too short');

// Refresh: changed transcript content replaces the old chunks.
await db.exec(`UPDATE episode_transcripts SET transcript='${long('Most Kovács Péter beszélt.')}', content_hash='h1b' WHERE episode_id='${E(1)}'`);
res = (await db.query(`SELECT index_transcript_lexical_v1(${ids}) r`)).rows[0].r;
assert.equal(res.indexed_episodes, 1);
assert.deepEqual(await q('Hajós András'), [], 'stale chunks replaced');
assert.deepEqual(await q('Kovács Péter'), [E(1)]);

// Person evidence dry run: read-only, single-token names never count, homonym on E2 not matched.
await db.exec(`UPDATE episode_transcripts SET transcript='${long('Ma Hajós András volt a vendégünk.')}', content_hash='h1c' WHERE episode_id='${E(1)}'`);
await db.query(`SELECT index_transcript_lexical_v1(${ids})`);
const ev = (await db.query(`SELECT * FROM transcript_person_evidence_dry_run_v1(${ids}) ORDER BY episode_id, transcript_hits DESC`)).rows;
const byKey = Object.fromEntries(ev.map((x) => [`${x.episode_id}|${x.person_id.slice(-1)}`, x]));
assert.ok(byKey[`${E(1)}|1`].transcript_hits > 0);
assert.equal(byKey[`${E(1)}|1`].identity_ambiguous, true);
assert.equal(byKey[`${E(2)}|1`].transcript_hits, 0, 'Hajós Szilárd + Miller András ≠ Hajós András');
assert.equal(byKey[`${E(1)}|2`].transcript_hits, 0, 'single-token name never counts');
const before = (await db.query(`SELECT count(*)::int n FROM person_episode_mentions WHERE relevance_status='pending'`)).rows[0].n;
assert.equal(before, 2, 'dry run wrote nothing');

// Grants: nothing to anon/authenticated on the index table or functions.
const g = (await db.query(`SELECT count(*)::int n FROM information_schema.role_table_grants WHERE table_name='episode_transcript_lexical_chunks' AND grantee IN ('anon','authenticated')`)).rows[0].n;
assert.equal(g, 0);
for (const fn of ['search_transcript_lexical_v1(text,integer,uuid[],boolean)', 'index_transcript_lexical_v1(uuid[],text[],integer,integer)', 'transcript_person_evidence_dry_run_v1(uuid[])']) {
  const x = (await db.query(`SELECT has_function_privilege('authenticated', '${fn}', 'EXECUTE') a, has_function_privilege('anon', '${fn}', 'EXECUTE') b`)).rows[0];
  assert.equal(x.a, false, fn); assert.equal(x.b, false, fn);
}
console.log('spotify/transcript SQL tests: OK');
