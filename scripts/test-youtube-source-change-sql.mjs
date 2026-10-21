// Isolated PostgreSQL/WASM regression test for the YouTube link no-op write guard,
// observation-only metadata and the fast-lane source-change queue. No production connection.
// bun add --cwd /tmp/person-sql-test @electric-sql/pglite
// PGLITE_MODULE=/tmp/person-sql-test/node_modules/@electric-sql/pglite/dist/index.js node scripts/test-youtube-source-change-sql.mjs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
const { PGlite } = await import(process.env.PGLITE_MODULE || '@electric-sql/pglite');

const dir = new URL('../drizzle/migrations/', import.meta.url);
const file = process.env.MIGRATION_FILE
  || new URL((await readdir(dir)).find((f) => /^\d{4}_youtube_link_noop_source_change_queue\.sql$/.test(f)), dir);
const db = new PGlite();
await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
 CREATE TYPE public.app_role AS ENUM ('admin','user');
 CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql AS 'SELECT false';
 CREATE TABLE podcasts(id uuid PRIMARY KEY, language_decision text);
 CREATE TABLE episodes(id uuid PRIMARY KEY, podcast_id uuid, youtube_video_id text, youtube_url text,
   youtube_pairing_status text, youtube_paired_at timestamptz, youtube_match_score numeric, updated_at timestamptz DEFAULT now());
 CREATE FUNCTION tg_set_updated_at() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN NEW.updated_at = now(); RETURN NEW; END';
 CREATE TABLE episode_youtube_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), episode_id uuid NOT NULL, podcast_id uuid NOT NULL,
   youtube_video_id text NOT NULL, youtube_channel_id text, youtube_title text, youtube_description text,
   youtube_published_at timestamptz, youtube_duration_seconds integer, youtube_view_count bigint, match_score numeric,
   confidence text NOT NULL DEFAULT 'auto', status text NOT NULL DEFAULT 'candidate', found_by text, validated_by text,
   validation_reason jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
   youtube_caption_available boolean, youtube_caption_checked_at timestamptz, UNIQUE(episode_id, youtube_video_id));
 CREATE TRIGGER trg_eyl_updated_at BEFORE UPDATE ON episode_youtube_links FOR EACH ROW EXECUTE FUNCTION tg_set_updated_at();
`);
await db.exec(await readFile(file, 'utf8'));

const HU = '33333333-3333-4333-8333-333333333333';
const EN = '55555555-5555-4555-8555-555555555555';
const E = (n) => `0000000${n}-1111-4111-8111-111111111111`;
await db.exec(`
 INSERT INTO podcasts VALUES('${HU}','accept_hungarian'),('${EN}','reject_foreign');
 INSERT INTO episodes(id,podcast_id) SELECT ('0000000'||g||'-1111-4111-8111-111111111111')::uuid, '${HU}' FROM generate_series(1,8) g;
 UPDATE episodes SET podcast_id='${EN}' WHERE id='${E(8)}';
`);
const row = (ep, vid, over = {}) => ({
  episode_id: ep, podcast_id: HU, youtube_video_id: vid, youtube_channel_id: 'UC1', youtube_title: 'Adás címe',
  youtube_description: 'Érdemi leírás a témáról.', youtube_published_at: '2026-10-20T10:00:00Z', youtube_duration_seconds: 3600,
  youtube_caption_available: true, youtube_view_count: 1000, match_score: 0.8734567891, confidence: 'strict_auto', status: 'confirmed',
  found_by: 'youtube-episode-pairer', validated_by: 'strict_auto',
  validation_reason: { policy: 'youtube_episode_match_v3', final_score: 0.8735, rank: 0, youtube_caption_available: true }, ...over,
});
const up = async (rows, winners = []) => (await db.query(`SELECT upsert_episode_youtube_links_v1($1::jsonb,$2::jsonb) r`, [JSON.stringify(rows), JSON.stringify(winners)])).rows[0].r;
const link = async (ep, vid) => (await db.query(`SELECT * FROM episode_youtube_links WHERE episode_id=$1 AND youtube_video_id=$2`, [ep, vid])).rows[0];
const queue = async () => (await db.query(`SELECT * FROM episode_source_change_queue ORDER BY priority DESC, enqueued_at, episode_id`)).rows;
const age = (sql) => db.exec(sql);

// 1) New confirmed pair → inserted, episode winner set, queued for the fast lane.
let r = await up([row(E(1), 'v1'), row(E(1), 'v2', { status: 'rejected', confidence: 'rejected', validated_by: null })], [{ episode_id: E(1), youtube_video_id: 'v1' }]);
assert.equal(r.inserted, 2);
assert.equal(r.episodes_updated, 1);
let q = await queue();
assert.equal(q.length, 1, 'only the confirmed link is queued');
assert.equal(q[0].reason, 'new_confirmed');
assert.equal(q[0].priority, 100);
await age(`UPDATE episode_source_change_queue SET enqueued_at = now() - interval '1 hour'`);
await age(`ALTER TABLE episode_youtube_links DISABLE TRIGGER trg_eyl_updated_at; UPDATE episode_youtube_links SET updated_at = '2026-01-01T00:00:00Z'; ALTER TABLE episode_youtube_links ENABLE TRIGGER trg_eyl_updated_at;`);
await age(`UPDATE episodes SET youtube_paired_at = '2026-01-01T00:00:00Z'`);
await age(`DELETE FROM episode_source_change_queue`);

// 2) Repeated identical scan → zero writes, updated_at and paired_at unchanged, nothing queued.
r = await up([row(E(1), 'v1'), row(E(1), 'v2', { status: 'rejected', confidence: 'rejected', validated_by: null })], [{ episode_id: E(1), youtube_video_id: 'v1' }]);
assert.equal(r.noop, 2, 'repeated scan is a no-op');
assert.equal(r.content_updated + r.meta_only_updated + r.inserted + r.episodes_updated, 0);
assert.equal(new Date((await link(E(1), 'v1')).updated_at).toISOString(), '2026-01-01T00:00:00.000Z');
assert.equal((await queue()).length, 0);
assert.equal(new Date((await db.query(`SELECT youtube_paired_at p FROM episodes WHERE id='${E(1)}'`)).rows[0].p).toISOString(), '2026-01-01T00:00:00.000Z');

// 3) Small view jitter → no write; caption flag flip / large view change → meta-only (updated_at kept, no queue).
r = await up([row(E(1), 'v1', { youtube_view_count: 1050 })]);
assert.equal(r.noop, 1, 'view jitter below threshold is ignored');
r = await up([row(E(1), 'v1', { youtube_view_count: 5000, youtube_caption_available: false, validation_reason: { policy: 'youtube_episode_match_v3', final_score: 0.8735, rank: 0, youtube_caption_available: false } })]);
assert.equal(r.meta_only_updated, 1);
let l1 = await link(E(1), 'v1');
assert.equal(new Date(l1.updated_at).toISOString(), '2026-01-01T00:00:00.000Z', 'meta-only change keeps updated_at');
assert.ok(l1.metadata_refreshed_at, 'meta-only change is tracked separately');
assert.equal(Number(l1.youtube_view_count), 5000);
assert.equal((await queue()).length, 0, 'meta-only change never triggers downstream');
// Other writers (views refresh) also keep updated_at.
await age(`UPDATE episode_youtube_links SET youtube_view_count = 9999, updated_at = now() WHERE episode_id='${E(1)}' AND youtube_video_id='v1'`);
assert.equal(new Date((await link(E(1), 'v1')).updated_at).toISOString(), '2026-01-01T00:00:00.000Z');

// 4) Genuine description change on a confirmed link → updated_at bumps and is queued.
r = await up([row(E(1), 'v1', { youtube_description: 'Új, bővített leírás fejezetekkel.' })]);
assert.equal(r.content_updated, 1);
assert.notEqual(new Date((await link(E(1), 'v1')).updated_at).toISOString(), '2026-01-01T00:00:00.000Z');
q = await queue();
assert.equal(q.length, 1);
assert.equal(q[0].reason, 'content_changed');

// 5) Sticky confirmation: a rescan without a winner (AI budget skipped) never demotes.
r = await up([row(E(1), 'v1', { youtube_description: 'Új, bővített leírás fejezetekkel.', status: 'candidate', confidence: 'candidate', validated_by: null })]);
assert.equal(r.sticky_confirmed, 1);
assert.equal((await link(E(1), 'v1')).status, 'confirmed');
// Same scan picked a different video → old one may be demoted, and that is a downstream event.
await age(`DELETE FROM episode_source_change_queue`);
r = await up([
  row(E(1), 'v1', { youtube_description: 'Új, bővített leírás fejezetekkel.', status: 'candidate', confidence: 'candidate', validated_by: null, demote_allowed: true }),
  row(E(1), 'v3'),
], [{ episode_id: E(1), youtube_video_id: 'v3' }]);
assert.equal(r.demoted, 1);
assert.equal((await link(E(1), 'v1')).status, 'candidate');
assert.equal((await db.query(`SELECT youtube_video_id v FROM episodes WHERE id='${E(1)}'`)).rows[0].v, 'v3');
q = await queue();
assert.equal(q.length, 1, 'one queue row per episode (deduped)');
assert.ok(Number(q[0].change_seq) >= 2, 'second change in the same episode bumps change_seq');

// 6) Rejected / candidate links never enqueue.
await age(`DELETE FROM episode_source_change_queue`);
await up([row(E(2), 'v9', { status: 'candidate', confidence: 'candidate', validated_by: null }), row(E(3), 'v8', { status: 'rejected', confidence: 'rejected', validated_by: null })]);
assert.equal((await queue()).length, 0);

// 7) Human/manual links are protected and block a competing auto-confirmation.
await age(`INSERT INTO episode_youtube_links(episode_id,podcast_id,youtube_video_id,status,confidence,found_by,validated_by) VALUES ('${E(4)}','${HU}','m1','confirmed','high','manual','human')`);
await age(`DELETE FROM episode_source_change_queue`);
r = await up([row(E(4), 'm1', { status: 'rejected', confidence: 'rejected', validated_by: null }), row(E(4), 'x1')], [{ episode_id: E(4), youtube_video_id: 'x1' }]);
assert.equal(r.protected_manual, 1);
assert.equal(r.blocked_by_manual_link, 1);
assert.equal((await link(E(4), 'm1')).status, 'confirmed');
assert.equal((await link(E(4), 'x1')).status, 'candidate');
assert.equal(r.episodes_updated, 0, 'manual pairing on the episode is not overwritten');

// 8) Non-Hungarian podcasts never enter the queue.
await age(`DELETE FROM episode_source_change_queue`);
await up([row(E(8), 'en1', { podcast_id: EN })]);
assert.equal((await queue()).length, 0);

// 9) Fast-lane fairness, lease, overlap safety, retry/backoff, dead-letter and change_seq-safe ack.
await up([row(E(5), 'n5'), row(E(6), 'n6'), row(E(7), 'n7')]);
await age(`UPDATE episode_source_change_queue SET priority = 50, enqueued_at = now() - interval '1 day' WHERE episode_id='${E(7)}'`);
const claim = async (n) => (await db.query(`SELECT * FROM claim_episode_source_changes_v1($1, 600)`, [n])).rows;
const c1 = await claim(2);
assert.deepEqual(c1.map((x) => x.episode_id).sort(), [E(5), E(6)].sort(), 'higher-priority new pairs are claimed before an older low-priority event');
const c2 = await claim(5);
assert.deepEqual(c2.map((x) => x.episode_id), [E(7)], 'leased rows are not claimed twice');
// A change during processing survives the ack.
await up([row(E(5), 'n5', { youtube_description: 'Közben frissült leírás.' })]);
let ack = (await db.query(`SELECT ack_episode_source_changes_v1($1,$2::jsonb) r`, [c1[0].lease_token, JSON.stringify(c1.map((x) => ({ episode_id: x.episode_id, change_seq: Number(x.change_seq) })))])).rows[0].r;
assert.equal(ack.done, 1);
assert.equal(ack.requeued, 1);
q = await queue();
assert.ok(q.find((x) => x.episode_id === E(5) && x.lease_token === null), 're-changed episode stays queued and is released');
// Failure → backoff, not silently dropped.
ack = (await db.query(`SELECT ack_episode_source_changes_v1($1,'[]'::jsonb,'boom') r`, [c2[0].lease_token])).rows[0].r;
assert.equal(ack.failed, 1);
const e7 = (await queue()).find((x) => x.episode_id === E(7));
assert.equal(e7.last_error, 'boom');
assert.ok(new Date(e7.available_at) > new Date(), 'retry is backed off');
await age(`UPDATE episode_source_change_queue SET attempts = 5, available_at = now() - interval '1 minute' WHERE episode_id='${E(7)}'`);
await claim(10);
assert.equal((await queue()).find((x) => x.episode_id === E(7)).status, 'dead', 'exhausted retries become visible dead letters');

// 10) Privileges: only service_role may run the RPCs.
const grants = (await db.query(`SELECT has_function_privilege('anon','public.upsert_episode_youtube_links_v1(jsonb,jsonb)','EXECUTE') a,
  has_function_privilege('authenticated','public.claim_episode_source_changes_v1(integer,integer)','EXECUTE') b,
  has_table_privilege('anon','public.episode_source_change_queue','SELECT') c`)).rows[0];
assert.deepEqual(grants, { a: false, b: false, c: false });

console.log('youtube source-change SQL tests: OK');
