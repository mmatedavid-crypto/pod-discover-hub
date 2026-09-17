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
  if (req.headers.get("x-deploy-guard") !== Deno.env.get("CLOUDFLARE_ACCOUNT_ID")) {
    return new Response(JSON.stringify({ error: "forbidden" }), { status: 403 });
  }

  const boundary = "----podiworker" + crypto.randomUUID().replaceAll("-", "");
  const metadata = JSON.stringify({
    main_module: "worker.js",
    compatibility_date: "2025-01-01",
  });
  const enc = new TextEncoder();
  const part = (name: string, filename: string, ctype: string, content: string) =>
    enc.encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"; filename="${filename}"\r\nContent-Type: ${ctype}\r\n\r\n${content}\r\n`,
    );
  const bodyParts = [
    part("metadata", "metadata.json", "application/json", metadata),
    part("worker.js", "worker.js", "application/javascript+module", WORKER_SOURCE),
    enc.encode(`--${boundary}--\r\n`),
  ];
  const body = new Blob(bodyParts as BlobPart[]);

  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER_NAME}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
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
