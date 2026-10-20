// Isolated PostgreSQL/WASM regression test for the clean-text repair RPCs. No production connection.
// bun add --cwd /tmp/person-sql-test @electric-sql/pglite
// PGLITE_MODULE=/tmp/person-sql-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-clean-text-repair-sql.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
 CREATE TYPE public.app_role AS ENUM ('admin','user');
 CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql AS 'SELECT false';
 CREATE TABLE podcasts(id uuid PRIMARY KEY, language_decision text);
 CREATE TABLE episodes(id uuid PRIMARY KEY, podcast_id uuid, description text, summary text, clean_text_status text, published_at timestamptz);
 CREATE TABLE episode_clean_text(episode_id uuid PRIMARY KEY, source_hash text, cleaned_text text, removed_categories text[],
   cleaner_method text, model text, cost_usd numeric, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
 CREATE TABLE episode_best_text_source(episode_id uuid PRIMARY KEY, source_type text, raw_text text, evidence jsonb);
 CREATE TABLE episode_transcripts(id uuid PRIMARY KEY, episode_id uuid, transcript text, status text, updated_at timestamptz);
 CREATE TABLE episode_youtube_links(id uuid PRIMARY KEY, episode_id uuid, status text, updated_at timestamptz);
 CREATE TABLE episode_spotify_meta(id uuid PRIMARY KEY, episode_id uuid, updated_at timestamptz);
`);
await db.exec(await readFile(new URL('../drizzle/migrations/0065_clean_text_quality_repair.sql', import.meta.url), 'utf8'));

const POD = '33333333-3333-4333-8333-333333333333';
const E1 = '11111111-1111-4111-8111-111111111111'; // empty clean row (repair target)
const E2 = '22222222-2222-4222-8222-222222222222'; // no clean row yet
const E3 = '44444444-4444-4444-8444-444444444444'; // concurrent write → CAS conflict
const desc = 'Szerkesztő: Minta Anna. '.padEnd(600, 'Hosszú, érdemi epizódleírás a témáról. ');
await db.exec(`
 INSERT INTO podcasts VALUES('${POD}','accept_hungarian');
 INSERT INTO episodes VALUES('${E1}','${POD}','${desc}','', 'done', now()),('${E2}','${POD}','${desc}','','quarantined', now()),('${E3}','${POD}','${desc}','','done', now());
 INSERT INTO episode_clean_text(episode_id,source_hash,cleaned_text,removed_categories,cleaner_method) VALUES
  ('${E1}','old-hash','',ARRAY['footer_cut'],'deterministic_v4'),
  ('${E3}','old-hash-3','',ARRAY['footer_cut'],'deterministic_v4');
`);
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const targets = await db.query(`SELECT episode_id FROM clean_text_repair_targets_v1('empty_substantive', 10)`);
assert.equal(targets.rows.length, 2, 'only empty clean rows with long descriptions are targets');

const good = 'Minta Anna a városi kertekről beszélget, sok érdemi részlettel és tényekkel az adásban.';
const batch = '99999999-9999-4999-8999-999999999999';
const items = [
  { episode_id: E1, cleaned_text: good, source_hash: 'new-hash-1', cleaner_method: 'deterministic_v4+rescue_v1', expected_source_hash: 'old-hash', expected_cleaned_sha256: sha(''), quality_status: 'valid', quality_reasons: ['v4_empty_for_substantive_source'], removed_categories: ['rescue_v1'] },
  { episode_id: E2, cleaned_text: good, source_hash: 'new-hash-2', cleaner_method: 'deterministic_v4+rescue_v1', expected_source_hash: null, expected_cleaned_sha256: null, quality_status: 'valid' },
  { episode_id: E3, cleaned_text: good, source_hash: 'new-hash-3', cleaner_method: 'deterministic_v4+rescue_v1', expected_source_hash: 'stale', expected_cleaned_sha256: sha(''), quality_status: 'valid' },
  { episode_id: E1, cleaned_text: 'rövid', source_hash: 'x', cleaner_method: 'deterministic_v4' },
  { episode_id: E2, cleaned_text: good + ' https://example.com', source_hash: 'y', cleaner_method: 'deterministic_v4' },
];
const applied = (await db.query(`SELECT apply_clean_text_repair_v1($1, $2::jsonb) r`, [batch, JSON.stringify(items)])).rows[0].r;
assert.equal(applied.applied, 2);
assert.equal(applied.conflicts, 1, 'stale expected hash must not overwrite');
assert.equal(applied.invalid, 2, 'too short and URL-bearing text must be refused');
let live = (await db.query(`SELECT episode_id, cleaned_text, quality_status FROM episode_clean_text ORDER BY episode_id`)).rows;
assert.equal(live.find((r) => r.episode_id === E1).cleaned_text, good);
assert.equal(live.find((r) => r.episode_id === E3).cleaned_text, '', 'conflicting row untouched');
assert.equal((await db.query(`SELECT clean_text_status s FROM episodes WHERE id='${E2}'`)).rows[0].s, 'done');

await assert.rejects(db.query(`SELECT apply_clean_text_repair_v1($1, '[]'::jsonb)`, [batch]), /already applied/);
const tooMany = JSON.stringify(Array.from({ length: 101 }, () => items[0]));
await assert.rejects(db.query(`SELECT apply_clean_text_repair_v1('88888888-8888-4888-8888-888888888888', $1::jsonb)`, [tooMany]), /at most 100/);

// A later legitimate rewrite of E2 must survive rollback.
await db.exec(`UPDATE episode_clean_text SET source_hash='later', cleaned_text='Később frissített, érvényes szöveg az epizódról.' WHERE episode_id='${E2}'`);
const rb = (await db.query(`SELECT rollback_clean_text_repair_v1($1) r`, [batch])).rows[0].r;
assert.equal(rb.restored, 1);
assert.equal(rb.skipped, 1);
live = (await db.query(`SELECT episode_id, cleaned_text, source_hash FROM episode_clean_text ORDER BY episode_id`)).rows;
assert.equal(live.find((r) => r.episode_id === E1).cleaned_text, '', 'E1 restored to the backed-up text');
assert.equal(live.find((r) => r.episode_id === E1).source_hash, 'old-hash');
assert.equal(live.find((r) => r.episode_id === E2).source_hash, 'later', 'later write not clobbered');
assert.equal((await db.query(`SELECT clean_text_status s FROM episodes WHERE id='${E1}'`)).rows[0].s, 'done');

const audit = (await db.query(`SELECT clean_text_quality_audit_v1() a`)).rows[0].a;
assert.equal(audit.empty_with_long_description, 2);
assert.equal(audit.repair_batches, 1);

const anonExec = (await db.query(`SELECT has_function_privilege('anon', 'public.apply_clean_text_repair_v1(uuid, jsonb)', 'EXECUTE') a`)).rows[0].a;
assert.equal(anonExec, false, 'anon cannot apply repairs');
console.log('clean-text repair SQL tests passed');
