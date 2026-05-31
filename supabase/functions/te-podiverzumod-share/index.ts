// Public edge function: create + read shareable "A Te Podiverzumod" result snapshots.
// - POST: creates a share, returns { share_id, url }. Body is the PUBLIC result face only.
// - GET ?id=<share_id>: returns the public snapshot (no internal fields).
// Privacy: source_session_id (if sent) is stored but NEVER returned.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// pdv-<4 digits>-<3 lowercase letters>
function generateShareId(): string {
  const digits = Math.floor(1000 + Math.random() * 9000).toString();
  const alpha = "abcdefghijkmnpqrstuvwxyz"; // no l/o
  let s = "";
  for (let i = 0; i < 3; i++) s += alpha[Math.floor(Math.random() * alpha.length)];
  return `pdv-${digits}-${s}`;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

const MAX_TAGS = 8;
const MAX_TITLE = 120;
const MAX_SUB = 240;
const MAX_DESC = 600;

function clip(s: unknown, n: number): string {
  return String(s ?? "").trim().slice(0, n);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const id = url.searchParams.get("id");
      if (!id) return json(400, { error: "missing id" });
      const { data, error } = await admin
        .from("te_podiverzumod_shares_public")
        .select("*")
        .eq("share_id", id)
        .maybeSingle();
      if (error) return json(500, { error: error.message });
      if (!data) return json(404, { error: "not_found" });
      // best-effort view count bump (fire-and-forget)
      admin.rpc as unknown; // no rpc; do an update
      admin
        .from("te_podiverzumod_shares")
        .update({ view_count: (data as any).view_count ? (data as any).view_count + 1 : 1 })
        .eq("share_id", id)
        .then(() => {}, () => {});
      return new Response(JSON.stringify(data), {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=300, s-maxage=300",
        },
      });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => null);
      if (!body || typeof body !== "object") return json(400, { error: "invalid body" });

      const result_type = clip((body as any).result_type, 80);
      const result_title = clip((body as any).result_title, MAX_TITLE);
      const result_subtitle = clip((body as any).result_subtitle, MAX_SUB) || null;
      const result_description = clip((body as any).result_description, MAX_DESC);
      const tagsRaw = Array.isArray((body as any).tags) ? (body as any).tags : [];
      const tags = tagsRaw
        .map((t: unknown) => clip(t, 40))
        .filter((t: string) => t.length > 0)
        .slice(0, MAX_TAGS);
      const auraRaw = Array.isArray((body as any).aura_colors) ? (body as any).aura_colors : [];
      const aura_colors = auraRaw
        .map((c: unknown) => clip(c, 32))
        .filter((c: string) => /^#?[0-9a-fA-F]{3,8}$/.test(c) || c.startsWith("hsl") || c.startsWith("rgb"))
        .slice(0, 6);
      const source_session_id = clip((body as any).source_session_id, 80) || null;

      if (!result_type || !result_title || !result_description) {
        return json(400, { error: "result_type, result_title, result_description are required" });
      }

      // Retry on rare slug collision (extremely unlikely with 9000*24^3 ≈ 124M space)
      let inserted: { share_id: string } | null = null;
      let lastErr: string | null = null;
      for (let attempt = 0; attempt < 5; attempt++) {
        const share_id = generateShareId();
        const { data, error } = await admin
          .from("te_podiverzumod_shares")
          .insert({
            share_id,
            result_type,
            result_title,
            result_subtitle,
            result_description,
            tags,
            aura_colors,
            source_session_id,
          })
          .select("share_id")
          .single();
        if (!error && data) { inserted = data; break; }
        lastErr = error?.message || "unknown insert error";
        if (!/duplicate|unique/i.test(lastErr)) break;
      }
      if (!inserted) return json(500, { error: lastErr || "insert failed" });

      // Always use the canonical production domain so shared links work cross-device
      // and bot prerender (Cloudflare worker) can resolve them. Never use request origin.
      const url = `https://podiverzum.hu/hallgatoi-profil/${inserted.share_id}`;
      return json(200, { share_id: inserted.share_id, url });
    }

    return json(405, { error: "method not allowed" });
  } catch (e) {
    return json(500, { error: (e as Error).message });
  }
});
