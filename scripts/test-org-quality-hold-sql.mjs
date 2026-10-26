// Isolated PostgreSQL/WASM regression test for the organization quality hold RPCs. No production connection.
// bun add --cwd /tmp/org-sql-test @electric-sql/pglite
// PGLITE_MODULE=/tmp/org-sql-test/node_modules/@electric-sql/pglite/dist/index.js MIGRATION=<path> node scripts/test-org-quality-hold-sql.mjs
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');
const migration = process.env.MIGRATION || new URL('../drizzle/migrations/0108_org_quality_hold_v2.sql', import.meta.url);
const db = new PGlite();
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
 CREATE TYPE public.app_role AS ENUM ('admin','user');
 CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql AS 'SELECT false';
 CREATE FUNCTION public.get_entity_quality_snapshot_v1(_limit integer) RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
 CREATE TABLE organizations(id uuid PRIMARY KEY, name text, org_type text, is_public boolean DEFAULT true,
   is_indexable boolean DEFAULT true, is_browsable_in_hub boolean DEFAULT true, browsable_reason text DEFAULT 'has_hu_episodes',
   ai_review_status text, ai_review_score numeric, ai_review_summary text, ai_recommended_action text,
   manually_seeded boolean DEFAULT false, wikipedia_match_status text DEFAULT 'unchecked', is_podcast_internal boolean DEFAULT false,
   astra_verdict jsonb, astra_reviewed_at timestamptz, gated_episode_count int DEFAULT 5, episode_count int DEFAULT 5,
   podcast_count int, gated_podcast_count int, distinct_podcast_count int, source_podcast_ids uuid[], mention_count int,
   primary_count int, latest_episode_at timestamptz, updated_at timestamptz);
 CREATE TABLE podcasts(id uuid PRIMARY KEY, language_decision text);
 CREATE TABLE episodes(id uuid PRIMARY KEY, podcast_id uuid);
 CREATE TABLE episode_cards(episode_id uuid PRIMARY KEY, published_at timestamptz);
 CREATE TABLE episode_organization_map(organization_id uuid, episode_id uuid, podcast_id uuid, role text);
`);
await db.exec(await readFile(migration, 'utf8'));

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const astra = (verdict, confidence) => `'${JSON.stringify({ verdict, confidence })}'::jsonb`;
// name, type, score, astra, extra
const rows = [
  [1, 'Toronto', 'sport_team', 0.1, astra('ok', 0.35), ''],                 // ambiguous → hold
  [2, 'Queen', 'other', 0, astra('ok', 0.99), ''],                           // real band → keep
  [3, 'Pride', 'ngo', 0.1, astra('not_real_entity', 0.82), ''],             // hold
  [4, 'Reform', 'party', 0.1, astra('ok', 0.4), ''],                         // party → protected
  [5, 'Seeded', 'other', 0.1, astra('ok', 0.4), ', manually_seeded=true'],   // protected
  [6, 'Verified', 'other', 0.1, astra('ok', 0.4), ", wikipedia_match_status='verified'"],
  [7, 'NoSecond', 'other', 0.1, 'NULL', ''],                                 // awaiting second opinion
  [8, 'Fine', 'company', 0.8, astra('ok', 0.4), ''],                         // reviewer not negative
  [9, 'ÁVO', 'other', 0.1, astra('wrong_name', 0.9), ''],                    // second opinion: real, other issue
];
for (const [n, name, type, score, a, extra] of rows) {
  await db.exec(`INSERT INTO organizations(id,name,org_type,ai_review_status,ai_review_score,astra_verdict,astra_reviewed_at)
    VALUES('${id(n)}','${name}','${type}','reviewed',${score},${a},now() - interval '1 day');
    UPDATE organizations SET id=id ${extra} WHERE id='${id(n)}';`);
}
const q = async (sql) => (await db.query(sql)).rows;
const flags = async (n) => (await q(`SELECT is_indexable,is_browsable_in_hub,browsable_reason,quality_hold_at IS NOT NULL held,is_public FROM organizations WHERE id='${id(n)}'`))[0];

// Dry run writes nothing.
const dry = (await q(`SELECT apply_org_quality_holds_v1(100,true,NULL) r`))[0].r;
assert.equal(dry.held, 2);
assert.equal((await q(`SELECT count(*)::int n FROM organization_quality_hold_log`))[0].n, 0);
assert.equal((await flags(1)).held, false);

// Live: exactly Toronto + Pride held; real/protected/unknown untouched.
const RUN = '99999999-9999-4999-8999-999999999999';
const live = (await q(`SELECT apply_org_quality_holds_v1(100,false,'${RUN}') r`))[0].r;
assert.equal(live.held, 2);
assert.deepEqual([...live.held_sample].sort(), ['Pride', 'Toronto']);
assert.equal(live.remaining['skip:second_opinion_confirms_real'], 1);
assert.equal(live.remaining['skip:protected'], 3);
assert.equal(live.remaining['skip:awaiting_second_opinion'], 1);
assert.equal(live.remaining['skip:second_opinion_other'], 1);
for (const n of [2, 4, 5, 6, 7, 8, 9]) assert.equal((await flags(n)).is_indexable, true, `org ${n} must stay listed`);
const t = await flags(1);
assert.equal(t.is_indexable, false); assert.equal(t.is_browsable_in_hub, false); assert.equal(t.browsable_reason, 'quality_hold');
assert.equal(t.is_public, true, 'page and links stay public');

// Idempotent: second run holds nothing new.
assert.equal((await q(`SELECT apply_org_quality_holds_v1(100,false,NULL) r`))[0].r.held, 0);
assert.equal((await q(`SELECT count(*)::int n FROM organization_quality_hold_log WHERE action='hold'`))[0].n, 2);

// Recount keeps the hold (it used to re-list everything with ≥3 episodes).
const POD = id(100);
await db.exec(`INSERT INTO podcasts VALUES('${POD}','accept_hungarian');`);
for (let i = 0; i < 4; i++) {
  await db.exec(`INSERT INTO episodes VALUES('${id(200 + i)}','${POD}'); INSERT INTO episode_cards VALUES('${id(200 + i)}',now());
    INSERT INTO episode_organization_map VALUES('${id(1)}','${id(200 + i)}','${POD}','mentioned'),('${id(2)}','${id(200 + i)}','${POD}','mentioned');`);
}
await db.exec(`SELECT recompute_org_gated_counts();`);
assert.equal((await flags(1)).is_indexable, false, 'recount must not undo the hold');
assert.equal((await flags(1)).browsable_reason, 'quality_hold');
assert.equal((await flags(2)).is_indexable, true);

// A confident second opinion after the hold releases it and restores the old flags.
await db.exec(`UPDATE organizations SET astra_verdict=${astra('ok', 0.95)}, astra_reviewed_at=now() + interval '1 minute' WHERE id='${id(1)}'`);
const rel = (await q(`SELECT apply_org_quality_holds_v1(100,false,NULL) r`))[0].r;
assert.equal(rel.released, 1);
const back = await flags(1);
assert.equal(back.held, false); assert.equal(back.is_indexable, true); assert.equal(back.browsable_reason, 'has_hu_episodes');

// Owner rollback by run id; a released org is never re-held automatically.
const owner = (await q(`SELECT release_org_quality_holds_v1(NULL,'${RUN}','owner_release') r`))[0].r;
assert.equal(owner.released, 1); // Pride (Toronto was already released)
assert.equal((await flags(3)).is_indexable, true);
assert.equal((await q(`SELECT apply_org_quality_holds_v1(100,false,NULL) r`))[0].r.held, 0);
assert.equal((await q(`SELECT org_quality_hold_verdict_v1('reviewed',0.1,'', 'ngo', false,'unchecked',false, now(), ${astra('not_real_entity', 0.9)}) v`))[0].v, 'skip:released');

// Only the service role may run the mutators.
const acl = (await q(`SELECT has_function_privilege('anon','apply_org_quality_holds_v1(integer,boolean,uuid)','EXECUTE') a,
  has_function_privilege('authenticated','release_org_quality_holds_v1(uuid[],uuid,text)','EXECUTE') b,
  has_function_privilege('service_role','apply_org_quality_holds_v1(integer,boolean,uuid)','EXECUTE') c`))[0];
assert.deepEqual(acl, { a: false, b: false, c: true });
console.log('org quality hold SQL: all checks passed');
