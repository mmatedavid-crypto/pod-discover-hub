// Editorial card generator — renders cover + quote slides for weekly editorial posts.
// Two formats per item:
//   IG 4:5 (1080 x 1350)
//   FB 1.91:1 (1200 x 630) — for first/featured quote only
//
// POST body:
//   { post_id: string, dry_run?: boolean }
// Returns updated editorial_posts row with image URLs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { Resvg, initWasm } from "https://esm.sh/@resvg/resvg-wasm@2.6.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE = "podiverzum.hu";

let wasmReady = false;
async function ensureWasm() {
  if (wasmReady) return;
  const r = await fetch("https://esm.sh/@resvg/resvg-wasm@2.6.2/index_bg.wasm");
  if (!r.ok) throw new Error(`wasm: ${r.status}`);
  await initWasm(await r.arrayBuffer());
  wasmReady = true;
}

let fontBold: Uint8Array | null = null;
let fontRegular: Uint8Array | null = null;
let fontItalic: Uint8Array | null = null;
async function ensureFonts() {
  if (fontBold && fontRegular && fontItalic) return;
  const [b, r, i] = await Promise.all([
    fetch("https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-700-normal.ttf"),
    fetch("https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf"),
    fetch("https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-italic.ttf"),
  ]);
  fontBold = new Uint8Array(await b.arrayBuffer());
  fontRegular = new Uint8Array(await r.arrayBuffer());
  fontItalic = new Uint8Array(await i.arrayBuffer());
}

function esc(s: string) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

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
  return lines;
}

function pickSize(quote: string, maxChars: number) {
  const len = quote.length;
  if (len <= 60) return { fs: 64, lh: 76, mc: Math.min(maxChars, 18) };
  if (len <= 100) return { fs: 54, lh: 64, mc: Math.min(maxChars, 22) };
  if (len <= 140) return { fs: 46, lh: 56, mc: Math.min(maxChars, 26) };
  return { fs: 38, lh: 48, mc: Math.min(maxChars, 30) };
}

// Quote slide — 1080 x 1350 (IG 4:5)
function svgQuoteIG(opts: { quote: string; podcast: string; episode: string; weekLabel: string; index: number; total: number }) {
  const W = 1080, H = 1350;
  const { fs, lh, mc } = pickSize(opts.quote, 26);
  const lines = wrap(opts.quote, mc, 7);
  const blockH = lines.length * lh;
  const topY = (H - blockH) / 2 - 60 + fs;
  const tspans = lines.map((l, i) => `<tspan x="80" dy="${i === 0 ? 0 : lh}">${esc(l)}</tspan>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0c"/>
      <stop offset="100%" stop-color="#16161a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- top brand bar -->
  <text x="80" y="100" font-family="Inter" font-weight="700" font-size="22" fill="#71717a" letter-spacing="4">PODIVERZUM · ${esc(opts.weekLabel.toUpperCase())}</text>
  <rect x="80" y="115" width="60" height="3" fill="#ef4444"/>

  <!-- giant quotation mark -->
  <text x="80" y="${topY - fs - 30}" font-family="Inter" font-weight="700" font-size="160" fill="#ef4444" opacity="0.85">"</text>

  <!-- quote text -->
  <text x="80" y="${topY}" font-family="Inter" font-weight="700" font-size="${fs}" fill="#f5f5f7">
    ${tspans}
  </text>

  <!-- bottom block: podcast + episode + counter -->
  <rect x="80" y="${H - 220}" width="60" height="2" fill="#ef4444"/>
  <text x="80" y="${H - 180}" font-family="Inter" font-weight="700" font-size="26" fill="#f5f5f7">${esc(opts.podcast)}</text>
  <text x="80" y="${H - 145}" font-family="Inter" font-weight="400" font-size="22" fill="#a1a1aa">${esc(opts.episode.length > 60 ? opts.episode.slice(0, 58) + "…" : opts.episode)}</text>

  <text x="80" y="${H - 70}" font-family="Inter" font-weight="400" font-size="20" fill="#71717a">${opts.index} / ${opts.total} · ${SITE}</text>
</svg>`;
}

// Cover slide — 1080 x 1350 (IG 4:5)
function svgCoverIG(opts: { title: string; intro: string; weekLabel: string; itemCount: number }) {
  const W = 1080, H = 1350;
  const introLines = wrap(opts.intro, 32, 6);
  const tspans = introLines.map((l, i) => `<tspan x="80" dy="${i === 0 ? 0 : 48}">${esc(l)}</tspan>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0c"/>
      <stop offset="100%" stop-color="#16161a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <text x="80" y="120" font-family="Inter" font-weight="700" font-size="26" fill="#ef4444" letter-spacing="5">A HÉT A PODIVERZUMON</text>
  <rect x="80" y="135" width="80" height="3" fill="#ef4444"/>

  <text x="80" y="280" font-family="Inter" font-weight="700" font-size="60" fill="#f5f5f7">${esc(opts.weekLabel)}</text>

  <rect x="80" y="360" width="40" height="2" fill="#ef4444"/>

  <text x="80" y="430" font-family="Inter" font-weight="400" font-size="36" fill="#d4d4d8">
    ${tspans}
  </text>

  <text x="80" y="${H - 200}" font-family="Inter" font-weight="700" font-size="28" fill="#f5f5f7">${opts.itemCount} epizód, amit nem hagynánk ki →</text>
  <text x="80" y="${H - 70}" font-family="Inter" font-weight="700" font-size="22" fill="#71717a" letter-spacing="4">PODIVERZUM.HU</text>
</svg>`;
}

// FB share — 1200 x 630
function svgQuoteFB(opts: { quote: string; podcast: string; weekLabel: string }) {
  const W = 1200, H = 630;
  const { fs, lh, mc } = pickSize(opts.quote, 38);
  const lines = wrap(opts.quote, mc, 5);
  const blockH = lines.length * lh;
  const topY = (H - blockH) / 2 - 20 + fs;
  const tspans = lines.map((l, i) => `<tspan x="80" dy="${i === 0 ? 0 : lh}">${esc(l)}</tspan>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0a0a0c"/>
      <stop offset="100%" stop-color="#16161a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <text x="80" y="80" font-family="Inter" font-weight="700" font-size="18" fill="#ef4444" letter-spacing="4">PODIVERZUM · A HÉT · ${esc(opts.weekLabel.toUpperCase())}</text>
  <rect x="80" y="92" width="56" height="3" fill="#ef4444"/>
  <text x="80" y="${topY - fs - 10}" font-family="Inter" font-weight="700" font-size="120" fill="#ef4444" opacity="0.7">"</text>
  <text x="80" y="${topY}" font-family="Inter" font-weight="700" font-size="${fs}" fill="#f5f5f7">${tspans}</text>
  <text x="80" y="${H - 60}" font-family="Inter" font-weight="700" font-size="22" fill="#a1a1aa">${esc(opts.podcast)} · ${SITE}</text>
</svg>`;
}

async function render(svg: string, width: number): Promise<Uint8Array> {
  await ensureWasm();
  await ensureFonts();
  const r = new Resvg(svg, {
    fitTo: { mode: "width", value: width },
    background: "#0a0a0c",
    font: { fontBuffers: [fontRegular!, fontBold!, fontItalic!], defaultFontFamily: "Inter", loadSystemFonts: false },
  });
  return r.render().asPng();
}

function json(o: any, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method === "GET") return json({ ok: true, function: "generate-editorial-cards" });

  let body: any = {};
  try { body = await req.json(); } catch { /* */ }

  const postId = String(body?.post_id || "").trim();
  if (!postId) return json({ ok: false, error: "post_id required" }, 400);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: post, error } = await admin.from("editorial_posts").select("*").eq("id", postId).maybeSingle();
  if (error || !post) return json({ ok: false, error: `post not found: ${error?.message}` }, 404);

  const items = (post.items || []) as any[];
  if (items.length === 0) return json({ ok: false, error: "no items" }, 400);

  // Build week label from week_start/week_end
  const ws = new Date(post.week_start), we = new Date(post.week_end);
  const months = ["jan", "feb", "márc", "ápr", "máj", "jún", "júl", "aug", "szept", "okt", "nov", "dec"];
  const weekLabel = `${months[ws.getUTCMonth()]}. ${ws.getUTCDate()}. – ${we.getUTCDate()}.`;

  try {
    const generated: { kind: string; url: string; bytes: number }[] = [];
    const cardUrls: string[] = [];
    let coverUrl: string | null = null;

    // 1) Cover slide
    const coverSvg = svgCoverIG({ title: post.title, intro: post.intro || "", weekLabel, itemCount: items.length });
    const coverPng = await render(coverSvg, 1080);
    const coverPath = `editorial/${postId}/cover.png`;
    const { error: cErr } = await admin.storage.from("social-cards").upload(coverPath, coverPng, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
    if (cErr) throw new Error(`upload cover: ${cErr.message}`);
    coverUrl = admin.storage.from("social-cards").getPublicUrl(coverPath).data.publicUrl;
    generated.push({ kind: "ig_cover", url: coverUrl, bytes: coverPng.byteLength });
    cardUrls.push(coverUrl);

    // 2) One IG quote slide per item
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (!it.quote) continue;
      const svg = svgQuoteIG({ quote: it.quote, podcast: it.podcast_name, episode: it.title, weekLabel, index: i + 1, total: items.length });
      const png = await render(svg, 1080);
      const path = `editorial/${postId}/quote-${i + 1}.png`;
      const { error: e } = await admin.storage.from("social-cards").upload(path, png, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
      if (e) throw new Error(`upload quote ${i + 1}: ${e.message}`);
      const url = admin.storage.from("social-cards").getPublicUrl(path).data.publicUrl;
      it.cover_card_url = url;
      generated.push({ kind: `ig_quote_${i + 1}`, url, bytes: png.byteLength });
      cardUrls.push(url);
    }

    // 3) FB share with strongest quote (item[0])
    if (items[0]?.quote) {
      const fbSvg = svgQuoteFB({ quote: items[0].quote, podcast: items[0].podcast_name, weekLabel });
      const fbPng = await render(fbSvg, 1200);
      const fbPath = `editorial/${postId}/fb.png`;
      const { error: e } = await admin.storage.from("social-cards").upload(fbPath, fbPng, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
      if (e) throw new Error(`upload fb: ${e.message}`);
      const url = admin.storage.from("social-cards").getPublicUrl(fbPath).data.publicUrl;
      generated.push({ kind: "fb_share", url, bytes: fbPng.byteLength });
    }

    // Save back
    await admin.from("editorial_posts").update({
      items,
      cover_image_url: coverUrl,
      card_image_urls: cardUrls,
    }).eq("id", postId);

    return json({ ok: true, post_id: postId, generated, count: generated.length });
  } catch (e: any) {
    console.error("generate-editorial-cards error:", e?.message);
    return json({ ok: false, error: e?.message || "unknown" }, 500);
  }
});
