// One-off: restore the .com redirector worker (podiverzum-bot-prerender).
// Uses project secrets CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
const REDIRECTOR_SOURCE = `export default {
  async fetch(request) {
    const url = new URL(request.url);
    return new Response(null, {
      status: 301,
      headers: {
        Location: "https://podiverzum.hu" + url.pathname + url.search,
        "Cache-Control": "public, max-age=31536000",
        "X-Redirect": "com-to-hu-301",
      },
    });
  },
};
`;

Deno.serve(async () => {
  const token = Deno.env.get("CLOUDFLARE_API_TOKEN");
  const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  if (!token || !accountId) {
    return new Response(JSON.stringify({ error: "missing_cloudflare_secrets" }), { status: 500 });
  }
  const metadata = JSON.stringify({ main_module: "worker.js", compatibility_date: "2025-01-01" });
  const form = new FormData();
  form.append("metadata", new Blob([metadata], { type: "application/json" }), "metadata.json");
  form.append("worker.js", new Blob([REDIRECTOR_SOURCE], { type: "application/javascript+module" }), "worker.js");
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/podiverzum-bot-prerender`,
    { method: "PUT", headers: { Authorization: `Bearer ${token}` }, body: form },
  );
  const json = await resp.json().catch(() => null);
  return new Response(JSON.stringify({ httpStatus: resp.status, success: json?.success === true, errors: json?.errors ?? null }), {
    status: json?.success ? 200 : 502,
    headers: { "Content-Type": "application/json" },
  });
});
