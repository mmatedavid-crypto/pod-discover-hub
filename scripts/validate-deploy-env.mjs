const required = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_READONLY_DATABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
];

const missing = required.filter((key) => !String(process.env[key] || "").trim());

if (missing.length) {
  console.error("Missing required GitHub Actions secret(s) for Supabase backend deploy:");
  for (const key of missing) console.error(`- ${key}`);
  console.error("Add these in GitHub repo Settings -> Secrets and variables -> Actions, then rerun Deploy Supabase backend.");
  process.exit(1);
}

console.log("Deploy environment secrets are present.");
