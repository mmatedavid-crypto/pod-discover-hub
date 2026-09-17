// One-off deployment helper: uploads the bot-prerender Worker to Cloudflare
// using the project secrets CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
// Guarded by a shared secret env DEPLOY_WORKER_GUARD to avoid accidental runs.
import { WORKER_SOURCE } from "./worker-source.ts";

const WORKER_NAME = "podiverzum-bot-prerender";

Deno.serve(async (req) => {
  const token = Deno.env.get("CLOUDFLARE_API_TOKEN");
  const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  if (!token || !accountId) {
    return new Response(JSON.stringify({ error: "missing_cloudflare_secrets" }), { status: 500 });
  }

  const metadata = JSON.stringify({
    main_module: "worker.js",
    compatibility_date: "2025-01-01",
  });
  const form = new FormData();
  form.append("metadata", new Blob([metadata], { type: "application/json" }), "metadata.json");
  form.append(
    "worker.js",
    new Blob([WORKER_SOURCE], { type: "application/javascript+module" }),
    "worker.js",
  );

  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    },
  );
  const text = await resp.text();
  let parsed: unknown = null;
  try { parsed = JSON.parse(text); } catch { /* keep raw */ }
  const success = typeof parsed === "object" && parsed !== null
    ? (parsed as { success?: boolean }).success === true
    : resp.ok;
  return new Response(
    JSON.stringify({ httpStatus: resp.status, success, result: parsed ?? text.slice(0, 500) }),
    { status: success ? 200 : 502, headers: { "Content-Type": "application/json" } },
  );
});
