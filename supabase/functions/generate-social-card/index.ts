// Branded Podiverzum social card generator (1200x675 PNG).
// Builds an SVG composition (cover + hook + podcast name + entity tag + brand mark),
// rasterizes it with resvg-wasm, then uploads to the public `social-cards` bucket.
//
// POST body:
//   {
//     episode_id: string,         // required
//     hook_text:  string,         // required (one strong line; will be wrapped)
//     entity_tag?: string,        // optional override (e.g. "AI · NVDA")
//     image_type_hint?: "branded_card" | "episode_cover" | "podcast_cover" | "text_only",
//     dry_run?: boolean,          // returns SVG only, no upload
//   }
//
// Response:
//   { ok: true, image_type: "branded_card" | ..., url: string, width: 1200, height: 675 }
//   On any failure → { ok: false, error, fallback_image_type, fallback_url } so the
//   caller (daily-social-post) can safely degrade to the raw cover.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resvg, initWasm } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const W = 1200;
const H = 675;

// ---------- one-time wasm + font load (module scope) ----------
let wasmReady = false;
async function ensureWasm() {
  if (wasmReady) return;
  const wasmRes = await fetch("https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm");
  if (!wasmRes.ok) throw new Error(`resvg wasm fetch failed: ${wasmRes.status}`);
  await initWasm(await wasmRes.arrayBuffer());
  wasmReady = true;
}

let fontBold: Uint8Array | null = null;
let fontRegular: Uint8Array | null = null;
async function ensureFonts() {
  if (fontBold && fontRegular) return;
  // Inter TTFs from fontsource jsdelivr (stable, public).
  const [b, r] = await Promise.all([
    fetch("https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.ttf"),
    fetch("https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf"),
  ]);
  if (!b.ok || !r.ok) throw new Error(`font fetch failed: ${b.status}/${r.status}`);
  fontBold = new Uint8Array(await b.arrayBuffer());
  fontRegular = new Uint8Array(await r.arrayBuffer());
}

// ---------- helpers ----------
function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Greedy word wrap with a soft char-budget per line.
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; if (lines.length === maxLines - 1) break; }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // If we ran out, append the rest to the last line truncated.
  const used = lines.join(" ").length + lines.length - 1;
  if (used < text.length && lines.length === maxLines) {
    const remainder = text.slice(used).trim();
    if (remainder) {
      let last = lines[maxLines - 1];
      const room = Math.max(0, maxChars - last.length - 1);
      if (room > 4) last = last + " " + remainder.slice(0, room - 1) + "…";
      else last = last.replace(/\S+$/, "…").trim();
      lines[maxLines - 1] = last;
    }
  }
  return lines;
}

function pickHookSizing(hook: string): { fontSize: number; lineHeight: number; maxChars: number; maxLines: number } {
  const len = hook.length;
  if (len <= 70)  return { fontSize: 56, lineHeight: 64, maxChars: 22, maxLines: 3 };
  if (len <= 110) return { fontSize: 46, lineHeight: 54, maxChars: 26, maxLines: 4 };
  if (len <= 160) return { fontSize: 38, lineHeight: 46, maxChars: 30, maxLines: 5 };
  return            { fontSize: 32, lineHeight: 40, maxChars: 36, maxLines: 6 };
}

async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    if (!/^image\//i.test(ct)) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength > 6_000_000) return null; // sanity cap
    let bin = "";
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
    return `data:${ct};base64,${btoa(bin)}`;
  } catch (_e) {
    return null;
  }
}

function buildSvg(opts: {
  coverDataUrl: string | null;
  hook: string;
  podcastName: string;
  entityTag: string | null;
}): string {
  const { coverDataUrl, hook, podcastName, entityTag } = opts;
  const sizing = pickHookSizing(hook);
  const lines = wrap(hook, sizing.maxChars, sizing.maxLines);

  // Right column geometry
  const rightX = 600;
  const rightTop = 110;
  const hookBlockH = lines.length * sizing.lineHeight;
  const hookY = Math.max(rightTop + sizing.fontSize, 280 - hookBlockH / 2 + sizing.fontSize);

  const tspans = lines
    .map((ln, i) => `<tspan x="${rightX}" dy="${i === 0 ? 0 : sizing.lineHeight}">${escapeXml(ln)}</tspan>`)
    .join("");

  const coverSvg = coverDataUrl
    ? `<image href="${coverDataUrl}" x="60" y="97" width="480" height="480" preserveAspectRatio="xMidYMid slice" clip-path="url(#coverClip)"/>`
    : `<rect x="60" y="97" width="480" height="480" rx="20" fill="#1f1f24"/>
       <text x="300" y="345" font-family="Inter" font-weight="700" font-size="40" fill="#3f3f46" text-anchor="middle">PODIVERZUM</text>`;

  const tagSvg = entityTag
    ? `<text x="${rightX}" y="92" font-family="Inter" font-weight="700" font-size="18" fill="#ef4444" letter-spacing="3">${escapeXml(entityTag.toUpperCase())}</text>`
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0c"/>
      <stop offset="100%" stop-color="#16161a"/>
    </linearGradient>
    <linearGradient id="coverShadow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.35"/>
    </linearGradient>
    <clipPath id="coverClip"><rect x="60" y="97" width="480" height="480" rx="20"/></clipPath>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- subtle red signal accent -->
  <rect x="60" y="60" width="56" height="3" fill="#ef4444"/>

  <!-- cover -->
  ${coverSvg}
  <rect x="60" y="97" width="480" height="480" rx="20" fill="url(#coverShadow)"/>
  <rect x="60" y="97" width="480" height="480" rx="20" fill="none" stroke="#27272a" stroke-width="1"/>

  <!-- entity tag -->
  ${tagSvg}

  <!-- hook -->
  <text x="${rightX}" y="${hookY}" font-family="Inter" font-weight="700" font-size="${sizing.fontSize}" fill="#f5f5f7">
    ${tspans}
  </text>

  <!-- podcast name -->
  <text x="${rightX}" y="555" font-family="Inter" font-weight="400" font-size="22" fill="#a1a1aa">${escapeXml(podcastName)}</text>

  <!-- branding -->
  <text x="${rightX}" y="608" font-family="Inter" font-weight="700" font-size="16" fill="#71717a" letter-spacing="4">PODIVERZUM</text>
  <rect x="${rightX}" y="618" width="40" height="2" fill="#ef4444"/>
</svg>`;
}

async function rasterize(svg: string): Promise<Uint8Array> {
  await ensureWasm();
  await ensureFonts();
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    background: "#0a0a0c",
    font: {
      fontBuffers: [fontRegular!, fontBold!],
      defaultFontFamily: "Inter",
      loadSystemFonts: false,
    },
  });
  const png = resvg.render().asPng();
  return png;
}

function jsonRes(obj: any, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return jsonRes({ ok: true, function: "generate-social-card" });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  const episodeId = String(body?.episode_id || "").trim();
  const hookText  = String(body?.hook_text  || "").trim();
  const dryRun    = body?.dry_run === true;

  if (!episodeId || !hookText) {
    return jsonRes({ ok: false, error: "episode_id and hook_text required" }, 400);
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Fetch episode + podcast info
  const { data: ep, error } = await admin
    .from("episodes")
    .select(`
      id, title, display_title, image_url, slug,
      people, companies, tickers, topics,
      podcasts!inner(id, title, display_title, slug, image_url)
    `)
    .eq("id", episodeId)
    .maybeSingle();
  if (error || !ep) {
    return jsonRes({ ok: false, error: `episode not found: ${error?.message || "no row"}` }, 404);
  }

  const podcastName = (ep as any).podcasts?.display_title || (ep as any).podcasts?.title || "Podcast";
  const coverUrl    = ep.image_url || (ep as any).podcasts?.image_url || null;
  const fallbackType: "episode_cover" | "podcast_cover" | "text_only" =
    ep.image_url ? "episode_cover" : (ep as any).podcasts?.image_url ? "podcast_cover" : "text_only";

  // Entity tag: prefer ticker, then company, then person, then topic.
  const entityTag = body?.entity_tag
    ? String(body.entity_tag).slice(0, 40)
    : ((ep as any).tickers?.[0] || (ep as any).companies?.[0] || (ep as any).people?.[0] || (ep as any).topics?.[0] || null);

  try {
    const coverDataUrl = coverUrl ? await fetchImageAsDataUrl(coverUrl) : null;
    const svg = buildSvg({
      coverDataUrl,
      hook: hookText,
      podcastName,
      entityTag: entityTag ? String(entityTag) : null,
    });

    if (dryRun) {
      return new Response(svg, {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "image/svg+xml" },
      });
    }

    const png = await rasterize(svg);
    const path = `${ep.id}/${Date.now()}.png`;
    const { error: upErr } = await admin.storage
      .from("social-cards")
      .upload(path, png, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
    if (upErr) throw new Error(`upload: ${upErr.message}`);

    const { data: pub } = admin.storage.from("social-cards").getPublicUrl(path);
    return jsonRes({
      ok: true,
      image_type: "branded_card",
      url: pub.publicUrl,
      path,
      width: W, height: H,
      bytes: png.byteLength,
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error("generate-social-card error:", msg);
    return jsonRes({
      ok: false,
      error: msg,
      fallback_image_type: fallbackType,
      fallback_url: coverUrl,
    }, 200); // 200 so caller can use fallback gracefully
  }
});
