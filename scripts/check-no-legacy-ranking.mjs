#!/usr/bin/env node
// CI static check — fails if legacy ranking identifiers reappear in live code.
//
// Forbidden tokens (outside comments/docs and a small allow-list):
//   - recompute-ranks      (deprecated edge function)
//   - episode_rank         (frozen legacy column)
//   - episode_rank_label   (frozen legacy column)
//   - episode_rank_reason  (frozen legacy column)
//
// Allow-listed paths (where references are EXPECTED — comments, types, audit script):
const ALLOW = [
  "src/integrations/supabase/types.ts", // auto-generated DB types
  "scripts/check-no-legacy-ranking.mjs", // this file
  "src/lib/episodeRank.ts",              // doc-only mention in header comment
  "src/components/EpisodeCard.tsx",      // doc-only mention in header comment
  "src/lib/search.ts",                   // doc-only mention in header comment
  "src/pages/AdminPage.tsx",             // Formula C audit panel (UI labels)
  "supabase/functions/seo-enrich-enqueue/index.ts", // doc-only mention in contract header
  "supabase/functions/daily-growth-run/index.ts",   // doc-only mention warning future devs
  "supabase/functions/data-repair-apply-runner/index.ts", // no-AI cleanup that neutralizes frozen legacy fields
];

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = process.cwd();
const FORBIDDEN = [/\brecompute-ranks\b/, /\bepisode_rank\b/, /\bepisode_rank_label\b/, /\bepisode_rank_reason\b/];
const SCAN_DIRS = ["src", "supabase/functions"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "coverage"]);

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry)) yield full;
  }
}

// Strip line + block comments (rough — good enough for grep-style gating).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/([^:])\/\/.*$/gm, "$1");
}

let violations = 0;
for (const dir of SCAN_DIRS) {
  for (const file of walk(join(ROOT, dir))) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    if (ALLOW.includes(rel)) continue;
    const raw = readFileSync(file, "utf8");
    const code = stripComments(raw);
    for (const pat of FORBIDDEN) {
      if (pat.test(code)) {
        const lines = raw.split("\n");
        const codeLines = code.split("\n");
        codeLines.forEach((ln, i) => {
          if (pat.test(ln)) {
            console.error(`✗ ${rel}:${i + 1} — forbidden token ${pat} in live code: ${lines[i]?.trim().slice(0, 120)}`);
            violations++;
          }
        });
      }
    }
  }
}

if (violations) {
  console.error(`\nFAIL: ${violations} legacy-ranking violation(s). Move usage to comments or add to ALLOW list with justification.`);
  process.exit(1);
}
console.log("OK: no live legacy-ranking references found.");
