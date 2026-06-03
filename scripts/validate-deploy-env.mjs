const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "yoxewklaybougzpmzvkg";

const required = [
  "SUPABASE_ACCESS_TOKEN",
  "SUPABASE_DB_PASSWORD",
  "SUPABASE_READONLY_DATABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "VITE_SUPABASE_URL",
];

const failures = [];

for (const name of required) {
  if (!process.env[name]) failures.push(`${name} is missing`);
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || "";
const readonlyUrl = process.env.SUPABASE_READONLY_DATABASE_URL || "";

if (supabaseUrl && !supabaseUrl.includes(PROJECT_REF)) {
  failures.push("VITE_SUPABASE_URL does not contain SUPABASE_PROJECT_REF");
}

if (readonlyUrl && !readonlyUrl.includes(PROJECT_REF)) {
  failures.push("SUPABASE_READONLY_DATABASE_URL does not contain SUPABASE_PROJECT_REF");
}

if (failures.length > 0) {
  console.error("Deploy environment validation failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Deploy environment validation passed for Supabase project ${PROJECT_REF}.`);
