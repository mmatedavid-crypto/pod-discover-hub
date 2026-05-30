import { readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const SAMPLE_LIMIT = Number(process.env.AUDIT_SAMPLE_LIMIT || 100);

function loadDotEnv() {
  if (!existsSync(".env")) return;
  const lines = readFileSync(".env", "utf8").split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]]) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
  }
}

const SOCIAL_RX = /\b(instagram|insta|facebook|tiktok|youtube|spotify|apple podcasts?|patreon|discord|telegram|linkedin|twitter|x\.com|threads|whatsapp|rss)\b/i;
const CTA_RX = /\b(kövess|kövessetek|iratkozz|feliratkoz|hallgasd meg|támogasd|lájkold|oszd meg|subscribe|follow us|support us|listen on)\b/i;
const URL_RX = /https?:\/\/|www\./i;
const EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function cleanJoin(row) {
  const value = row.episode_clean_text;
  return Array.isArray(value) ? value[0] || null : value || null;
}

function countArray(value) {
  return Array.isArray(value) ? value.filter(Boolean).length : 0;
}

function countOrganizations(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return 0;
  return Object.keys(value).length;
}

function score(row, embeddedIds) {
  const cleanRow = cleanJoin(row);
  const raw = row.description || "";
  const clean = cleanRow?.cleaned_text || "";
  const rawLength = raw.trim().length;
  const cleanLength = clean.trim().length;
  const retentionRatio = rawLength > 0 ? cleanLength / rawLength : null;
  const dirtySignals = [];
  const missingSignals = [];

  if (URL_RX.test(clean)) dirtySignals.push("url");
  if (SOCIAL_RX.test(clean)) dirtySignals.push("social");
  if (CTA_RX.test(clean)) dirtySignals.push("cta");
  if (EMAIL_RX.test(clean)) dirtySignals.push("email");
  if (rawLength > 500 && cleanLength < 80) dirtySignals.push("overcleaned");
  if (rawLength > 500 && retentionRatio !== null && retentionRatio > 0.9 && (SOCIAL_RX.test(raw) || URL_RX.test(raw) || CTA_RX.test(raw))) {
    dirtySignals.push("undercleaned");
  }

  if (row.clean_text_status !== "done") missingSignals.push("clean_text");
  if (!embeddedIds.has(row.id)) missingSignals.push("embedding");
  if (!row.ai_summary) missingSignals.push("summary");
  if (row.ai_entities_version < 4) missingSignals.push("entity_v4");

  const entityCount =
    countArray(row.people) +
    countArray(row.mentioned) +
    countArray(row.companies) +
    countOrganizations(row.organizations) +
    countArray(row.topics) +
    countArray(row.tickers);

  if (entityCount === 0) missingSignals.push("entities");

  return {
    id: row.id,
    title: row.title,
    podcast: row.podcasts?.display_title || row.podcasts?.title || "Unknown podcast",
    rawLength,
    cleanLength,
    retentionRatio,
    dirtySignals,
    missingSignals,
    entityCount,
    risk: dirtySignals.includes("overcleaned") || dirtySignals.length >= 2 || missingSignals.includes("entities")
      ? "bad"
      : dirtySignals.length > 0 || missingSignals.length > 1
        ? "watch"
        : "ok",
  };
}

function pct(n, d) {
  return d ? `${Math.round((n / d) * 100)}%` : "-";
}

loadDotEnv();

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL/VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/VITE_SUPABASE_PUBLISHABLE_KEY.");
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { persistSession: false } });

const snapshotLimit = Math.min(Math.max(SAMPLE_LIMIT, 1), 50);
const snapshot = await supabase.rpc("get_data_quality_snapshot_v1", {
  _recent_days: 30,
  _sample_limit: snapshotLimit,
});

if (!snapshot.error && snapshot.data) {
  const s = snapshot.data;
  const eligible = Number(s.eligible_hu_episodes || 0);
  const recentEligible = Number(s.recent_eligible_hu_episodes || 0);
  const withIssues = Number(s.episodes_with_issues || 0);
  const recentWithIssues = Number(s.recent_episodes_with_issues || 0);
  const issueCounts = s.issue_counts || {};
  const recentIssueCounts = s.recent_issue_counts || {};
  const qualityIssueCounts = s.quality_indicator_issue_counts || {};
  const recentQualityIssueCounts = s.recent_quality_indicator_issue_counts || {};
  const qualityWithIssues = Number(s.episodes_with_quality_indicator_issues || 0);
  const recentQualityWithIssues = Number(s.recent_episodes_with_quality_indicator_issues || 0);

  console.log("Podiverzum Data Quality Snapshot");
  console.log(`Generated: ${s.generated_at}`);
  console.log(`Eligible HU episodes: ${eligible}`);
  console.log(`Episodes with issues: ${pct(withIssues, eligible)} (${withIssues}/${eligible})`);
  console.log(`Recent ${s.recent_days || 30}d eligible HU episodes: ${recentEligible}`);
  console.log(`Recent episodes with issues: ${pct(recentWithIssues, recentEligible)} (${recentWithIssues}/${recentEligible})`);
  console.log(`Quality indicator issues: ${pct(qualityWithIssues, eligible)} (${qualityWithIssues}/${eligible})`);
  console.log(`Recent quality indicator issues: ${pct(recentQualityWithIssues, recentEligible)} (${recentQualityWithIssues}/${recentEligible})`);
  console.log("");
  console.log("Issue counts:");
  for (const [code, total] of Object.entries(issueCounts).sort((a, b) => Number(b[1]) - Number(a[1]))) {
    const recent = recentIssueCounts[code] || 0;
    console.log(`- ${code}: ${total} (recent: ${recent})`);
  }
  console.log("");
  console.log("Quality indicator issue counts:");
  for (const [code, total] of Object.entries(qualityIssueCounts).sort((a, b) => Number(b[1]) - Number(a[1]))) {
    const recent = recentQualityIssueCounts[code] || 0;
    console.log(`- ${code}: ${total} (recent: ${recent})`);
  }
  console.log("");
  console.log("Highest-priority repair queue:");
  for (const item of s.top_episodes || []) {
    const keep = item.retention_ratio === null || item.retention_ratio === undefined
      ? "-"
      : `${Math.round(Number(item.retention_ratio) * 100)}%`;
    console.log(`- [${item.priority_score}] ${item.podcast} — ${item.title}`);
    console.log(`  raw=${item.raw_length} clean=${item.clean_length} keep=${keep} entities=${item.entity_signal_count}`);
    console.log(`  issues=${Array.isArray(item.issue_codes) ? item.issue_codes.join(",") : "-"}`);
  }
  console.log("");
  console.log("Highest-priority quality indicator queue:");
  for (const item of s.top_quality_indicator_episodes || []) {
    console.log(`- [${item.quality_priority_score}] ${item.podcast} — ${item.title}`);
    console.log(`  podiverzum=${item.podiverzum_rank} computed_episode=${item.computed_episode_score} legacy_episode=${item.legacy_episode_rank}`);
    console.log(`  quality_issues=${Array.isArray(item.quality_issue_codes) ? item.quality_issue_codes.join(",") : "-"}`);
    console.log(`  data_issues=${Array.isArray(item.data_issue_codes) ? item.data_issue_codes.join(",") : "-"}`);
  }
  process.exit(0);
}

if (snapshot.error) {
  console.warn(`Data quality snapshot RPC unavailable, falling back to sample audit: ${snapshot.error.message}`);
}

const { data, error } = await supabase
  .from("episodes")
  .select("id,title,description,clean_text_status,ai_entities_version,ai_summary,people,mentioned,companies,organizations,topics,tickers,published_at,podcasts!inner(title,display_title,is_hungarian,shadow_rank_tier)")
  .eq("podcasts.is_hungarian", true)
  .order("published_at", { ascending: false, nullsFirst: false })
  .limit(SAMPLE_LIMIT);

if (error) {
  console.error(error.message);
  process.exit(1);
}

const rows = data || [];
const ids = rows.map((r) => r.id);
const [emb, clean] = ids.length
  ? await Promise.all([
      supabase.from("episode_embeddings").select("episode_id").in("episode_id", ids),
      supabase.from("episode_clean_text").select("episode_id,cleaned_text,cleaner_method,removed_categories,updated_at").in("episode_id", ids),
    ])
  : [{ data: [] }, { data: [] }];

if (emb.error) {
  console.error(emb.error.message);
  process.exit(1);
}
if (clean.error) {
  console.error(clean.error.message);
  process.exit(1);
}

const embeddedIds = new Set((emb.data || []).map((r) => r.episode_id));
const cleanById = new Map((clean.data || []).map((r) => [r.episode_id, r]));
const scores = rows.map((row) => score({ ...row, episode_clean_text: cleanById.get(row.id) || null }, embeddedIds));
const summary = {
  sampleSize: scores.length,
  cleanDone: scores.filter((s) => !s.missingSignals.includes("clean_text")).length,
  embedded: scores.filter((s) => embeddedIds.has(s.id)).length,
  entityBackfilled: scores.filter((s) => !s.missingSignals.includes("entity_v4")).length,
  dirtyCleanText: scores.filter((s) => s.dirtySignals.some((x) => ["url", "social", "cta", "email"].includes(x))).length,
  overCleaned: scores.filter((s) => s.dirtySignals.includes("overcleaned")).length,
  underCleaned: scores.filter((s) => s.dirtySignals.includes("undercleaned")).length,
  noEntities: scores.filter((s) => s.missingSignals.includes("entities")).length,
  noSummary: scores.filter((s) => s.missingSignals.includes("summary")).length,
};

console.log("Podiverzum Intelligence Audit");
console.log(`Sample: ${summary.sampleSize} recent Hungarian episodes`);
console.log(`Clean text: ${pct(summary.cleanDone, summary.sampleSize)} (${summary.cleanDone}/${summary.sampleSize})`);
console.log(`Embeddings: ${pct(summary.embedded, summary.sampleSize)} (${summary.embedded}/${summary.sampleSize})`);
console.log(`Entity v4: ${pct(summary.entityBackfilled, summary.sampleSize)} (${summary.entityBackfilled}/${summary.sampleSize})`);
console.log(`Dirty clean text: ${summary.dirtyCleanText}`);
console.log(`Overcleaned: ${summary.overCleaned}`);
console.log(`Undercleaned: ${summary.underCleaned}`);
console.log(`No entities: ${summary.noEntities}`);
console.log(`No summary: ${summary.noSummary}`);
console.log("");
console.log("Highest-risk sample:");

for (const item of scores.filter((s) => s.risk !== "ok").slice(0, 15)) {
  const keep = item.retentionRatio === null ? "-" : `${Math.round(item.retentionRatio * 100)}%`;
  console.log(`- [${item.risk}] ${item.podcast} — ${item.title}`);
  console.log(`  raw=${item.rawLength} clean=${item.cleanLength} keep=${keep} entities=${item.entityCount}`);
  console.log(`  signals=${item.dirtySignals.join(",") || "-"} missing=${item.missingSignals.join(",") || "-"}`);
}
