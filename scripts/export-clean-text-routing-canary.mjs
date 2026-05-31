import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

Object.defineProperty(globalThis, "Deno", {
  value: { env: { get: () => "" } },
  configurable: true,
});

const { heuristicClean, assessCleanTextQuality, classifyCleanTextRoute } = await import("../supabase/functions/_shared/episode-text-cleaner.ts");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const outArg = process.argv.find((arg) => arg.startsWith("--out="));
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const outputPath = outArg?.split("=").slice(1).join("=") || path.join(repoRoot, "clean-text-routing-canary.csv");
const targetRows = Math.max(10, Math.min(500, Number(limitArg?.split("=")[1] || 100)));

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL.");
  process.exit(1);
}

const columns = [
  "route_bucket",
  "route_action",
  "ai_policy",
  "route_reasons",
  "episode_id",
  "podcast_title",
  "episode_title",
  "tier",
  "source_type",
  "raw_len",
  "current_cleaned_len",
  "deterministic_cleaned_len",
  "clean_ratio",
  "dirty_signals",
  "quality_reasons",
  "raw_text",
  "current_cleaned_text",
  "deterministic_cleaned_text",
  "yt_description",
  "human_verdict",
  "human_gold_cleaned_text",
  "notes",
];

const routeQuotas = {
  short_rss: 15,
  radio_bulletin: 15,
  long_narrative: 15,
  yt_dominant: 20,
  sponsor_heavy: 20,
  over_trimmed_v3: 15,
  non_hungarian: 12,
  junk_no_content: 12,
  paid_preview: 8,
  transcript_or_article_like: 12,
};

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function csvCell(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replaceAll("\"", "\"\"")}"`;
  return s;
}

function normalizeEpisodeKey(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[#_()[\]{}"'.,:;!?|/\\-]+/g, " ")
    .replace(/\b(?:ism|ismetles|resz|part|episode|ep)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
  return `
with base as (
  select
    e.id as episode_id,
    e.podcast_id,
    p.title as podcast_title,
    coalesce(p.rank_label, '') as tier,
    e.title as episode_title,
    coalesce(e.description, e.summary, '') as rss_text,
    coalesce(ct.cleaned_text, '') as current_cleaned_text,
    length(coalesce(ct.cleaned_text, '')) as current_cleaned_len,
    coalesce(ct.cleaner_method, '') as cleaner_method,
    coalesce(bts.source_type, 'rss') as source_type,
    coalesce(bts.raw_text, e.description, e.summary, '') as best_raw_text,
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
  where p.is_hungarian = true
    and p.language_decision = 'accept_hungarian'
    and coalesce(e.description, e.summary, '') <> ''
    and ${predicate}
), diverse as (
  select *, row_number() over (partition by podcast_id order by ${orderBy}) as podcast_sample_rank
  from base
)
select
  ${sqlString(bucket)} as sample_seed,
  episode_id,
  podcast_title,
  tier,
  episode_title,
  source_type,
  left(best_raw_text, 12000) as raw_text,
  length(best_raw_text) as raw_len,
  current_cleaned_text,
  current_cleaned_len,
  left(yt_description, 12000) as yt_description
from diverse
where podcast_sample_rank <= 2
order by ${orderBy}
limit ${Math.ceil(targetRows * 0.6)};
`;
}

const seedBuckets = [
  {
    name: "short_rss",
    predicate: "length(coalesce(e.description, e.summary, '')) between 80 and 499",
    orderBy: "published_at desc nulls last, random()",
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
    name: "long_narrative",
    predicate: "length(coalesce(e.description, e.summary, '')) > 5000",
  },
  {
    name: "yt_dominant",
    predicate: `
      yt.youtube_description is not null
      and length(yt.youtube_description) >= greatest(length(coalesce(e.description, e.summary, '')) + 200, 500)
    `,
  },
  {
    name: "sponsor_heavy",
    predicate: `
      length(coalesce(e.description, e.summary, '')) >= 500
      and coalesce(e.description, e.summary, '') ~* '(https?://|www\\.|instagram|facebook|spotify|youtube|tiktok|patreon|discord|linktr\\.ee|kövesd|iratkozz|támogasd|feliratkoz|adomány|bankszámla|jogi nyilatkozat|disclaimer|szponzor|kupon)'
    `,
  },
  {
    name: "over_trimmed_v3",
    predicate: `
      length(coalesce(e.description, e.summary, '')) >= 500
      and ct.cleaned_text is not null
      and length(coalesce(ct.cleaned_text, '')) < greatest(80, length(coalesce(e.description, e.summary, '')) * 0.20)
    `,
  },
];

const seen = new Set();
const seenEpisodeKeys = new Set();
const routeCounts = new Map();
const outputRows = [];
const deferredRows = [];

for (const bucket of seedBuckets) {
  const rows = query(bucketSql(bucket.name, bucket.predicate, bucket.orderBy));
  for (const row of rows) {
    if (outputRows.length >= targetRows) break;
    if (seen.has(row.episode_id)) continue;
    const episodeKey = `${row.podcast_id || row.podcast_title}:${normalizeEpisodeKey(row.episode_title)}`;
    if (episodeKey.length > 12 && seenEpisodeKeys.has(episodeKey)) continue;
    const deterministic = heuristicClean(row.raw_text).text.trim();
    const quality = assessCleanTextQuality(row.raw_text, deterministic);
    const route = classifyCleanTextRoute(row.raw_text, deterministic, {
      sourceType: row.source_type,
      previousCleanedText: row.current_cleaned_text,
    });
    seen.add(row.episode_id);
    seenEpisodeKeys.add(episodeKey);
    const outRow = {
      route_bucket: route.bucket,
      route_action: route.action,
      ai_policy: route.ai_policy,
      route_reasons: route.reasons.join("|"),
      episode_id: row.episode_id,
      podcast_title: row.podcast_title,
      episode_title: row.episode_title,
      tier: row.tier,
      source_type: row.source_type,
      raw_len: row.raw_len,
      current_cleaned_len: row.current_cleaned_len,
      deterministic_cleaned_len: deterministic.length,
      clean_ratio: quality.clean_ratio,
      dirty_signals: quality.dirty_signals.join("|"),
      quality_reasons: quality.reasons.join("|"),
      raw_text: row.raw_text,
      current_cleaned_text: row.current_cleaned_text,
      deterministic_cleaned_text: deterministic,
      yt_description: row.yt_description,
      human_verdict: "",
      human_gold_cleaned_text: "",
      notes: "",
    };
    const currentCount = routeCounts.get(route.bucket) || 0;
    const quota = routeQuotas[route.bucket] ?? 10;
    if (currentCount >= quota) {
      deferredRows.push(outRow);
      continue;
    }
    routeCounts.set(route.bucket, currentCount + 1);
    outputRows.push(outRow);
  }
}

for (const row of deferredRows) {
  if (outputRows.length >= targetRows) break;
  routeCounts.set(row.route_bucket, (routeCounts.get(row.route_bucket) || 0) + 1);
  outputRows.push(row);
}

const csv = [
  columns.join(","),
  ...outputRows.map((row) => columns.map((column) => csvCell(row[column])).join(",")),
].join("\n");

fs.writeFileSync(outputPath, `${csv}\n`, "utf8");

console.log(JSON.stringify({
  ok: true,
  output_path: outputPath,
  rows: outputRows.length,
  target_rows: targetRows,
  route_counts: Object.fromEntries(Array.from(routeCounts.entries()).sort()),
}, null, 2));
