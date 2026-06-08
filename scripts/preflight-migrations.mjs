import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const migrationsDir = path.join(repoRoot, "supabase/migrations");

const args = process.argv.slice(2);
const lastArg = args.find((arg) => arg.startsWith("--last="));
const last = Number(lastArg?.split("=")[1] || 30);
const explicitFiles = args.filter((arg) => !arg.startsWith("--"));

function listMigrationFiles() {
  if (explicitFiles.length) {
    return explicitFiles.map((file) => path.resolve(repoRoot, file));
  }
  return fs.readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .slice(-Math.max(1, last))
    .map((name) => path.join(migrationsDir, name));
}

function normalizeWhitespace(input) {
  return String(input || "").replace(/\s+/g, " ").trim();
}

function parseCreateFunctions(sql) {
  const out = [];
  const rx = /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*(?:RETURNS\s+TABLE\s*\(([\s\S]*?)\)|RETURNS\s+([a-zA-Z0-9_.\s\[\]]+))/gi;
  let match;
  while ((match = rx.exec(sql))) {
    const [full, name, rawArgs, tableResult, scalarResult] = match;
    const before = sql.slice(0, match.index);
    const argsForLookup = rawArgs
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const cleaned = part
          .replace(/\bDEFAULT\b[\s\S]*$/i, "")
          .replace(/\s+/g, " ")
          .trim();
        const tokens = cleaned.split(" ");
        if (tokens.length >= 2 && !/^(IN|OUT|INOUT|VARIADIC)$/i.test(tokens[0])) {
          return `${tokens[0]} ${tokens.slice(1).join(" ")}`;
        }
        return cleaned;
      })
      .join(", ");
    const dropRx = new RegExp(`DROP\\s+FUNCTION\\s+IF\\s+EXISTS\\s+public\\.${name}\\s*\\(`, "i");
    out.push({
      name,
      argsForLookup,
      result: tableResult ? `TABLE(${normalizeWhitespace(tableResult)})` : normalizeWhitespace(scalarResult || ""),
      hasPriorDrop: dropRx.test(before),
      statement: full.slice(0, 300),
    });
  }
  return out;
}

function parseInsertColumns(sql) {
  const out = [];
  const rx = /INSERT\s+INTO\s+public\.([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\)\s*(?:VALUES|SELECT|WITH)/gi;
  let match;
  while ((match = rx.exec(sql))) {
    const [, table, rawColumns] = match;
    const columns = rawColumns
      .split(",")
      .map((part) => part.trim().replace(/^"|"$/g, ""))
      .filter((part) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(part));
    if (!columns.length) continue;
    out.push({ table, columns });
  }
  return out;
}

function runReadonlyQuery(sql) {
  const out = execFileSync(
    process.execPath,
    [path.join(repoRoot, "scripts/pg-readonly-query.mjs"), sql],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  return JSON.parse(out);
}

function sqlLiteral(value) {
  return String(value).replaceAll("'", "''");
}

function loadProductionFunction(name, argsForLookup) {
  if (!process.env.DATABASE_URL) return null;
  const result = runReadonlyQuery(`
    SELECT
      pg_get_function_arguments(p.oid) AS args,
      pg_get_function_result(p.oid) AS result
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = '${sqlLiteral(name)}'
      AND pg_get_function_arguments(p.oid) = '${sqlLiteral(argsForLookup)}'
    LIMIT 1;
  `);
  return result.rows?.[0] || null;
}

const columnCache = new Map();
function loadProductionColumns(table) {
  if (!process.env.DATABASE_URL) return null;
  if (columnCache.has(table)) return columnCache.get(table);
  const result = runReadonlyQuery(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = '${sqlLiteral(table)}';
  `);
  const columns = new Set((result.rows || []).map((row) => row.column_name));
  columnCache.set(table, columns);
  return columns;
}

const files = listMigrationFiles();
const findings = [];
const checked = [];

for (const file of files) {
  const rel = path.relative(repoRoot, file);
  const sql = fs.readFileSync(file, "utf8");
  if (
    rel.endsWith("20260608001000_search_timestamp_match_telemetry.sql")
    || rel.endsWith("20260608184421_eeac6b6a-4280-4d98-bd77-7f5921cf5ecc.sql")
  ) {
    checked.push({ type: "search_timestamp_match_telemetry_contract", file: rel });
    const required = [
      "ADD COLUMN IF NOT EXISTS timestamp_match_count integer NOT NULL DEFAULT 0",
      "ADD COLUMN IF NOT EXISTS chunk_augmented_count integer NOT NULL DEFAULT 0",
      "CREATE INDEX IF NOT EXISTS search_events_timestamp_matches_idx",
      "search_events.timestamp_match_count telemetry column missing",
      "search_events.chunk_augmented_count telemetry column missing",
    ];
    const missing = required.filter((needle) => !sql.includes(needle));
    if (missing.length) {
      findings.push({
        file: rel,
        issue: "search_timestamp_match_telemetry_contract_missing",
        missing,
      });
    }
  }
  const functions = parseCreateFunctions(sql);
  const insertColumns = parseInsertColumns(sql);
  for (const fn of functions) {
    if (!fn.result.toUpperCase().startsWith("TABLE(")) continue;
    checked.push({ type: "returns_table_shape", file: rel, name: fn.name, args: fn.argsForLookup, has_prior_drop: fn.hasPriorDrop });
    const production = loadProductionFunction(fn.name, fn.argsForLookup);
    if (!production) continue;
    const nextResult = normalizeWhitespace(fn.result);
    const currentResult = normalizeWhitespace(production.result);
    if (nextResult !== currentResult && !fn.hasPriorDrop) {
      findings.push({
        file: rel,
        function: fn.name,
        args: fn.argsForLookup,
        issue: "returns_table_shape_changes_without_prior_drop",
        current_result: currentResult,
        migration_result: nextResult,
      });
    }
  }
  for (const insert of insertColumns) {
    checked.push({ type: "insert_columns", file: rel, table: insert.table, columns: insert.columns });
    const productionColumns = loadProductionColumns(insert.table);
    if (!productionColumns) continue;
    const missingColumns = insert.columns.filter((column) => !productionColumns.has(column));
    if (missingColumns.length) {
      findings.push({
        file: rel,
        table: insert.table,
        issue: "insert_references_missing_columns",
        missing_columns: missingColumns,
      });
    }
  }
}

const output = {
  ok: findings.length === 0,
  checked_count: checked.length,
  checked,
  findings,
};

console.log(JSON.stringify(output, null, 2));
if (findings.length) process.exit(1);
