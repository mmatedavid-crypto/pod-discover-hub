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
