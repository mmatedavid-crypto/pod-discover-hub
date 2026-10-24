// Isolated PostgreSQL regression test for clean-text derivation state (0078-0080):
// exact provenance, marking serialized against concurrent clean-text updates, old results
// never clobbering newer ones, failed writes never marked current, manual rows preserved,
// second dispatch a no-op. Needs a throwaway server (two real sessions); never production.
//   DERIV_PG_URL=postgres://postgres@localhost/postgres?host=/tmp/pgt&port=55432 node scripts/test-derivation-state-sql.mjs
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import postgres from 'postgres';

const url = process.env.DERIV_PG_URL;
if (!url) { console.error('DERIV_PG_URL required (throwaway database only)'); process.exit(2); }
const A = postgres(url, { max: 1, onnotice: () => {} });
const B = postgres(url, { max: 1, onnotice: () => {} });
const dir = new URL('../drizzle/migrations/', import.meta.url);
const files = (await readdir(dir)).filter((f) => /^00(78|79|80)_.*\.sql$/.test(f)).sort();
assert.equal(files.length, 3, `expected 0078-0080 migrations, got ${files}`);

await A.unsafe(`
 DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS cron CASCADE; DROP SCHEMA IF EXISTS auth CASCADE;
 CREATE SCHEMA public; CREATE SCHEMA cron; CREATE SCHEMA auth;
 DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
 CREATE TYPE public.app_role AS ENUM ('admin','user');
 CREATE FUNCTION public.has_role(_user_id uuid, _role app_role) RETURNS boolean LANGUAGE sql AS 'SELECT true';
 CREATE TABLE cron.job(jobid bigint PRIMARY KEY, jobname text, schedule text, active boolean, command text);
 CREATE TABLE cron.job_run_details(jobid bigint, start_time timestamptz, end_time timestamptz, status text, return_message text);
 CREATE TABLE public.app_settings(key text PRIMARY KEY, value jsonb, updated_at timestamptz DEFAULT now());
 CREATE TABLE public.podcasts(id uuid PRIMARY KEY, language_decision text, rank_label text);
 CREATE TABLE public.episodes(id uuid PRIMARY KEY, podcast_id uuid, published_at timestamptz DEFAULT now(), clean_text_status text DEFAULT 'done',
   ai_enriched_at timestamptz, topic_extraction_status text, topic_extraction_version int, topic_extracted_at timestamptz,
   ai_entities_version int, entity_extraction_evidence jsonb, seo_title text, seo_description text, ai_summary text, ai_summary_source text,
   people text[], mentioned text[], companies text[], tickers text[], topics text[], organizations jsonb);
 CREATE TABLE public.episode_clean_text(episode_id uuid PRIMARY KEY, cleaned_text text, cleaner_method text, source_type text, quality_status text);
 CREATE TABLE public.episode_clean_text_repair_backups(id bigserial, episode_id uuid, applied_at timestamptz, old_row jsonb, rolled_back_at timestamptz, downstream_invalidation text);
 CREATE TABLE public.episode_extracted_topics(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), episode_id uuid, raw_label text, normalized_label text, kind text, confidence numeric, rationale text, model text, extractor_version int, created_at timestamptz DEFAULT now());
 CREATE TABLE public.episode_organization_map(episode_id uuid, organization_id uuid, source text);
 CREATE FUNCTION public.get_episode_index_text(uuid, integer) RETURNS text LANGUAGE sql AS 'SELECT NULL::text';
 -- Simulated public-text guard (like enforce_hu_episode_public_ai_text): rejects a write.
 CREATE FUNCTION public.test_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.seo_title = 'boom' THEN RAISE EXCEPTION 'hu_guard'; END IF; RETURN NEW; END $$;
 CREATE TRIGGER test_guard BEFORE UPDATE ON public.episodes FOR EACH ROW EXECUTE FUNCTION public.test_guard();
`);
for (const f of files) await A.unsafe(await readFile(new URL(f, dir), 'utf8'));

const POD = '11111111-1111-4111-8111-111111111111';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const prefix = 'Ebben az epizódban Kovács Anna közgazdász a magyar lakáspiacról beszél, a kamatokról és a bérleti díjak alakulásáról az elmúlt két évben. '.repeat(2);
const textA = prefix + 'A végén a hitelfelvétel kockázatairól is szó esik részletesen.';
const textB = prefix + 'A végén Szabó Péter vendég a csok plusz programot elemzi.';
assert.equal(textA.slice(0, 200), textB.slice(0, 200), 'same first 200 chars');
const hash = async (t) => (await A`SELECT public.clean_text_content_hash(${t}) h`)[0].h;
const hA = await hash(textA), hB = await hash(textB);
assert.notEqual(hA, hB, 'different end => different full fingerprint');
const state = async (e) => (await A`SELECT * FROM public.episode_derivation_state WHERE episode_id = ${e}`)[0];
const ep = async (e) => (await A`SELECT * FROM public.episodes WHERE id = ${e}`)[0];
const seo = (e, h, title, primary = 'clean_text') => A`SELECT public.apply_episode_seo_result_v1(${e}::uuid, ${h}, ${primary}, ${A.json({ seo_title: title, seo_description: 'd', ai_summary: 's', ai_summary_source: 'description', people: ['X Y'], ai_entities_version: 2 })}) r`.then((r) => r[0].r);

await A.unsafe(`INSERT INTO public.podcasts VALUES ('${POD}','accept_hungarian','B');
  INSERT INTO public.app_settings(key, value) VALUES ('derivation_dispatch_controls','{"enabled":true,"per_run":20,"daily_cap":300}'),
    ('episode_topic_extractor_controls','{"tier_filter":["S","A","B","C"],"min_clean_chars":100}');`);
for (let n = 1; n <= 8; n++) {
  await A`INSERT INTO public.episodes(id, podcast_id, ai_enriched_at, topic_extraction_status, ai_entities_version) VALUES (${id(n)}, ${POD}, now(), 'done', 5)`;
  await A`INSERT INTO public.episode_clean_text VALUES (${id(n)}, ${textA}, 'deterministic_v4', 'rss', 'ok')`;
}

// 1) Exact provenance: a result built from version A is current only while A is live.
assert.equal(await seo(id(1), hA, 't-A'), 'applied_current');
assert.equal((await state(id(1))).seo_status, 'current');
await A`UPDATE public.episode_clean_text SET cleaned_text = ${textB} WHERE episode_id = ${id(1)}`;
let s = await state(id(1));
assert.equal(s.seo_status, 'stale', 'content change (different end, same 200-char prefix) invalidates');
assert.equal(s.clean_hash, hB);
// An old-version (A) result arriving after the change is written as an older version only.
assert.equal(await seo(id(1), hA, 't-A-late'), 'applied_older_version');
s = await state(id(1));
assert.equal(s.seo_status, 'stale'); assert.equal(s.seo_hash, hA, 'stage hash is never moved to the new version by an old result');
// Legacy job without provenance (null hash) never becomes current.
assert.equal(await seo(id(1), null, 't-legacy', 'unknown'), 'applied_older_version');
assert.equal((await state(id(1))).seo_status, 'stale');
// New-version result -> current; afterwards an old or unknown result is superseded and writes nothing.
assert.equal(await seo(id(1), hB, 't-B'), 'applied_current');
assert.equal(await seo(id(1), hA, 't-A-very-late'), 'superseded');
assert.equal(await seo(id(1), null, 't-legacy-2', 'unknown'), 'superseded');
assert.equal((await ep(id(1))).seo_title, 't-B', 'newer result is never clobbered');
assert.deepEqual((await ep(id(1))).people, null, 'SEO never rewrites entities of an evidence-extracted (v5) episode');

// 2) Race: result marking holds the clean row; a concurrent clean-text update waits and then invalidates.
await A`INSERT INTO public.episode_derivation_state(episode_id, clean_hash, clean_usable, seo_status, baseline) VALUES (${id(2)}, ${hA}, true, 'queued', 'test')`;
await A`BEGIN`;
assert.equal((await A`SELECT public.apply_episode_seo_result_v1(${id(2)}::uuid, ${hA}, 'clean_text', ${A.json({ seo_title: 'race-A', seo_description: 'd', ai_summary: 's' })}) r`)[0].r, 'applied_current');
let bDone = false;
const bUpd = B`UPDATE public.episode_clean_text SET cleaned_text = ${textB} WHERE episode_id = ${id(2)}`.then(() => { bDone = true; });
await new Promise((r) => setTimeout(r, 400));
assert.equal(bDone, false, 'clean-text update must wait for the in-flight mark');
await A`COMMIT`;
await bUpd;
s = await state(id(2));
assert.equal(s.seo_status, 'stale', 'newer invalidation wins after the mark commits');
assert.equal(s.clean_hash, hB);

// Reverse order: clean-text update first (uncommitted), the mark waits and then sees the new version.
await A`INSERT INTO public.episode_derivation_state(episode_id, clean_hash, clean_usable, seo_status, baseline) VALUES (${id(3)}, ${hA}, true, 'queued', 'test')`;
await B`BEGIN`;
await B`UPDATE public.episode_clean_text SET cleaned_text = ${textB} WHERE episode_id = ${id(3)}`;
let aRes = null;
const aMark = A`SELECT public.apply_episode_seo_result_v1(${id(3)}::uuid, ${hA}, 'clean_text', ${A.json({ seo_title: 'race2-A', seo_description: 'd', ai_summary: 's' })}) r`.then((r) => { aRes = r[0].r; });
await new Promise((r) => setTimeout(r, 400));
assert.equal(aRes, null, 'mark waits for the uncommitted clean-text update');
await B`COMMIT`;
await aMark;
assert.equal(aRes, 'applied_older_version');
assert.notEqual((await state(id(3))).seo_status, 'current', 'old version is never marked current after a concurrent change');

// 3) Failed persistence: nothing is marked current, nothing is half-written.
await A`INSERT INTO public.episode_derivation_state(episode_id, clean_hash, clean_usable, seo_status, entity_status, topic_status, baseline) VALUES (${id(4)}, ${hA}, true, 'queued', 'queued', 'queued', 'test')`;
await assert.rejects(seo(id(4), hA, 'boom'), /hu_guard/);
assert.equal((await state(id(4))).seo_status, 'queued', 'failed write leaves the stage queued');
await A`UPDATE public.episodes SET topic_extraction_status = 'in_progress' WHERE id = ${id(4)}`;
await A`INSERT INTO public.episode_extracted_topics(episode_id, raw_label, normalized_label, model) VALUES (${id(4)}, 'kézi téma', 'kézi téma', NULL), (${id(4)}, 'régi gépi', 'régi gépi', 'm')`;
await assert.rejects(A`SELECT public.apply_episode_topics_v1(${id(4)}::uuid, ${hA}, '[]'::jsonb, 1)`, /no_topic_rows/);
assert.equal((await ep(id(4))).topic_extraction_status, 'in_progress', 'empty topic result is never "done"');
assert.equal((await state(id(4))).topic_status, 'queued');
assert.equal((await A`SELECT public.apply_episode_topics_v1(${id(4)}::uuid, ${hA}, ${A.json([{ raw_label: 'új gépi', normalized_label: 'új gépi', kind: 'subject', confidence: 0.8, rationale: 'r', model: 'm' }])}, 1) r`)[0].r, 'applied_current');
const labels = (await A`SELECT normalized_label FROM public.episode_extracted_topics WHERE episode_id = ${id(4)} ORDER BY 1`).map((r) => r.normalized_label);
assert.deepEqual(labels, ['kézi téma', 'új gépi'], 'manual (model NULL) rows kept, older machine rows replaced');
assert.equal((await ep(id(4))).topic_extraction_status, 'done');

// Entities: reclassification decisions in the org map survive a re-extraction.
await A`INSERT INTO public.episode_organization_map VALUES (${id(4)}, gen_random_uuid(), 'reclassified_from_person'), (${id(4)}, gen_random_uuid(), 'entity_backfill_v5')`;
await A`UPDATE public.episodes SET ai_entities_version = 4 WHERE id = ${id(4)}`;
assert.equal((await A`SELECT public.apply_episode_entities_v1(${id(4)}::uuid, ${hA}, ${A.json({ people: ['Kovács Anna'], mentioned: [], organizations: [], entity_extraction_evidence: { version: 5, clean_hash: hA } })}, 'done', NULL) r`)[0].r, 'applied_current');
assert.deepEqual((await A`SELECT source FROM public.episode_organization_map WHERE episode_id = ${id(4)}`).map((r) => r.source), ['reclassified_from_person']);
s = await state(id(4));
assert.equal(s.entity_status, 'current'); assert.equal(s.entity_hash, hA);
assert.equal(s.person_review_status, 'blocked', 'paid person review paused => recorded as blocked, not activated');
assert.equal((await ep(id(4))).ai_entities_version, 5);

// 4) Skip/mark of an older version never overrides a newer invalidation.
await A`UPDATE public.episode_clean_text SET cleaned_text = ${textB} WHERE episode_id = ${id(4)}`;
const m = (await A`SELECT public.mark_episode_derivation_v1('topic', ${A.json([{ episode_id: id(4), used_hash: hA, result: 'not_applicable', reason: 'x' }])}) r`)[0].r;
assert.deepEqual(m, { ignored_other_version: 1 });
assert.equal((await state(id(4))).topic_status, 'stale');

// 5) Attribution/timestamp-only update: no dispatch. Dispatch is bounded and a second pass is a no-op.
await A`UPDATE public.episode_clean_text SET source_type = 'youtube', cleaner_method = 'deterministic_v4+youtube' WHERE episode_id = ${id(5)}`;
assert.equal(await state(id(5)), undefined, 'same content => no derivation work');
await A`UPDATE public.episode_clean_text SET cleaned_text = ${textB} WHERE episode_id = ${id(6)}`;
const d1 = await A`SELECT * FROM public.dispatch_stale_derivations_v1(20, false)`;
const d1ids = d1.map((r) => r.episode_id);
assert.ok(d1ids.includes(id(6)) && d1ids.includes(id(4)));
const r6 = d1.find((r) => r.episode_id === id(6));
assert.equal(r6.entity_action, 'queued', 'entity stage queued in its own runner, never via SEO');
assert.equal((await ep(id(6))).ai_entities_version, 4);
const d2 = await A`SELECT * FROM public.dispatch_stale_derivations_v1(20, false)`;
assert.equal(d2.length, 0, 'second dispatch over the same versions is a no-op');

// 6) Transcript-primary SEO that did not read clean text: independent, survives later clean changes.
await A`UPDATE public.episode_clean_text SET cleaned_text = ${textB} WHERE episode_id = ${id(7)}`;
assert.equal(await seo(id(7), null, 'tr', 'transcript'), 'applied_transcript_independent');
await A`UPDATE public.episode_clean_text SET cleaned_text = ${textA} WHERE episode_id = ${id(7)}`;
s = await state(id(7));
assert.equal(s.seo_status, 'not_applicable'); assert.equal(s.seo_block_reason, 'policy_seo_source_transcript');

// 7) Health items are computable.
const h = (await A`SELECT public.derivation_health_item_v1() r`)[0].r;
assert.equal(h.name, 'derivation_freshness'); assert.ok(h.by_stage.seo);
const rh = (await A`SELECT public.pipeline_runner_health_item_v1('x', 'nope', '%nope%', 0, 'b', interval '15 minutes', NULL) r`)[0].r;
assert.equal(rh.health, 'yellow');

await A.end(); await B.end();
console.log('derivation state SQL: all assertions passed');
