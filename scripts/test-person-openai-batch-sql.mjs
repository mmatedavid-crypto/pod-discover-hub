// Isolated PostgreSQL/WASM regression test for the OpenAI batch RPCs. No production connection.
// bun add --cwd /tmp/person-sql-test @electric-sql/pglite
// PGLITE_MODULE=/tmp/person-sql-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-person-openai-batch-sql.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
 CREATE TYPE public.app_role AS ENUM ('admin','user');
 CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql AS 'SELECT false';
 CREATE TABLE people(id uuid PRIMARY KEY,name text,disambiguation_label text,disambiguation_context text,is_public boolean,
   is_indexable boolean DEFAULT true,normalized_name text,identity_ambiguous boolean DEFAULT false);
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
 INSERT INTO app_settings VALUES('background_jobs','{"enabled":true}',now());
`);
await db.exec(await readFile(new URL('../supabase/migrations/20261018100000_person_relevance_batch_work.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../drizzle/migrations/0063_person_relevance_openai_batch.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../drizzle/migrations/0064_person_judge_source_with_hash.sql', import.meta.url), 'utf8'));

const P = '11111111-1111-4111-8111-111111111111', P2 = '66666666-6666-4666-8666-666666666666';
const E = '22222222-2222-4222-8222-222222222222', E2 = '77777777-7777-4777-8777-777777777777';
const POD = '33333333-3333-4333-8333-333333333333';
await db.exec(`
 INSERT INTO people VALUES('${P}','Minta Anna',NULL,NULL,true,true,'minta anna',false),('${P2}','Kettő Béla',NULL,NULL,true,true,'ketto bela',false);
 INSERT INTO podcasts VALUES('${POD}','Kitalált podcast','',true,'accept_hungarian');
 INSERT INTO episodes VALUES('${E}','${POD}','Minta Anna vendégünk','',now()),('${E2}','${POD}','Kettő Béla adás','',now());
 INSERT INTO episode_clean_text VALUES('${E}','Vendégünk Minta Anna, a városi kertek szakértője.','deterministic_v4'),('${E2}','Kettő Béla beszél.','deterministic_v4');
 INSERT INTO person_episode_mentions(id,person_id,episode_id,podcast_id,mention_type,confidence,evidence,relevance_status,role_type) VALUES
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','${P}','${E}','${POD}','mentioned',0.8,'Vendégünk Minta Anna','pending','mention'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','${P2}','${E2}','${POD}','guest',0.8,'Kettő Béla','pending','participant'),
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','${P2}','${E2}','${POD}','mentioned',0.8,'Kettő Béla','accepted','mention');
`);
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];
const candidates = async () => (await db.query('SELECT * FROM person_openai_batch_candidates(25,0,NULL,NULL)')).rows;
assert.deepEqual((await candidates()).map(r => r.person_id), [P], 'pairs with an accepted/rejected row are protected from bulk review');

const job = (await one(`INSERT INTO person_relevance_batch_jobs(model,prompt_version,status) VALUES('gpt-6-luna','person-openai-v1','claimed') RETURNING id`)).id;
await assert.rejects(db.query('SELECT claim_person_openai_batch_pairs($1,10)', [job]), /batch_controls_disabled/, 'claim fails closed while disabled');
await db.exec(`INSERT INTO app_settings VALUES('person_relevance_openai_batch_controls','{"enabled":true,"max_requests_per_job":10,"daily_cap_usd":1,"total_cap_usd":1}',now())`);
await assert.rejects(db.query('SELECT reserve_person_openai_batch_cost($1,0.01,1)', [job]), /no_authorized_pilot/, 'no spend without an authorized pilot');
const claimed = (await db.query('SELECT claim_person_openai_batch_pairs($1,10) item', [job])).rows;
assert.equal(claimed.length, 1);
assert.equal((await candidates()).length, 0, 'leased pair is not offered again');
const hash = claimed[0].item.source_hash;
assert.equal((await one('SELECT person_judge_source_with_hash($1,$2) s', [P, E])).s.source_hash, hash, 'hash helper matches claim hash');

await db.exec(`UPDATE app_settings SET value = value || '{"authorized_pilot":{"max_requests":5,"total_cap_usd":0.5,"daily_cap_usd":0.5}}' WHERE key='person_relevance_openai_batch_controls'`);
await assert.rejects(db.query('SELECT reserve_person_openai_batch_cost($1,0.6,1)', [job]), /total_cap_exceeded/, 'total cap enforced');
await assert.rejects(db.query('SELECT reserve_person_openai_batch_cost($1,0.01,6)', [job]), /authorized_requests_exceeded/, 'request cap enforced');
assert.ok((await one('SELECT reserve_person_openai_batch_cost($1,0.01,1) r', [job])).r);

const decision = { status: 'accepted', score: 0.95, mention_type: 'guest', identity_match: 'same_person', reason: 'Vendég.', evidence_phrases: ['Vendégünk Minta Anna'], model: 'gpt-6-luna' };
const item = async (extra = '', h = hash) => (await one(`INSERT INTO person_relevance_batch_items(job_id,custom_id,person_id,episode_id,source_hash,prompt_version,tier,status,decision,final_status${extra ? ',identity_risk' : ''})
  VALUES($1,$2,$3,$4,$5,'person-openai-v1','primary','succeeded',$6,'accepted'${extra ? ',true' : ''}) RETURNING id`, [job, 'cid-' + Math.random(), P, E, h, JSON.stringify(decision)])).id;

const risky = await item('risk');
await assert.rejects(db.query('SELECT apply_person_openai_batch_item($1)', [risky]), /unsafe_acceptance/, 'namesake risk never auto-accepts');

const it1 = await item();
const applied = (await one('SELECT apply_person_openai_batch_item($1) r', [it1])).r;
assert.equal(applied.status, 'accepted');
const row = await one("SELECT * FROM person_episode_mentions WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
assert.equal(row.relevance_status, 'accepted'); assert.equal(row.mention_type, 'guest'); assert.equal(row.role_type, 'participant');
assert.equal(row.validation_source, 'person_openai_batch_v1');
assert.equal((await one('SELECT count(*)::int n FROM person_relevance_batch_audit WHERE job_id=$1', [job])).n, 1, 'every change audited');
await assert.rejects(db.query('SELECT apply_person_openai_batch_item($1)', [it1]), /item_not_applicable/, 'item applies once');

const rb = (await one('SELECT rollback_person_openai_batch_job($1) r', [job])).r;
assert.deepEqual(rb, { restored: 1, conflicts: 0 });
const restored = await one("SELECT * FROM person_episode_mentions WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
assert.equal(restored.relevance_status, 'pending'); assert.equal(restored.mention_type, 'mentioned'); assert.equal(restored.validation_source, null);

// Lease lost / source changed / protected after claim.
await db.exec(`UPDATE person_relevance_work SET claim_token='${job}', lease_until=now()+interval '1 hour'`);
await db.exec("UPDATE episodes SET title='Megváltozott cím' WHERE id='" + E + "'");
assert.equal((await one('SELECT apply_person_openai_batch_item($1) r', [await item()])).r.reason, 'source_changed', 'stale source skipped');
await db.exec("UPDATE episodes SET title='Minta Anna vendégünk' WHERE id='" + E + "'");
await db.exec(`UPDATE person_relevance_work SET claim_token='${job}', lease_until=now()+interval '1 hour'`);
await db.exec("UPDATE person_episode_mentions SET validation_source='manual_admin' WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'");
const protectedHash = (await one('SELECT person_judge_source_with_hash($1,$2) s', [P, E])).s.source_hash;
assert.equal((await one('SELECT apply_person_openai_batch_item($1) r', [await item('', protectedHash)])).r.status, 'skipped_protected', 'manual review protected');
assert.equal((await one("SELECT relevance_status FROM person_episode_mentions WHERE id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")).relevance_status, 'pending');
await db.exec("UPDATE person_relevance_work SET claim_token=gen_random_uuid()");
assert.equal((await one('SELECT apply_person_openai_batch_item($1) r', [await item()])).r.reason, 'lease_lost', 'foreign lease never applied');
assert.ok((await one('SELECT release_person_openai_batch_job($1) n', [job])).n >= 0);
console.log('person openai batch SQL: all assertions passed');
