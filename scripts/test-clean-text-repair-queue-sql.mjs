// Isolated PostgreSQL/WASM regression test for the durable clean-text repair queue. No production connection.
// bun add --cwd /tmp/person-sql-test @electric-sql/pglite
// PGLITE_MODULE=/tmp/person-sql-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-clean-text-repair-queue-sql.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
 CREATE TYPE public.app_role AS ENUM ('admin','user');
 CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql AS 'SELECT false';
 CREATE TABLE podcasts(id uuid PRIMARY KEY, language_decision text);
 CREATE TABLE episodes(id uuid PRIMARY KEY, podcast_id uuid, description text, summary text, clean_text_status text, published_at timestamptz);
 CREATE TABLE episode_clean_text(episode_id uuid PRIMARY KEY, source_hash text, cleaned_text text, cleaner_method text);
 CREATE TABLE episode_best_text_source(episode_id uuid PRIMARY KEY, source_type text);
 CREATE TABLE episode_clean_text_repair_backups(id bigserial, episode_id uuid, rolled_back_at timestamptz);
`);
await db.exec(await readFile(new URL('../drizzle/migrations/0073_clean_text_repair_queue.sql', import.meta.url), 'utf8'));

const POD = '33333333-3333-4333-8333-333333333333', FOREIGN = '33333333-3333-4333-8333-333333333334';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const long = 'Vendég: Minta Anna. '.padEnd(700, 'Érdemi leírás a témáról. ');
await db.exec(`
 INSERT INTO podcasts VALUES('${POD}','accept_hungarian'),('${FOREIGN}','reject_foreign');
 INSERT INTO episodes VALUES
  ('${id(1)}','${POD}','${long}',null,'done',now()),            -- empty_substantive
  ('${id(2)}','${POD}','Rövid, de érdemi leírás negyven karakter felett.',null,'done',now()), -- empty_any
  ('${id(3)}','${POD}','x',null,'skipped',now()),               -- no source
  ('${id(4)}','${POD}','${long}',null,'done',now()),            -- ok
  ('${id(5)}','${POD}','${long}',null,'pending',now()),         -- runner owns
  ('${id(6)}','${POD}','${long}',null,'done',now()),            -- legacy ytdesc
  ('${id(7)}','${FOREIGN}','${long}',null,'done',now()),        -- not Hungarian
  ('${id(8)}','${POD}','x',null,'skipped',now());               -- no RSS but verified Spotify lane
 INSERT INTO episode_clean_text VALUES
  ('${id(1)}','h','', 'deterministic_v4'),('${id(2)}','h','', 'deterministic_v4'),
  ('${id(4)}','h','${long}','deterministic_v4'),('${id(6)}','h','${long}','deterministic_v4+ytdesc'),('${id(7)}','h','','deterministic_v4');
 INSERT INTO episode_best_text_source VALUES ('${id(6)}','rss'),('${id(8)}','spotify');
`);

const seed1 = (await db.query(`SELECT clean_text_repair_queue_seed_v1() r`)).rows[0].r;
const q = async () => Object.fromEntries((await db.query(`SELECT episode_id, repair_kind, status, outcome FROM clean_text_repair_queue`)).rows.map((r) => [r.episode_id, r]));
let rows = await q();
assert.equal(rows[id(1)].repair_kind, 'empty_substantive'); assert.equal(rows[id(1)].status, 'pending');
assert.equal(rows[id(2)].repair_kind, 'empty_any');
assert.equal(rows[id(3)].status, 'no_substantive_source', 'source-less episodes reach a terminal state, never spin');
assert.equal(rows[id(6)].status, 'needs_review', 'legacy YouTube-description text is never auto-repaired');
assert.equal(rows[id(8)].status, 'protected', 'verified alternative-source episodes stay with their lane');
assert.ok(!rows[id(4)] && !rows[id(5)] && !rows[id(7)], 'ok, runner-owned and foreign episodes are not queued');

// Idempotent: a second seed with unchanged sources writes nothing.
const seed2 = (await db.query(`SELECT clean_text_repair_queue_seed_v1() r`)).rows[0].r;
assert.equal(seed2.upserted, 0, 'unchanged sources must not churn the queue');
assert.ok(seed1.upserted >= 5);

// Claim with lease; a concurrent claimer gets the remaining rows only.
const c1 = (await db.query(`SELECT * FROM claim_clean_text_repair_queue_v1('w1', 1)`)).rows;
assert.equal(c1.length, 1); assert.equal(c1[0].episode_id, id(1), 'highest priority (long empty) first');
const c2 = (await db.query(`SELECT * FROM claim_clean_text_repair_queue_v1('w2', 10)`)).rows;
assert.deepEqual(c2.map((r) => r.episode_id), [id(2)]);

// Only the lease owner can complete; retry past max_attempts becomes dead.
let done = (await db.query(`SELECT complete_clean_text_repair_queue_v1('w2', $1::jsonb) r`, [JSON.stringify([{ episode_id: id(1), status: 'done', outcome: 'applied' }])])).rows[0].r;
assert.equal(done.completed, 0, 'foreign lease owner cannot complete');
done = (await db.query(`SELECT complete_clean_text_repair_queue_v1('w1', $1::jsonb) r`, [JSON.stringify([{ episode_id: id(1), status: 'done', outcome: 'applied', batch_id: '99999999-9999-4999-8999-999999999999' }])])).rows[0].r;
assert.equal(done.completed, 1);
await db.exec(`UPDATE clean_text_repair_queue SET attempts = 5 WHERE episode_id='${id(2)}'`);
await db.query(`SELECT complete_clean_text_repair_queue_v1('w2', $1::jsonb)`, [JSON.stringify([{ episode_id: id(2), status: 'retry', outcome: 'cas_conflict', retry_after_seconds: 60 }])]);
rows = await q();
assert.equal(rows[id(2)].status, 'dead', 'retries are finite (dead letter)');
await assert.rejects(db.query(`SELECT complete_clean_text_repair_queue_v1('w1', '[{"episode_id":"${id(1)}","status":"leased"}]'::jsonb)`), /invalid status/);

// A real RSS change re-queues; a no-op update does not.
await db.exec(`UPDATE episodes SET description = description WHERE id='${id(3)}'`);
rows = await q(); assert.equal(rows[id(3)].status, 'no_substantive_source', 'no-op update is not a source change');
await db.exec(`UPDATE episodes SET description = '${long}' WHERE id='${id(3)}'`);
rows = await q(); assert.equal(rows[id(3)].repair_kind, 'rss_changed'); assert.equal(rows[id(3)].status, 'pending');
await db.exec(`UPDATE episodes SET description = 'új' WHERE id='${id(7)}'`);
rows = await q(); assert.ok(!rows[id(7)], 'foreign shows are never queued');

// Fixed elsewhere → resolved on the next reconciliation scan.
await db.exec(`UPDATE episode_clean_text SET cleaned_text='${long}' WHERE episode_id='${id(6)}'; UPDATE episode_clean_text SET cleaner_method='deterministic_v4' WHERE episode_id='${id(6)}';`);
const seed3 = (await db.query(`SELECT clean_text_repair_queue_seed_v1() r`)).rows[0].r;
rows = await q();
assert.equal(rows[id(6)].outcome, 'resolved_elsewhere');
assert.ok(seed3.resolved_elsewhere >= 1);
assert.equal(rows[id(3)].repair_kind, 'rss_changed', 'a pending RSS change keeps its kind until processed');

const status = (await db.query(`SELECT clean_text_repair_queue_status_v1() r`)).rows[0].r;
assert.ok(status.by_status && typeof status.open === 'number');
console.log('clean-text repair queue SQL: all assertions passed', JSON.stringify(status.by_status));
