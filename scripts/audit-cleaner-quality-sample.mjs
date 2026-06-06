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
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = Math.max(10, Math.min(1000, Number(limitArg?.split("=")[1] || 300)));

if (!process.env.DATABASE_URL) {
  console.error("Missing DATABASE_URL.");
  process.exit(1);
}

const sql = `
select
  e.id,
  left(coalesce(e.description,e.summary,''), 6000) as raw_text,
  ct.cleaned_text as old_cleaned,
  ct.removed_categories,
  p.title as podcast_title,
  e.title as episode_title
from public.episodes e
join public.podcasts p on p.id=e.podcast_id
join public.episode_clean_text ct on ct.episode_id=e.id
where p.language_decision='accept_hungarian'
  and ct.cleaner_method='deterministic_v3'
  and length(coalesce(e.description,e.summary,'')) between 300 and 6000
  and (
    coalesce(e.description,e.summary,'') ~*
    '(https?://|www\\.|instagram|facebook|spotify|youtube|tiktok|patreon|jogi nyilatkozat|disclaimer|kövesd|iratkozz|támogasd|foglalj|jelentkezz|regisztr|rendeld|weboldal|honlap|linkek|megaphone\\.fm|omnystudio\\.com)'
  )
order by random()
limit ${limit};
`;

const out = execFileSync(
  process.execPath,
  [path.join(repoRoot, "scripts/pg-readonly-query.mjs"), sql],
  { cwd: repoRoot, env: process.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
);
const { rows } = JSON.parse(out);

function norm(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function dirtySignals(text) {
  const s = String(text || "");
  const signals = [];
  if (/https?:\/\/|www\.|(?:open\.)?spotify\.com|podcasts\.apple\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|patreon\.com|linktr\.ee|megaphone\.fm|omnystudio\.com/i.test(s)) signals.push("url_or_platform");
  if (/@[A-Za-z0-9_.-]+/.test(s)) signals.push("handle");
  if (/\b(?:kövesd|kövess|iratkozz|feliratkoz|támogasd|támogass|adomány|bankszámla|hallgasd|nézd|nézzétek|listen|subscribe|follow|support|learn more about your ad choices)\b/i.test(s)) signals.push("cta");
  if (/\b(?:jogi\s+(?:nyilatkozat|figyelmeztetés)|disclaimer|legal|not\s+(?:financial|investment|legal)\s+advice)\b/i.test(s)) signals.push("legal");
  if (/(?:#[A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű0-9_]+\s*){2,}/.test(s)) signals.push("hashtag_wall");
  if (/\b(?:facebook|instagram|youtube|spotify|patreon|weboldal|honlap|e-?mail)\s*[:：]\s*(?:$|[A-ZÁÉÍÓÖŐÚÜŰ]|#)/i.test(s)) signals.push("dangling_label");
  return signals;
}

function snippet(text, max = 260) {
  const s = norm(text);
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

const stats = {
  sampled: rows.length,
  identical: 0,
  changed: 0,
  old_dirty: 0,
  new_dirty: 0,
  dirty_removed: 0,
  dirty_added_or_kept: 0,
  shorter: 0,
  much_shorter: 0,
  longer: 0,
  possible_overcut: 0,
  possible_improvement: 0,
  needs_ai_trim: 0,
  quality_ok: 0,
};

const examples = {
  improved: [],
  still_dirty: [],
  overcut_risk: [],
  identical_dirty: [],
};

for (const row of rows) {
  const oldText = norm(row.old_cleaned);
  const fresh = heuristicClean(row.raw_text);
  const newText = norm(fresh.text);
  const quality = assessCleanTextQuality(row.raw_text, newText);
  const oldDirty = dirtySignals(oldText);
  const newDirty = quality.dirty_signals;
  const oldLen = oldText.length;
  const newLen = newText.length;
  const ratio = oldLen ? newLen / oldLen : 0;

  if (oldText === newText) stats.identical += 1;
  else stats.changed += 1;
  if (oldDirty.length) stats.old_dirty += 1;
  if (newDirty.length) stats.new_dirty += 1;
  if (oldDirty.length && !newDirty.length) stats.dirty_removed += 1;
  if (newDirty.length) stats.dirty_added_or_kept += 1;
  if (newLen < oldLen) stats.shorter += 1;
  if (newLen < oldLen * 0.85) stats.much_shorter += 1;
  if (newLen > oldLen) stats.longer += 1;

  const overcutRisk = quality.overcut_risk;
  const improvement = oldDirty.length && !newDirty.length && newLen >= 80 && ratio >= 0.35;
  if (overcutRisk) stats.possible_overcut += 1;
  if (improvement) stats.possible_improvement += 1;
  if (quality.needs_ai_trim) stats.needs_ai_trim += 1;
  if (quality.ok) stats.quality_ok += 1;

  const base = {
    episode_id: row.id,
    podcast: row.podcast_title,
    episode: row.episode_title,
    old_len: oldLen,
    new_len: newLen,
    ratio: Number(ratio.toFixed(2)),
    old_dirty: oldDirty,
    new_dirty: newDirty,
    quality_reasons: quality.reasons,
    removed: fresh.removed,
    old: snippet(oldText),
    new: snippet(newText),
  };

  if (improvement && examples.improved.length < 5) examples.improved.push(base);
  if (newDirty.length && examples.still_dirty.length < 5) examples.still_dirty.push(base);
  if (overcutRisk && examples.overcut_risk.length < 5) examples.overcut_risk.push(base);
  if (oldText === newText && oldDirty.length && examples.identical_dirty.length < 5) examples.identical_dirty.push(base);
}

console.log(JSON.stringify({ ok: true, stats, examples }, null, 2));
