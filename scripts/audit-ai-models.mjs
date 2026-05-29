import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const files = execFileSync("rg", ["--files", "supabase/functions"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .filter((file) => file.endsWith(".ts"));

const MODEL_RE = /(?:model|MODEL|retryModel|retry_model)\s*[:=]\s*["'`]([^"'`]+)["'`]/g;
const BLOCKED = [
  { re: /(?:^|\/)gpt-5(?:\.|\b)(?!-mini|-nano)/i, reason: "gpt5_full_or_preview_not_allowed_for_batch" },
  { re: /gpt-5\.5/i, reason: "gpt5_5_not_allowed_for_batch" },
  { re: /gemini-.*-pro/i, reason: "gemini_pro_not_allowed_for_batch" },
  { re: /gemini-3/i, reason: "gemini_3_not_allowed_for_batch" },
];
const REVIEW = [
  { re: /gemini-2\.5-flash$/i, reason: "review_if_flash_lite_is_enough" },
  { re: /cohere|rerank/i, reason: "paid_rerank_needs_budget_and_benchmark" },
  { re: /gemini-embedding-001/i, reason: "review_embedding_model_cost_vs_text_embedding_004" },
];

const rows = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    MODEL_RE.lastIndex = 0;
    let match;
    while ((match = MODEL_RE.exec(line))) {
      const model = match[1];
      const blocked = BLOCKED.find((rule) => rule.re.test(model));
      const review = REVIEW.find((rule) => rule.re.test(model));
      rows.push({
        file: relative(root, file),
        line: i + 1,
        model,
        status: blocked ? "blocked" : review ? "review" : "ok",
        reason: blocked?.reason || review?.reason || "",
      });
    }
  }
}

const blocked = rows.filter((row) => row.status === "blocked");
const review = rows.filter((row) => row.status === "review");

console.log(JSON.stringify({
  ok: blocked.length === 0,
  model_refs: rows.length,
  blocked_count: blocked.length,
  review_count: review.length,
  blocked,
  review,
}, null, 2));

if (blocked.length > 0) process.exit(1);
