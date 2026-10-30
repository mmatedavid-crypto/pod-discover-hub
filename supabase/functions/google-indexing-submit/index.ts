import { denyUntrustedCaller } from "../_shared/internal-auth.ts";
// Google Indexing API — DISABLED for Podiverzum pages (2026-10-24).
//
// Google's Indexing API only supports pages with JobPosting or BroadcastEvent
// (inside a VideoObject) structured data:
// https://developers.google.com/search/apis/indexing-api/v3/quickstart
// Podcast catalog, episode and hub pages are neither, so submitting them is
// unsupported use. Discovery runs through the sitemaps (refresh-sitemap),
// internal links and IndexNow (Bing); indexing is observed in Search Console
// (URL Inspection / coverage), never inferred from a submission, an HTTP 200
// or a missing impression.
//
// This function stays deployed as a safe no-op for legacy callers
// (fetch-one, bible-prefetch, zarandok-biblia-poll, old cron 99): it accepts the
// old request shapes, submits nothing, never calls Google, and records only a
// skip counter. It never marks any URL as indexed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { indexingApiDecision } from "../_shared/indexing-api-policy.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  { const denied = await denyUntrustedCaller(req, "google-indexing-submit"); if (denied) return denied; }
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const urls = Array.isArray((body as any).urls) ? ((body as any).urls as unknown[]).map(String).slice(0, 200) : [];
  const decision = indexingApiDecision(urls);

  // Best-effort skip telemetry (re-read before write; never touches other keys' meaning).
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: row } = await admin.from("app_settings").select("value").eq("key", "indexing_api_state").maybeSingle();
    const state: any = row?.value || {};
    const today = new Date().toISOString().slice(0, 10);
    const skipped = { ...(state.skipped_daily || {}) };
    skipped[today] = Number(skipped[today] || 0) + Math.max(1, urls.length);
    const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
    for (const k of Object.keys(skipped)) if (k < cutoff) delete skipped[k];
    await admin.from("app_settings").upsert({
      key: "indexing_api_state",
      value: {
        ...state,
        enabled: false,
        disabled_reason: "unsupported_page_types_jobposting_broadcastevent_only",
        disabled_at: state.disabled_at || new Date().toISOString(),
        last_skipped_at: new Date().toISOString(),
        skipped_daily: skipped,
      },
    }, { onConflict: "key" });
  } catch (_) { /* telemetry only */ }

  return json({ ok: true, skipped: true, submitted: 0, reason: decision.reason, unsupported: decision.unsupported });
});
