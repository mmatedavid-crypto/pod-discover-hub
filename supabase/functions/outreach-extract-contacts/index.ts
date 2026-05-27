// Outreach contact extractor — fetches RSS feeds and pulls <itunes:owner><itunes:email>.
// Admin-only: requires admin role in user_roles.
// POST { podcast_ids?: string[], limit?: number } — defaults to 50 unchecked S/A/B tier podcasts.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMAIL_RX = /<itunes:email[^>]*>\s*([^<\s]+@[^<\s]+)\s*<\/itunes:email>/i;
const NAME_RX = /<itunes:name[^>]*>\s*([^<]+?)\s*<\/itunes:name>/i;
const MANAGING_RX = /<managingEditor[^>]*>\s*([^<]+?)\s*<\/managingEditor>/i;
const AUTHOR_RX = /<itunes:author[^>]*>\s*([^<]+?)\s*<\/itunes:author>/i;
const ANY_EMAIL_RX = /([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i;

async function extractFromRss(url: string): Promise<{ email?: string; name?: string; from?: string; error?: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "PodiverzumOutreachBot/1.0 (+https://podiverzum.hu)" },
    });
    clearTimeout(t);
    if (!res.ok) return { error: `http_${res.status}` };
    const xml = (await res.text()).slice(0, 200_000);

    const emailMatch = xml.match(EMAIL_RX);
    if (emailMatch) {
      const name = xml.match(NAME_RX)?.[1] || xml.match(AUTHOR_RX)?.[1];
      return { email: emailMatch[1].toLowerCase().trim(), name: name?.trim(), from: "itunes:email" };
    }
    const me = xml.match(MANAGING_RX)?.[1];
    if (me) {
      const em = me.match(ANY_EMAIL_RX)?.[1];
      if (em) return { email: em.toLowerCase().trim(), from: "managingEditor" };
    }
    return { error: "no_email_in_rss" };
  } catch (e) {
    return { error: String((e as Error).message || e).slice(0, 200) };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  // Auth: must be admin
  const authHeader = req.headers.get("authorization") || "";
  const userClient = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
  const { data: isAdmin } = await userClient.rpc("has_role", { _user_id: user.id, _role: "admin" });
  if (!isAdmin) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { ...cors, "Content-Type": "application/json" } });

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Number(body.limit ?? 50), 200);
  const podcastIds: string[] | undefined = Array.isArray(body.podcast_ids) ? body.podcast_ids : undefined;

  const svc = createClient(SB_URL, SB_SVC);

  // Pick target podcasts
  let q = svc.from("podcasts")
    .select("id, title, rss_url, shadow_rank_tier, podiverzum_rank")
    .ilike("language", "hu%")
    .not("rss_url", "is", null);

  if (podcastIds?.length) {
    q = q.in("id", podcastIds);
  } else {
    // S/A/B tier without a successful extraction
    const { data: done } = await svc.from("podcast_outreach_contacts").select("podcast_id").eq("extract_status", "ok");
    const doneIds = new Set((done || []).map((r: any) => r.podcast_id));
    q = q.in("shadow_rank_tier", ["S", "A", "B"]).order("podiverzum_rank", { ascending: false }).limit(limit * 3);
    const { data: pods = [] } = await q;
    const targets = pods.filter((p: any) => !doneIds.has(p.id)).slice(0, limit);
    return await processBatch(svc, targets);
  }

  const { data: pods = [] } = await q.limit(limit);
  return await processBatch(svc, pods);
});

async function processBatch(svc: any, pods: any[]) {
  let ok = 0, fail = 0;
  const results: any[] = [];
  for (const p of pods) {
    const r = await extractFromRss(p.rss_url);
    const row = {
      podcast_id: p.id,
      owner_email: r.email ?? null,
      owner_name: r.name ?? null,
      extracted_from: r.from ?? null,
      extract_status: r.email ? "ok" : "no_email",
      extract_error: r.error ?? null,
      extracted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    if (r.email) ok++; else fail++;
    await svc.from("podcast_outreach_contacts").upsert(row, { onConflict: "podcast_id" });
    results.push({ podcast_id: p.id, title: p.title, email: r.email ?? null, status: row.extract_status, error: r.error });
  }
  return new Response(JSON.stringify({ processed: pods.length, ok, fail, results }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
