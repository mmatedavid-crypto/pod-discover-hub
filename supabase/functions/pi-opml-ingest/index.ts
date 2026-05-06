// Ingest RSS URLs / OPML pasted from the admin UI (iPhone-friendly).
// Body: { urls?: string[], opml?: string, snapshot_label?: string }
// Auth: requires admin user (verify_jwt=true).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function extractFromOpml(xml: string): { url: string; title?: string; image?: string }[] {
  const out: { url: string; title?: string; image?: string }[] = [];
  const re = /<outline\b[^>]*\/?>/gi;
  let m;
  while ((m = re.exec(xml))) {
    const tag = m[0];
    const url = (tag.match(/\bxmlUrl\s*=\s*"([^"]+)"/i) || tag.match(/\bxmlUrl\s*=\s*'([^']+)'/i))?.[1];
    if (!url) continue;
    const title = (tag.match(/\b(?:title|text)\s*=\s*"([^"]+)"/i))?.[1];
    out.push({ url, title });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: userData, error: cErr } = await userClient.auth.getUser();
    if (cErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userData.user.id;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId).eq("role", "admin");
    if (!roles?.length) {
      return new Response(JSON.stringify({ error: "admin required" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const body = await req.json().catch(() => ({}));
    const rawUrls: string[] = Array.isArray(body.urls) ? body.urls : [];
    const opml: string = typeof body.opml === "string" ? body.opml : "";
    const label: string = body.snapshot_label || "admin paste";

    const fromUrls = rawUrls.map((s) => String(s).trim()).filter((s) => /^https?:\/\//i.test(s)).map((u) => ({ url: u }));
    const fromOpml = opml ? extractFromOpml(opml) : [];
    const all = [...fromUrls, ...fromOpml];
    const seen = new Set<string>();
    const feeds = all.filter((f) => { if (seen.has(f.url)) return false; seen.add(f.url); return true; }).slice(0, 2000);

    if (!feeds.length) {
      return new Response(JSON.stringify({ error: "no valid urls" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: imp, error: impErr } = await supabase.from("pi_dump_imports")
      .insert({ source: "admin_paste", status: "ingesting", notes: { label, count: feeds.length } })
      .select("id").single();
    if (impErr) throw impErr;

    // Skip already-imported
    const urls = feeds.map((f) => f.url);
    const exSet = new Set<string>();
    for (let i = 0; i < urls.length; i += 200) {
      const slice = urls.slice(i, i + 200);
      const { data } = await supabase.from("podcasts").select("rss_url").in("rss_url", slice);
      (data || []).forEach((r: any) => exSet.add(r.rss_url));
    }
    const rows = feeds.filter((f) => !exSet.has(f.url)).map((f) => ({
      import_id: imp.id,
      rss_url: f.url,
      title: f.title || null,
      language: "en",
    }));
    const alreadyImported = feeds.length - rows.length;

    let inserted = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const slice = rows.slice(i, i + 500);
      const { error, count } = await supabase.from("pi_feed_staging")
        .upsert(slice, { onConflict: "rss_url", ignoreDuplicates: true, count: "exact" });
      if (error) throw error;
      inserted += count ?? slice.length;
    }
    const dupInBatch = rows.length - inserted;

    await supabase.from("pi_dump_imports").update({
      feeds_received: feeds.length,
      skipped_duplicates: alreadyImported + dupInBatch,
      status: "processing",
      updated_at: new Date().toISOString(),
    }).eq("id", imp.id);

    return new Response(JSON.stringify({
      ok: true, import_id: imp.id, received: feeds.length, inserted, duplicates_in_batch: dupInBatch, already_in_podcasts: alreadyImported,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
