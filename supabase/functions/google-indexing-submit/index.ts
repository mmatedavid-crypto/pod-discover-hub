// Google Indexing API — direct URL ping for fast indexing.
// Daily cron: picks up to ~200 URLs (priority: new HU episodes, recent-not-indexed, new hub pages).
// Uses RS256 JWT signed by service account (GOOGLE_INDEXING_SA_JSON secret).
// State stored in app_settings.indexing_api_state.
//
// Manual: POST { dry_run?: bool, max?: number, urls?: string[] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE = "https://podiverzum.hu";
const DAILY_QUOTA = 200; // Google's per-property hard cap

// ---- JWT helpers (Deno-native, no external deps) ----
function b64url(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") bytes = new TextEncoder().encode(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else bytes = input;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function pemToPkcs8(pem: string): Uint8Array {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/, "")
    .replace(/-----END PRIVATE KEY-----/, "")
    .replace(/\s+/g, "");
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function getAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const claims = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/indexing",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3500,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToPkcs8(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${b64url(sig)}`;

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!r.ok) throw new Error(`token_exchange_failed ${r.status}: ${await r.text().catch(() => "")}`);
  const j = await r.json();
  if (!j.access_token) throw new Error("token_missing_in_response");
  return j.access_token as string;
}

// ---- Indexing API publish (one call per URL — batch endpoint requires multipart, slower to maintain) ----
async function publishUrl(token: string, url: string): Promise<{ ok: boolean; status: number; body?: string }> {
  const r = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url, type: "URL_UPDATED" }),
  });
  if (r.ok) return { ok: true, status: r.status };
  const body = await r.text().catch(() => "");
  return { ok: false, status: r.status, body: body.slice(0, 300) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const saJson = Deno.env.get("GOOGLE_INDEXING_SA_JSON");
    if (!saJson) return json({ ok: false, error: "missing_GOOGLE_INDEXING_SA_JSON" }, 500);
    let sa: { client_email: string; private_key: string };
    try {
      sa = JSON.parse(saJson);
    } catch {
      return json({ ok: false, error: "invalid_sa_json" }, 500);
    }
    if (!sa.client_email || !sa.private_key) {
      return json({ ok: false, error: "sa_missing_fields" }, 500);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body.dry_run === true;
    const maxUrls = Math.min(Number(body.max ?? DAILY_QUOTA), DAILY_QUOTA);
    const customUrls = Array.isArray(body.urls) ? (body.urls as string[]).slice(0, DAILY_QUOTA) : null;

    // ---- Collect URLs ----
    const urls: string[] = [];
    const seen = new Set<string>();
    const push = (u: string) => {
      if (!u || seen.has(u) || urls.length >= maxUrls) return;
      seen.add(u);
      urls.push(u);
    };

    if (customUrls) {
      for (const u of customUrls) push(u);
    } else {
      const tierWeight: Record<string, number> = { S: 0, A: 1, B: 2, C: 3, D: 4, E: 5 };

      // Prio 1: new HU episodes (≤24h), tier-weighted (S→E within freshness window)
      const { data: freshEps } = await admin
        .from("episodes")
        .select("slug, published_at, podcasts!inner(slug, language_decision, rank_label)")
        .gte("published_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .eq("podcasts.language_decision", "accept_hungarian")
        .limit(200);
      const freshSorted = (freshEps || [])
        .map((e: any) => ({
          url: e.slug && e.podcasts?.slug ? `${SITE}/podcast/${e.podcasts.slug}/${e.slug}` : null,
          tier: tierWeight[e.podcasts?.rank_label] ?? 9,
          pub: e.published_at,
        }))
        .filter((r) => r.url)
        .sort((a, b) => a.tier - b.tier || (b.pub > a.pub ? 1 : -1));
      for (const r of freshSorted) push(r.url!);

      // Prio 2: ≤7d episodes still showing 0 impressions (likely not indexed yet)
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
      const { data: recentEps } = await admin
        .from("episodes")
        .select("slug, published_at, podcasts!inner(slug, language_decision, rank_label)")
        .gte("published_at", sevenDaysAgo)
        .lt("published_at", new Date(Date.now() - 24 * 3600_000).toISOString())
        .eq("podcasts.language_decision", "accept_hungarian")
        .order("published_at", { ascending: false })
        .limit(300);

      // Cross-check against gsc_query_daily — which URLs have NEVER received an impression
      const candidateUrls = (recentEps || []).map((e: any) =>
        `${SITE}/podcast/${e.podcasts.slug}/${e.slug}`,
      );
      let indexedSet = new Set<string>();
      if (candidateUrls.length > 0) {
        const { data: indexed } = await admin
          .from("gsc_query_daily")
          .select("page")
          .in("page", candidateUrls);
        indexedSet = new Set((indexed || []).map((r: any) => r.page));
      }
      // Higher-tier first among the not-yet-indexed pool
      // (tierWeight already defined above)
      const notIndexed = (recentEps || [])
        .map((e: any) => ({
          url: `${SITE}/podcast/${e.podcasts.slug}/${e.slug}`,
          tier: tierWeight[e.podcasts.rank_label] ?? 9,
          pub: e.published_at,
        }))
        .filter((r) => !indexedSet.has(r.url))
        .sort((a, b) => a.tier - b.tier || (b.pub > a.pub ? 1 : -1));
      for (const r of notIndexed) push(r.url);

      // Prio 3: new podcasts (≤7d added to catalog)
      const { data: newPods } = await admin
        .from("podcasts")
        .select("slug, created_at")
        .eq("language_decision", "accept_hungarian")
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(40);
      for (const p of (newPods || []) as any[]) {
        if (p.slug) push(`${SITE}/podcast/${p.slug}`);
      }

      // Prio 4: new people with ≥1 episode (≤7d)
      const { data: newPeople } = await admin
        .from("people")
        .select("slug, created_at")
        .eq("is_indexable", true)
        .gte("created_at", sevenDaysAgo)
        .order("created_at", { ascending: false })
        .limit(20);
      for (const p of (newPeople || []) as any[]) {
        if (p.slug) push(`${SITE}/szemelyek/${p.slug}`);
      }
    }

    if (urls.length === 0) {
      return json({ ok: true, message: "no_urls_to_submit", submitted: 0 });
    }

    if (dryRun) {
      return json({ ok: true, dry_run: true, count: urls.length, urls });
    }

    // ---- Quota guard ----
    const { data: stateRow } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "indexing_api_state")
      .maybeSingle();
    const state: any = stateRow?.value || {};
    const today = new Date().toISOString().slice(0, 10);
    const todayCount = state.daily?.[today] ?? 0;
    if (todayCount >= DAILY_QUOTA) {
      return json({ ok: true, message: "daily_quota_reached", submitted: 0, daily_count: todayCount });
    }
    const remaining = Math.max(0, DAILY_QUOTA - todayCount);
    const toSend = urls.slice(0, Math.min(remaining, maxUrls));

    // ---- Get token + publish ----
    const token = await getAccessToken(sa);

    let success = 0;
    let failed = 0;
    let quotaHit = false;
    const errors: { url: string; status: number; body?: string }[] = [];

    // 10 parallel at a time; Google rate-limits gracefully
    const batchSize = 10;
    for (let i = 0; i < toSend.length; i += batchSize) {
      const chunk = toSend.slice(i, i + batchSize);
      const results = await Promise.all(chunk.map((u) => publishUrl(token, u)));
      results.forEach((r, idx) => {
        if (r.ok) success++;
        else {
          failed++;
          errors.push({ url: chunk[idx], status: r.status, body: r.body });
          if (r.status === 429) quotaHit = true;
        }
      });
      if (quotaHit) break;
    }

    // ---- Update state ----
    const daily = { ...(state.daily || {}) };
    daily[today] = (daily[today] || 0) + success;
    // Keep last 30 days
    const cutoff = new Date(Date.now() - 30 * 24 * 3600_000).toISOString().slice(0, 10);
    for (const k of Object.keys(daily)) if (k < cutoff) delete daily[k];

    const runs = [...(state.runs || [])].slice(-29);
    runs.push({
      at: new Date().toISOString(),
      submitted: success,
      failed,
      total_candidates: urls.length,
      quota_hit: quotaHit,
      sample_errors: errors.slice(0, 3),
    });

    const nextState = {
      ...state,
      enabled: state.enabled ?? true,
      last_run_at: new Date().toISOString(),
      last_success_count: success,
      last_failed_count: failed,
      quota_exceeded_until: quotaHit
        ? new Date(Date.now() + 24 * 3600_000).toISOString()
        : state.quota_exceeded_until,
      daily,
      runs,
    };
    await admin
      .from("app_settings")
      .upsert({ key: "indexing_api_state", value: nextState }, { onConflict: "key" });

    return json({
      ok: true,
      submitted: success,
      failed,
      total_candidates: urls.length,
      quota_hit: quotaHit,
      sample_errors: errors.slice(0, 3),
    });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message) }, 500);
  }
});
