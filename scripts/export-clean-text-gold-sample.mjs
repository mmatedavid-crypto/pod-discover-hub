import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

Object.defineProperty(globalThis, "Deno", {
  value: { env: { get: () => "" } },
  configurable: true,
});

const { heuristicClean, assessCleanTextQuality } = await import("../supabase/functions/_shared/episode-text-cleaner.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const perBucketArg = process.argv.find((arg) => arg.startsWith("--per-bucket="));
const outArg = process.argv.find((arg) => arg.startsWith("--out="));
const perBucket = Math.max(1, Math.min(50, Number(perBucketArg?.split("=")[1] || 10)));
const outputPath = outArg?.split("=").slice(1).join("=") || path.join(repoRoot, "clean-text-gold-sample.csv");

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL.");
  process.exit(1);
}

const columns = [
  "episode_id",
  "podcast_title",
  "episode_title",
  "sample_bucket",
  "raw_text",
  "raw_len",
  "current_cleaned_text",
  "current_cleaned_len",
  "cleaner_method",
  "source_type",
  "yt_description",
  "quality_reasons",
  "notes_for_you",
  "gold_cleaned_text",
];

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function csvCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll("\"", "\"\"")}"`;
  return s;
}

function query(sql) {
  const out = execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts/pg-readonly-query.mjs"), sql],
    { cwd: repoRoot, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return JSON.parse(out).rows || [];
}

function bucketSql(bucket, predicate, orderBy = "random()") {
  const fetchLimit = perBucket * 6;
  return `
with base as (
  select
    e.id as episode_id,
    e.podcast_id,
    p.title as podcast_title,
    e.title as episode_title,
    coalesce(e.description, e.summary, '') as raw_text,
    length(coalesce(e.description, e.summary, '')) as raw_len,
    coalesce(ct.cleaned_text, '') as current_cleaned_text,
    length(coalesce(ct.cleaned_text, '')) as current_cleaned_len,
    coalesce(ct.cleaner_method, '') as cleaner_method,
    coalesce(bts.source_type, 'rss') as source_type,
    coalesce(yt.youtube_description, '') as yt_description,
    e.published_at
  from public.episodes e
  join public.podcasts p on p.id = e.podcast_id
  left join public.episode_clean_text ct on ct.episode_id = e.id
  left join public.episode_best_text_source bts on bts.episode_id = e.id
  left join lateral (
    select youtube_description
    from public.episode_youtube_links yl
    where yl.episode_id = e.id
      and yl.status = 'confirmed'
      and coalesce(yl.youtube_description, '') <> ''
    order by yl.match_score desc nulls last, yl.updated_at desc nulls last
    limit 1
  ) yt on true
  where p.language_decision = 'accept_hungarian'
    and coalesce(e.description, e.summary, '') <> ''
    and ${predicate}
), diverse as (
  select
    *,
    row_number() over (partition by podcast_id order by ${orderBy}) as podcast_sample_rank
  from base
)
select
  episode_id,
  podcast_title,
  episode_title,
  ${sqlString(bucket)} as sample_bucket,
  left(raw_text, 12000) as raw_text,
  raw_len,
  current_cleaned_text,
  current_cleaned_len,
  cleaner_method,
  source_type,
  left(yt_description, 12000) as yt_description
from diverse
where podcast_sample_rank <= 2
order by ${orderBy}
limit ${fetchLimit};
`;
}

const buckets = [
  {
    name: "short_rss",
    predicate: "length(coalesce(e.description, e.summary, '')) between 80 and 499",
    orderBy: "published_at desc nulls last, random()",
  },
  {
    name: "long_narrative",
    predicate: "length(coalesce(e.description, e.summary, '')) > 5000",
  },
  {
    name: "youtube_dominant",
    predicate: `
      yt.youtube_description is not null
      and length(yt.youtube_description) >= greatest(length(coalesce(e.description, e.summary, '')) + 200, 500)
    `,
  },
  {
    name: "sponsor_heavy",
    predicate: `
      length(coalesce(e.description, e.summary, '')) >= 500
      and coalesce(e.description, e.summary, '') ~* '(https?://|www\\.|instagram|facebook|spotify|youtube|tiktok|patreon|discord|linktr\\.ee|kövesd|iratkozz|támogasd|feliratkoz|adomány|bankszámla|jogi nyilatkozat|disclaimer)'
    `,
  },
  {
    name: "radio_bulletin",
    predicate: `
      length(coalesce(e.description, e.summary, '')) between 80 and 1800
      and (
        p.title ~* '(kossuth|inforádió|infostart|info rádió|hír|hirek|hírek|rádió|radio)'
        or e.title ~* '(hírek|hirek|krónika|délelőtt|délután|este|reggel|percek)'
      )
    `,
    orderBy: "published_at desc nulls last, random()",
  },
  {
    name: "suspected_overcut",
    predicate: `
      length(coalesce(e.description, e.summary, '')) >= 500
      and ct.cleaned_text is not null
      and length(coalesce(ct.cleaned_text, '')) < greatest(80, length(coalesce(e.description, e.summary, '')) * 0.20)
    `,
  },
];

const seen = new Set();
const outputRows = [];

for (const bucket of buckets) {
  const rows = query(bucketSql(bucket.name, bucket.predicate, bucket.orderBy));
  let acceptedForBucket = 0;
  for (const row of rows) {
    if (acceptedForBucket >= perBucket) break;
    if (seen.has(row.episode_id)) continue;
    seen.add(row.episode_id);
    acceptedForBucket += 1;
    const candidate = heuristicClean(row.raw_text).text;
    const quality = assessCleanTextQuality(row.raw_text, candidate);
    outputRows.push({
      episode_id: row.episode_id,
      podcast_title: row.podcast_title,
      episode_title: row.episode_title,
      sample_bucket: row.sample_bucket,
      raw_text: row.raw_text,
      raw_len: row.raw_len,
      current_cleaned_text: row.current_cleaned_text,
      current_cleaned_len: row.current_cleaned_len,
      cleaner_method: row.cleaner_method,
      source_type: row.source_type,
      yt_description: row.yt_description,
      quality_reasons: quality.reasons.join("|"),
      notes_for_you: "",
      gold_cleaned_text: "",
    });
  }
}

const csv = [
  columns.join(","),
  ...outputRows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
].join("\n");

fs.writeFileSync(outputPath, `${csv}\n`, "utf8");

const byBucket = outputRows.reduce((acc, row) => {
  acc[row.sample_bucket] = (acc[row.sample_bucket] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  ok: true,
  output_path: outputPath,
  rows: outputRows.length,
  per_bucket_requested: perBucket,
  buckets: byBucket,
}, null, 2));
