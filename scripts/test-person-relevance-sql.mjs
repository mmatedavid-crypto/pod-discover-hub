// Optional isolated PostgreSQL/WASM regression test. No production connection.
// npm install --prefix /tmp/person-sql-test @electric-sql/pglite
// PGLITE_MODULE=/tmp/person-sql-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-person-relevance-sql.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE people(id uuid PRIMARY KEY,name text,disambiguation_label text,disambiguation_context text,is_public boolean);
 CREATE TABLE podcasts(id uuid PRIMARY KEY,title text,description text,is_hungarian boolean,language_decision text);
 CREATE TABLE episodes(id uuid PRIMARY KEY,podcast_id uuid,title text,summary text,published_at timestamptz);
 CREATE TABLE person_aliases(person_id uuid,alias text);
 CREATE TABLE episode_clean_text(episode_id uuid,cleaned_text text,cleaner_method text);
 CREATE TABLE app_settings(key text PRIMARY KEY,value jsonb,updated_at timestamptz);
 CREATE TABLE person_episode_mentions(id uuid PRIMARY KEY,person_id uuid,episode_id uuid,podcast_id uuid,
   mention_type text,confidence numeric,evidence text,source text,relevance_status text,final_relevance_score numeric,
   validation_source text,ai_identity_match text,ai_reason text,ai_evidence_phrases text[],ai_judged_at timestamptz,ai_model text,
   role_type text,role_confidence numeric,role_reason text,UNIQUE(person_id,episode_id,mention_type));
 CREATE TABLE ai_call_audit(job_type text,provider text,model_used text,status text,estimated_cost_usd numeric,
   prompt_version text,source_hash text,target_type text,target_id uuid,meta jsonb);
 INSERT INTO app_settings VALUES('person_relevance_judge_controls','{"enabled":true,"batch_limit":40}',now()),
   ('background_jobs','{"enabled":true}',now());
`);
await db.exec(await readFile(new URL('../supabase/migrations/20261018100000_person_relevance_batch_work.sql', import.meta.url), 'utf8'));
const person = '11111111-1111-4111-8111-111111111111';
const episode = '22222222-2222-4222-8222-222222222222';
const podcast = '33333333-3333-4333-8333-333333333333';
const token = '44444444-4444-4444-8444-444444444444';
const other = '55555555-5555-4555-8555-555555555555';
await db.exec(`
 INSERT INTO people VALUES('${person}','Minta Anna',NULL,NULL,true);
 INSERT INTO podcasts VALUES('${podcast}','Kitalált podcast','',true,'accept_hungarian');
 INSERT INTO episodes VALUES('${episode}','${podcast}','Minta Anna vendégünk','',now());
 INSERT INTO episode_clean_text VALUES('${episode}','Vendégünk Minta Anna. Közösen áttekintjük a városi kertek és a közösségek szerepét a hétköznapi életben.','deterministic_v4');
 INSERT INTO person_episode_mentions(id,person_id,episode_id,podcast_id,mention_type,confidence,evidence,relevance_status,role_type)
 VALUES('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${person}','${episode}','${podcast}','guest',0.8,'Vendégünk Minta Anna','accepted','mention'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','${person}','${episode}','${podcast}','mentioned',0.8,'Vendégünk Minta Anna','pending','mention');
`);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
assert.equal((await one('SELECT person_judge_run_lease($1) ok', [token])).ok, true);
assert.equal((await one('SELECT person_judge_run_lease($1) ok', [other])).ok, false, 'overlapping runner blocked');
assert.equal((await one('SELECT person_judge_run_lease($1,true) ok', [other])).ok, false, 'foreign release blocked');
const claim = async () => (await db.query('SELECT claim_person_judge_pairs(40,$1,NULL) item', [token])).rows;
const claimed = await claim();
assert.equal(claimed.length, 1, 'one claim per pair, regardless of role rows');
assert.equal((await claim()).length, 0, 'leased pair cannot be reclaimed');
const decision = { status: 'accepted', score: 0.95, mention_type: 'guest', identity_match: 'same_person',
  reason: 'A leírás vendégként nevezi meg.', evidence_phrases: ['Vendégünk Minta Anna'] };
const cache = async (d = decision) => db.query(`UPDATE person_relevance_work SET cached_hash=source_hash,cached_decision=$1,model_used='fixture'`, [JSON.stringify(d)]);
await cache();
const apply = () => one('SELECT apply_person_judge_pair($1,$2,$3) result', [person, episode, token]);
assert.equal((await apply()).result.changed_rows, 2, 'atomic pair reconciliation');
const visible = (await db.query("SELECT * FROM person_episode_mentions WHERE relevance_status='accepted'")).rows;
assert.equal(visible.length, 1, 'one visible canonical row');
assert.equal(visible[0].mention_type, 'guest');
assert.equal(visible[0].role_type, 'participant', 'display role corrected with mention role');
assert.equal((await one('SELECT jsonb_array_length(meta->\'previous\') backups FROM ai_call_audit')).backups, 2, 'all old rows backed up');
await assert.rejects(apply, /stale_claim/, 'completed claim cannot be applied twice');

const reset = async () => db.exec(`UPDATE person_episode_mentions SET relevance_status='pending',validation_source=NULL,ai_judged_at=NULL;
 UPDATE person_relevance_work SET lease_until=now()-interval '1 second';`);
await reset(); await claim(); await cache();
await db.exec("UPDATE episodes SET title='Megváltozott epizódcím'");
await assert.rejects(apply, /source_changed/, 'stale source cannot overwrite new evidence');
await db.exec("UPDATE person_relevance_work SET lease_until=now()-interval '1 second'");
assert.equal((await claim())[0].item.cached_decision, null, 'changed source invalidates cache');
await cache();
await db.exec("UPDATE person_relevance_work SET lease_until=now()-interval '1 second'");
assert.deepEqual((await claim())[0].item.cached_decision, decision, 'same-source retry reuses paid decision');

await reset();
await db.exec("UPDATE person_episode_mentions SET validation_source='manual_admin',relevance_status='accepted' WHERE mention_type='guest'");
await claim(); await cache();
assert.equal((await apply()).result.status, 'needs_review');
assert.equal((await one("SELECT validation_source FROM person_episode_mentions WHERE mention_type='guest'")).validation_source, 'manual_admin', 'manual row preserved');
assert.equal((await one("SELECT relevance_status FROM person_episode_mentions WHERE mention_type='mentioned'")).relevance_status, 'needs_review');

await reset();
assert.equal((await db.query('SELECT claim_person_judge_pairs(40,$1,$2::uuid[]) item', [token, [other]])).rows.length, 0, 'person filter precedes claim');
await db.exec("UPDATE app_settings SET value=value || '{\"enabled\":false}' WHERE key='person_relevance_judge_controls'");
assert.equal((await claim()).length, 0, 'pause respected by claim RPC');
await db.query('SELECT person_judge_telemetry($1)', [JSON.stringify({ enabled: true, last_processed: 12, daily_budget_usd: 1000 })]);
const ctrl = (await one("SELECT value FROM app_settings WHERE key='person_relevance_judge_controls'")).value;
assert.equal(ctrl.enabled, false, 'telemetry cannot resurrect paused runner');
assert.equal(ctrl.daily_budget_usd, undefined, 'telemetry cannot raise budget');
assert.equal(ctrl.last_processed, 12);
await db.exec('SET ROLE anon');
await assert.rejects(() => db.query('SELECT * FROM person_relevance_work'), /permission denied/);
await assert.rejects(() => db.query('SELECT person_judge_source($1,$2)', [person, episode]), /permission denied/);
await db.close();
console.log('Person review SQL regressions passed: leasing, role collisions, audit, cache, stale source, manual protection, scope, pause, privileges.');
