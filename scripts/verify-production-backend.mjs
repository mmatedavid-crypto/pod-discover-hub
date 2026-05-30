const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://yoxewklaybougzpmzvkg.supabase.co";
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlveGV3a2xheWJvdWd6cG16dmtnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg1ODAxNDAsImV4cCI6MjA5NDE1NjE0MH0.R5tBT9VgFqWPvd5AYPIb16vJXmB7c116MSMfAuogwv8";

if (!SUPABASE_KEY) {
  console.error("Missing VITE_SUPABASE_PUBLISHABLE_KEY / SUPABASE_PUBLISHABLE_KEY.");
  process.exit(1);
}

const headers = {
  apikey: SUPABASE_KEY,
  authorization: `Bearer ${SUPABASE_KEY}`,
  "content-type": "application/json",
};

const rpcChecks = [
  ["get_data_quality_snapshot_v1", { _recent_days: 30, _sample_limit: 1 }],
  ["get_data_repair_plan_v1", { _limit: 1, _recent_days: 90, _include_ai: false }],
  ["get_entity_quality_snapshot_v1", { _limit: 1 }],
  ["get_homepage_rails_v1", { _trending_limit: 1, _evergreen_limit: 1, _category_limit: 1, _max_categories: 1 }],
];

const functionChecks = [
  "intelligence-reprocess-admin",
  "clean-text-autopilot",
  "episode-clean-text-candidate-runner",
  "episode-clean-text-candidate-promoter",
  "data-repair-apply-runner",
  "entity-quality-apply-runner",
  "entity-quality-autopilot",
];

let failures = 0;

for (const [name, body] of rpcChecks) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    failures += 1;
    console.error(`RPC ${name} failed: ${res.status} ${text.slice(0, 500)}`);
  } else {
    console.log(`RPC ${name}: ok`);
  }
}

for (const name of functionChecks) {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "OPTIONS",
    headers,
  });
  const text = await res.text();
  if (!res.ok) {
    failures += 1;
    console.error(`Function ${name} failed: ${res.status} ${text.slice(0, 500)}`);
  } else {
    console.log(`Function ${name}: ok`);
  }
}

if (failures) {
  console.error(`Backend verification failed with ${failures} failure(s).`);
  process.exit(1);
}

console.log("Backend verification passed.");
