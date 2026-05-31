import fs from "node:fs";

Object.defineProperty(globalThis, "Deno", {
  value: { env: { get: () => "" } },
  configurable: true,
});

const { heuristicClean, assessCleanTextQuality } = await import("../supabase/functions/_shared/episode-text-cleaner.ts");

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("Usage: node scripts/evaluate-clean-text-gold.mjs path/to/clean-text-gold.csv");
  process.exit(1);
}

function parseCsv(input) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (quoted) {
      if (ch === "\"" && next === "\"") {
        cell += "\"";
        i += 1;
      } else if (ch === "\"") {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === "\"") {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return normalize(text).split(" ").filter((token) => token.length >= 2);
}

function tokenF1(a, b) {
  const aTokens = tokens(a);
  const bTokens = tokens(b);
  if (aTokens.length === 0 && bTokens.length === 0) return 1;
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const counts = new Map();
  for (const token of aTokens) counts.set(token, (counts.get(token) || 0) + 1);
  let overlap = 0;
  for (const token of bTokens) {
    const count = counts.get(token) || 0;
    if (count > 0) {
      overlap += 1;
      counts.set(token, count - 1);
    }
  }
  const precision = overlap / aTokens.length;
  const recall = overlap / bTokens.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function average(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pct(value) {
  return Number((value * 100).toFixed(2));
}

const rawCsv = fs.readFileSync(csvPath, "utf8").replace(/^\uFEFF/, "");
const parsed = parseCsv(rawCsv);
const header = parsed.shift()?.map((name) => name.trim()) || [];
const required = ["episode_id", "sample_bucket", "raw_text", "current_cleaned_text", "gold_cleaned_text"];
const missing = required.filter((name) => !header.includes(name));
if (missing.length > 0) {
  console.error(`Missing required columns: ${missing.join(", ")}`);
  process.exit(1);
}

const rows = parsed
  .filter((cells) => cells.some((cell) => String(cell || "").trim()))
  .map((cells) => Object.fromEntries(header.map((name, index) => [name, cells[index] || ""])));

const usable = rows.filter((row) => row.raw_text.trim() && row.gold_cleaned_text.trim());
const bucketStats = new Map();
const failures = [];
const candidateScores = [];
const currentScores = [];
let currentDirty = 0;
let candidateDirty = 0;
let candidateOvercut = 0;
let candidateBetter = 0;

for (const row of usable) {
  const rawText = row.raw_text;
  const currentText = row.current_cleaned_text;
  const goldText = row.gold_cleaned_text;
  const candidate = heuristicClean(rawText).text;
  const currentQuality = assessCleanTextQuality(rawText, currentText);
  const candidateQuality = assessCleanTextQuality(rawText, candidate);
  const currentF1 = tokenF1(currentText, goldText);
  const candidateF1 = tokenF1(candidate, goldText);
  const bucket = row.sample_bucket || "unknown";
  const stat = bucketStats.get(bucket) || { rows: 0, currentF1: [], candidateF1: [], dirty: 0, overcut: 0 };
  stat.rows += 1;
  stat.currentF1.push(currentF1);
  stat.candidateF1.push(candidateF1);
  if (candidateQuality.dirty_signals.length > 0) stat.dirty += 1;
  if (candidateQuality.overcut_risk) stat.overcut += 1;
  bucketStats.set(bucket, stat);

  currentScores.push(currentF1);
  candidateScores.push(candidateF1);
  if (currentQuality.dirty_signals.length > 0) currentDirty += 1;
  if (candidateQuality.dirty_signals.length > 0) candidateDirty += 1;
  if (candidateQuality.overcut_risk) candidateOvercut += 1;
  if (candidateF1 > currentF1 + 0.05) candidateBetter += 1;

  if (candidateQuality.overcut_risk || candidateQuality.dirty_signals.length > 0 || candidateF1 < 0.8) {
    failures.push({
      episode_id: row.episode_id,
      bucket,
      current_f1: Number(currentF1.toFixed(4)),
      candidate_f1: Number(candidateF1.toFixed(4)),
      candidate_quality: candidateQuality,
      candidate_preview: candidate.slice(0, 240),
      gold_preview: goldText.slice(0, 240),
    });
  }
}

const summary = {
  rows: rows.length,
  usable_rows: usable.length,
  current_avg_token_f1: Number(average(currentScores).toFixed(4)),
  candidate_avg_token_f1: Number(average(candidateScores).toFixed(4)),
  current_dirty_rate_pct: pct(currentDirty / Math.max(usable.length, 1)),
  candidate_dirty_rate_pct: pct(candidateDirty / Math.max(usable.length, 1)),
  candidate_overcut_rate_pct: pct(candidateOvercut / Math.max(usable.length, 1)),
  candidate_better_rows: candidateBetter,
  gates: {
    candidate_dirty_rate_ok: candidateDirty / Math.max(usable.length, 1) <= 0.05,
    candidate_overcut_rate_ok: candidateOvercut / Math.max(usable.length, 1) <= 0.01,
    candidate_gold_similarity_ok: average(candidateScores) >= 0.8,
  },
  buckets: Object.fromEntries(Array.from(bucketStats.entries()).map(([bucket, stat]) => [bucket, {
    rows: stat.rows,
    current_avg_token_f1: Number(average(stat.currentF1).toFixed(4)),
    candidate_avg_token_f1: Number(average(stat.candidateF1).toFixed(4)),
    candidate_dirty_rate_pct: pct(stat.dirty / Math.max(stat.rows, 1)),
    candidate_overcut_rate_pct: pct(stat.overcut / Math.max(stat.rows, 1)),
  }])),
  failures: failures.slice(0, 25),
};

console.log(JSON.stringify(summary, null, 2));
