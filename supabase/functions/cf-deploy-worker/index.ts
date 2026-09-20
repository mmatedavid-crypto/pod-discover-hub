// Temporary admin helper: uploads infra/cloudflare-worker/worker.js to the
// existing podiverzum.hu Cloudflare Worker script. Deleted after use.
import { WORKER_SOURCE } from "./worker-source.ts";

const TOKEN = Deno.env.get("CLOUDFLARE_API_TOKEN") ?? "";
const ACCOUNT = Deno.env.get("CLOUDFLARE_ACCOUNT_ID") ?? "";

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const name = url.searchParams.get("name") || "podiverzum-hu-bot-prerender";
  if (!TOKEN || !ACCOUNT) {
    return new Response(JSON.stringify({ error: "missing credentials" }), { status: 500 });
  }
  const api = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts/${name}`;

  if (url.searchParams.get("mode") === "read") {
    const r = await fetch(api, { headers: { Authorization: `Bearer ${TOKEN}` } });
    const text = await r.text();
    return new Response(JSON.stringify({ status: r.status, length: text.length, hasCanonicalInjector: text.includes("originFallback") }), { headers: { "Content-Type": "application/json" } });
  }

  const form = new FormData();
  const metadata = { main_module: "worker.js", compatibility_date: "2025-01-01" };
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("worker.js", new Blob([WORKER_SOURCE], { type: "application/javascript+module" }), "worker.js");

  const res = await fetch(api, {
    method: "PUT",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: form,
  });
  const body = await res.json().catch(() => ({}));
  return new Response(JSON.stringify({ script: name, status: res.status, success: body?.success, id: body?.result?.id, deployment_id: body?.result?.deployment_id, errors: body?.errors }), {
    status: res.ok ? 200 : res.status,
    headers: { "Content-Type": "application/json" },
  });
});
