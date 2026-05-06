#!/usr/bin/env node
/**
 * Stream the Podcast Index SQLite dump to pi-dump-ingest in batches.
 *
 * Prerequisites:
 *   1. Download + extract the latest dump:
 *        curl -L -o podcastindex_feeds.db.tgz \
 *          https://public.podcastindex.org/podcastindex_feeds.db.tgz
 *        tar -xzf podcastindex_feeds.db.tgz
 *      (Or use the IPNS address: ipns://k51qzi5uqu5dkde1r01kchnaieukg7xy9i6eu78kk3mm3vaa690oaotk1px6wo/podcastindex_feeds.db.tgz)
 *   2. npm i better-sqlite3 node-fetch
 *   3. Set env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DUMP_PATH=./podcastindex_feeds.db
 *   4. node scripts/import-pi-dump.mjs
 *
 * Filters at SQL level:
 *   - English only (language LIKE 'en%')
 *   - Not dead, last HTTP 200/301/302
 *   - Newest item within the last 90 days
 */
import Database from "better-sqlite3";
import fetch from "node-fetch";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DUMP_PATH = process.env.DUMP_PATH || "./podcastindex_feeds.db";
const BATCH = Number(process.env.BATCH || 1000);
const SNAPSHOT = process.env.SNAPSHOT_DATE || new Date().toISOString().slice(0, 10);

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = new Database(DUMP_PATH, { readonly: true });
const cutoff = Math.floor(Date.now() / 1000) - 90 * 86400;
const stmt = db.prepare(`
  SELECT id, url, title, link, description, language, imageUrl AS image,
         episodeCount, newestItemPubdate, lastHttpStatus, dead, itunesAuthor
  FROM podcasts
  WHERE dead = 0
    AND lastHttpStatus IN (200, 301, 302)
    AND language LIKE 'en%'
    AND newestItemPubdate >= ?
`);

let importId = null;
let buf = [];
let total = 0;

async function flush(finalize = false) {
  if (!buf.length && !finalize) return;
  const body = { feeds: buf, finalize };
  if (importId) body.import_id = importId; else body.snapshot_date = SNAPSHOT;
  const res = await fetch(`${SUPABASE_URL}/functions/v1/pi-dump-ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${SERVICE_KEY}` },
    body: JSON.stringify(body),
  });
  const j = await res.json();
  if (!res.ok) { console.error("ingest error", j); process.exit(1); }
  importId = j.import_id;
  total += buf.length;
  console.log(`sent ${buf.length} (total ${total}) → inserted=${j.inserted} dup=${j.duplicates_in_batch} alreadyImported=${j.already_in_podcasts}`);
  buf = [];
}

for (const row of stmt.iterate(cutoff)) {
  buf.push(row);
  if (buf.length >= BATCH) await flush(false);
}
await flush(true);
console.log(`Done. import_id=${importId}, total feeds sent=${total}`);
console.log(`Now invoke pi-dump-process repeatedly (e.g. via /admin/growth → "Process next batch") until done.`);
