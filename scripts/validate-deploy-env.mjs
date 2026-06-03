const required = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_READONLY_DATABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
];

const missing = required.filter((key) => !String(process.env[key] || "").trim());
const projectRef = String(process.env.SUPABASE_PROJECT_REF || "").trim();
const supabaseUrl = String(process.env.VITE_SUPABASE_URL || "").trim();
const readonlyUrl = String(process.env.SUPABASE_READONLY_DATABASE_URL || "").trim();
const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || "").trim();
const accessToken = String(process.env.SUPABASE_ACCESS_TOKEN || "").trim();
const dbPassword = String(process.env.SUPABASE_DB_PASSWORD || "").trim();

if (missing.length) {
  console.error("Missing required GitHub Actions secret(s) for Supabase backend deploy:");
  for (const key of missing) console.error(`- ${key}`);
  console.error("Add these in GitHub repo Settings -> Secrets and variables -> Actions, then rerun Deploy Supabase backend.");
  process.exit(1);
}

const failures = [];

if (!projectRef) failures.push("SUPABASE_PROJECT_REF env is empty.");
if (projectRef && supabaseUrl && !supabaseUrl.includes(projectRef)) {
  failures.push("VITE_SUPABASE_URL does not contain SUPABASE_PROJECT_REF.");
}
if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(supabaseUrl)) {
  failures.push("VITE_SUPABASE_URL must look like https://<project-ref>.supabase.co.");
}
if (!/^postgres(ql)?:\/\//i.test(readonlyUrl)) {
  failures.push("SUPABASE_READONLY_DATABASE_URL must be a Postgres connection string.");
}
if (projectRef && readonlyUrl && !readonlyUrl.includes(projectRef)) {
  failures.push("SUPABASE_READONLY_DATABASE_URL does not contain SUPABASE_PROJECT_REF.");
}
if (!publishableKey.startsWith("eyJ")) {
  failures.push("SUPABASE_PUBLISHABLE_KEY should look like the Supabase anon/publishable JWT.");
}
if (accessToken.length < 20) {
  failures.push("SUPABASE_ACCESS_TOKEN is too short to be a valid Supabase access token.");
}
if (dbPassword.length < 12) {
  failures.push("SUPABASE_DB_PASSWORD is too short; use the project database password from Supabase/Lovable Cloud.");
}

if (failures.length) {
  console.error("Invalid Supabase backend deploy environment:");
  for (const failure of failures) console.error(`- ${failure}`);
  console.error("No secret values were printed. Fix GitHub Actions secrets/env, then rerun Deploy Supabase backend.");
  process.exit(1);
}

console.log("Deploy environment secrets are present and structurally valid.");
