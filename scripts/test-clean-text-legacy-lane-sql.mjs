// Isolated PostgreSQL/WASM regression test for the legacy ytdesc lane of the clean-text repair queue (0075). No production connection.
// PGLITE_MODULE=/tmp/person-sql-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-clean-text-legacy-lane-sql.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
 CREATE TYPE public.app_role AS ENUM ('admin','user');
 CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql AS 'SELECT false';
 CREATE TABLE podcasts(id uuid PRIMARY KEY, language_decision text, title text, spotify_match_confidence numeric);
 CREATE TABLE episodes(id uuid PRIMARY KEY, podcast_id uuid, title text, description text, summary text, clean_text_status text, published_at timestamptz);
 CREATE TABLE episode_clean_text(episode_id uuid PRIMARY KEY, source_hash text, cleaned_text text, cleaner_method text, removed_categories text[]);
 CREATE TABLE episode_best_text_source(episode_id uuid PRIMARY KEY, source_type text);
 CREATE TABLE episode_clean_text_repair_backups(id bigserial, batch_id uuid, episode_id uuid, new_cleaner_method text, reasons text[], rolled_back_at timestamptz);
 CREATE TABLE episode_youtube_links(id uuid PRIMARY KEY, episode_id uuid, podcast_id uuid, youtube_video_id text, youtube_channel_id text, youtube_title text,
   youtube_description text, youtube_published_at timestamptz, match_score numeric, confidence text, status text, validation_reason jsonb);
 CREATE TABLE episode_spotify_meta(episode_id uuid, match_confidence numeric, spotify_description text, spotify_html_description text);
`);
for (const f of ['0073_clean_text_repair_queue.sql', '0074_clean_text_repair_queue_dead_letter_expired.sql', '0075_clean_text_repair_queue_legacy_lane.sql']) {
  await db.exec(await readFile(new URL(`../drizzle/migrations/${f}`, import.meta.url), 'utf8'));
}
const POD = '33333333-3333-4333-8333-333333333333';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const long = 'Vendég: Minta Anna. '.padEnd(700, 'Érdemi leírás a témáról. ');
const yt = 'YouTube leírás Minta Annával a témáról, fejezetekkel. '.padEnd(300, 'Részletes összefoglaló. ');
await db.exec(`
 INSERT INTO podcasts VALUES('${POD}','accept_hungarian','Minta podcast',0.9);
 INSERT INTO episodes VALUES
  ('${id(1)}','${POD}','Első adás','${long}',null,'done','2026-01-01'),
  ('${id(2)}','${POD}','Második adás','${long}',null,'done','2026-02-01'),
  ('${id(3)}','${POD}','Harmadik adás','${long}',null,'done','2026-03-01'),
  ('${id(4)}','${POD}','Negyedik adás','',null,'done','2026-04-01');
 INSERT INTO episode_clean_text VALUES
  ('${id(1)}', encode(sha256(convert_to('deterministic_v4+ytdesc::${yt}','UTF8')),'hex'), '${yt}', 'deterministic_v4+ytdesc', '{}'),
  ('${id(2)}','h2','${yt}','deterministic_v4+ytdesc','{}'),
  ('${id(3)}','h3','${yt}','deterministic_v4+ytdesc','{}'),
  ('${id(4)}','h4','','deterministic_v4','{}');
 INSERT INTO episode_youtube_links VALUES
  ('${id(11)}','${id(1)}','${POD}','vid1','ch1','Első adás','${yt}','2026-01-01',0.9,'strict_auto','confirmed','{"policy":"youtube_episode_match_v3","final_score":0.9}'),
  ('${id(12)}','${id(2)}','${POD}','vid2','ch1','Más','x','2025-01-01',0.3,'rejected','rejected','{"policy":"youtube_episode_match_v3"}');
`);
await db.query(`SELECT clean_text_repair_queue_seed_v1()`);
const q = async () => Object.fromEntries((await db.query(`SELECT episode_id, repair_kind, status, outcome FROM clean_text_repair_queue`)).rows.map((r) => [r.episode_id, r]));
let rows = await q();
for (const n of [1, 2, 3]) assert.equal(rows[id(n)].outcome, 'legacy_ytdesc_separate_review');

// Regular lane never takes legacy rows; legacy lane takes them, unverified (no confirmed link) first.
const reg = (await db.query(`SELECT * FROM claim_clean_text_repair_queue_v2('r1', 40, 600, 'regular')`)).rows;
assert.ok(reg.every((r) => r.repair_kind !== 'legacy_ytdesc'), 'regular lane must not claim legacy rows');
const leg = (await db.query(`SELECT * FROM claim_clean_text_repair_queue_v2('l1', 2, 600, 'legacy')`)).rows;
assert.equal(leg.length, 2);
assert.ok(!leg.some((r) => r.episode_id === id(1)), 'the row with a confirmed link is evaluated last');
await assert.rejects(db.query(`SELECT * FROM claim_clean_text_repair_queue_v2('x', 1, 600, 'other')`), /invalid lane/);

// Once evaluated (finite outcome), a legacy row is not claimed again.
await db.query(`SELECT complete_clean_text_repair_queue_v1('l1', $1::jsonb)`, [JSON.stringify(leg.map((r) => ({ episode_id: r.episode_id, status: 'done', outcome: 'legacy_equivalent_to_rss' })))]);
const leg2 = (await db.query(`SELECT * FROM claim_clean_text_repair_queue_v2('l2', 50, 600, 'legacy')`)).rows;
assert.deepEqual(leg2.map((r) => r.episode_id), [id(1)]);
const leg3 = (await db.query(`SELECT * FROM claim_clean_text_repair_queue_v2('l3', 50, 600, 'legacy')`)).rows;
assert.equal(leg3.length, 0, 'an active lease is never double-claimed');

// Explicit-id claim: finite rows only, never an active lease, ≤50 ids.
const ids = (await db.query(`SELECT * FROM claim_clean_text_repair_queue_ids_v1('c1', ARRAY['${id(1)}','${id(2)}']::uuid[])`)).rows;
assert.deepEqual(ids.map((r) => r.episode_id), [id(2)], 'actively leased row is skipped');
await assert.rejects(db.query(`SELECT * FROM claim_clean_text_repair_queue_ids_v1('c1', (SELECT array_agg(gen_random_uuid()) FROM generate_series(1,51)))`), /at most 50/);

// Inputs: exact source-hash provenance, rejected links only when they are the provenance.
const inputs = (await db.query(`SELECT clean_text_repair_queue_legacy_inputs_v1(ARRAY['${id(1)}','${id(2)}']::uuid[]) r`)).rows[0].r;
const byId = Object.fromEntries(inputs.map((x) => [x.id, x]));
assert.equal(byId[id(1)].links[0].prov, true, 'stored hash identifies the source video');
assert.equal(byId[id(2)].links.length, 0, 'rejected non-provenance links are not loaded');
assert.equal(byId[id(1)].show_channels.ch1, 1);

await db.query(`SELECT complete_clean_text_repair_queue_v1('c1', $1::jsonb)`, [JSON.stringify([{ episode_id: id(2), status: 'needs_review', outcome: 'legacy_unverified_names_review' }])]);
// Legacy writes count separately from the regular daily cap.
await db.query(`SELECT complete_clean_text_repair_queue_v1('l2', $1::jsonb)`, [JSON.stringify([{ episode_id: id(1), status: 'done', outcome: 'legacy_verified_youtube_kept', batch_id: '99999999-9999-4999-8999-999999999999' }])]);
const st = (await db.query(`SELECT clean_text_repair_queue_status_v1() r`)).rows[0].r;
assert.equal(Number(st.legacy_writes_today), 1);
assert.equal(Number(st.applied_today), 0, 'legacy writes do not consume the regular cap');
assert.equal(Number(st.legacy_open), 0);

// Re-seed with unchanged sources keeps every evaluated legacy row as it is.
await db.query(`SELECT clean_text_repair_queue_seed_v1()`);
rows = await q();
assert.equal(rows[id(1)].outcome, 'legacy_verified_youtube_kept', 'stable rows are not re-evaluated');
console.log('clean-text legacy lane SQL: all assertions passed', JSON.stringify(st.by_outcome));
