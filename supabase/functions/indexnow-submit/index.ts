// IndexNow submitter — pings Bing/Yandex/etc. with recently changed URLs.
// Docs: https://www.indexnow.org/documentation
//
// Modes:
//   POST { urls: string[] }          → submit the provided URLs verbatim.
//   POST { mode: "recent", hours?: number, max?: number }
//                                    → auto-collect recently updated URLs
//                                      (new/updated episodes + people/orgs that
//                                      just became indexable) and submit them.
//   GET  ?mode=recent&hours=24       → same as above, convenient for cron.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const HOST = "podiverzum.hu";
const BASE = `https://${HOST}`;
// Key is served by the Cloudflare worker at /<key>.txt (see .lovable/cloudflare-worker.js).
const KEY = "cd4aa0ff3daa6bff678ed60d1431affc45fcf9ef72ff14c90613492dc7c32f6a";
const KEY_LOCATION = `${BASE}/${KEY}.txt`;
const ENDPOINT = "https://api.indexnow.org/IndexNow";
// IndexNow accepts up to 10 000 URLs per request, but new sites often hit a
// 403 quota on very large first batches. Keep batches small + spaced out.
const MAX_PER_REQUEST = 100;
const BATCH_DELAY_MS = 1500;

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function submit(urls: string[]) {
  const unique = Array.from(new Set(urls.filter((u) => u.startsWith(BASE))));
  if (!unique.length) return { submitted: 0, batches: 0, statuses: [] };
  const statuses: number[] = [];
  for (const batch of chunk(unique, MAX_PER_REQUEST)) {
    const resp = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        host: HOST,
        key: KEY,
        keyLocation: KEY_LOCATION,
        urlList: batch,
      }),
    });
    statuses.push(resp.status);
    // 200 = accepted, 202 = accepted (will process), 422 = invalid URLs, 429 = rate limit
    if (resp.status >= 400) {
      const text = await resp.text().catch(() => "");
      console.warn("IndexNow batch failed", resp.status, text.slice(0, 300));
    }
  }
  return { submitted: unique.length, batches: statuses.length, statuses };
}

async function collectRecent(
  supabase: ReturnType<typeof createClient>,
  hours: number,
  max: number,
): Promise<string[]> {
  const since = new Date(Date.now() - hours * 3600_000).toISOString();
  const urls: string[] = [];

  // 1) Recently published / updated HU episodes (indexable only).
  const { data: eps } = await supabase
    .from("episodes")
    .select("slug,podcasts!inner(slug,language,is_indexable)")
    .gte("published_at", since)
    .eq("podcasts.is_indexable", true)
    .ilike("podcasts.language", "hu%")
    .limit(max);
  for (const e of (eps || []) as any[]) {
    if (e.slug && e.podcasts?.slug) {
      urls.push(`${BASE}/podcast/${e.podcasts.slug}/${e.slug}`);
    }
  }

  // 2) Podcasts updated recently (new episode bumps last_episode_at).
  const { data: pods } = await supabase
    .from("podcasts")
    .select("slug,last_episode_at,is_indexable,language")
    .eq("is_indexable", true)
    .ilike("language", "hu%")
    .gte("last_episode_at", since)
    .limit(1000);
  for (const p of (pods || []) as any[]) {
    if (p.slug) urls.push(`${BASE}/podcast/${p.slug}`);
  }

  // 3) People newly flipped to indexable / updated recently.
  const { data: people } = await supabase
    .from("people")
    .select("slug,updated_at,is_indexable")
    .eq("is_indexable", true)
    .gte("updated_at", since)
    .limit(2000);
  for (const p of (people || []) as any[]) {
    if (p.slug) urls.push(`${BASE}/szemelyek/${p.slug}`);
  }

  // 4) Organizations newly flipped to indexable / updated recently.
  const { data: orgs } = await supabase
    .from("organizations")
    .select("slug,updated_at,is_indexable")
    .eq("is_indexable", true)
    .gte("updated_at", since)
    .limit(2000);
  for (const o of (orgs || []) as any[]) {
    if (o.slug) urls.push(`${BASE}/ceg/${o.slug}`);
  }

  // Always include the homepage so Bing re-crawls the daily lists.
  urls.push(`${BASE}/`);
  return urls;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let mode = "recent";
    let hours = 24;
    let max = 5000;
    let directUrls: string[] | null = null;

    if (req.method === "GET") {
      const u = new URL(req.url);
      mode = u.searchParams.get("mode") || mode;
      hours = Number(u.searchParams.get("hours") || hours);
      max = Number(u.searchParams.get("max") || max);
    } else {
      const body = await req.json().catch(() => ({}));
      if (Array.isArray(body?.urls)) {
        directUrls = body.urls.filter((s: unknown) => typeof s === "string");
        mode = "manual";
      } else {
        mode = body?.mode || mode;
        hours = Number(body?.hours ?? hours);
        max = Number(body?.max ?? max);
      }
    }

    const urls = directUrls ?? (await collectRecent(supabase, hours, max));
    const result = await submit(urls);

    return new Response(
      JSON.stringify({ ok: true, mode, hours, ...result, sampled: urls.slice(0, 5) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("indexnow-submit error", e);
    return new Response(
      JSON.stringify({ ok: false, error: String((e as any)?.message || e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
