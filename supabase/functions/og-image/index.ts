// OG image edge function: SVG card for podcast/episode/site sharing.
// Dynamic SVG response cached by CDN. No external deps.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FONT_STACK = "Inter, -apple-system, system-ui, sans-serif";

function escapeXml(s: string): string {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function wrapText(text: string, maxChars: number, maxLines: number): string[] {
  const words = (text || "").trim().split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    if (!current) { current = w; continue; }
    if (current.length + 1 + w.length > maxChars) {
      lines.push(current);
      current = w;
      if (lines.length >= maxLines - 1) break;
    } else {
      current += " " + w;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    lines[lines.length - 1] = lines[lines.length - 1].replace(/\s+\S*$/, "") + "…";
  }
  return lines;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const kind = (url.searchParams.get("kind") || "site").slice(0, 20);
  const title = (url.searchParams.get("title") || "Podiverzum — Find it. Hear it.").slice(0, 160);
  const subtitle = (url.searchParams.get("subtitle") || "").slice(0, 120);
  const image = url.searchParams.get("image") || "";

  const W = 1200;
  const H = 630;

  const titleLines = wrapText(title, kind === "site" ? 30 : 32, 3);
  const titleFontSize = titleLines.length >= 3 ? 56 : titleLines.length === 2 ? 64 : 72;

  // Fetch + base64 the cover so it embeds (one network hop, cached at CDN)
  let coverDataUri = "";
  if (image && /^https?:\/\//.test(image)) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(image, { signal: ctrl.signal });
      clearTimeout(t);
      if (r.ok) {
        const ct = r.headers.get("content-type") || "image/jpeg";
        const buf = new Uint8Array(await r.arrayBuffer());
        if (buf.byteLength < 800_000) {
          let bin = "";
          for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
          coverDataUri = `data:${ct};base64,${btoa(bin)}`;
        }
      }
    } catch { /* ignore — render without cover */ }
  }

  const coverSize = 360;
  const coverX = 80;
  const coverY = (H - coverSize) / 2;

  const textX = coverDataUri ? coverX + coverSize + 60 : 80;
  const textW = W - textX - 80;

  const titleSvg = titleLines
    .map((line, i) => `<text x="${textX}" y="${260 + i * (titleFontSize + 12)}" font-family="${FONT_STACK}" font-weight="800" font-size="${titleFontSize}" fill="#ffffff">${escapeXml(line)}</text>`)
    .join("");

  const subtitleSvg = subtitle
    ? `<text x="${textX}" y="220" font-family="${FONT_STACK}" font-weight="600" font-size="28" fill="#a3a3a3" letter-spacing="2">${escapeXml(subtitle.toUpperCase())}</text>`
    : "";

  const coverSvg = coverDataUri
    ? `<defs>
         <clipPath id="coverClip">
           <rect x="${coverX}" y="${coverY}" width="${coverSize}" height="${coverSize}" rx="20" />
         </clipPath>
       </defs>
       <image href="${coverDataUri}" x="${coverX}" y="${coverY}" width="${coverSize}" height="${coverSize}" preserveAspectRatio="xMidYMid slice" clip-path="url(#coverClip)" />
       <rect x="${coverX}" y="${coverY}" width="${coverSize}" height="${coverSize}" rx="20" fill="none" stroke="#ffffff22" stroke-width="2"/>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0a0a0a" />
        <stop offset="100%" stop-color="#1a0b1f" />
      </linearGradient>
      <radialGradient id="glow" cx="0.85" cy="0.15" r="0.7">
        <stop offset="0%" stop-color="#ff2e63" stop-opacity="0.35" />
        <stop offset="60%" stop-color="#ff2e63" stop-opacity="0.05" />
        <stop offset="100%" stop-color="#ff2e63" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
    ${coverSvg}
    ${subtitleSvg}
    ${titleSvg}
    <g transform="translate(${textX}, ${H - 90})">
      <circle cx="14" cy="14" r="5" fill="#ff2e63"/>
      <text x="32" y="20" font-family="${FONT_STACK}" font-weight="700" font-size="26" fill="#ffffff" letter-spacing="0.5">PODIVERZUM</text>
      <text x="32" y="50" font-family="${FONT_STACK}" font-weight="500" font-size="18" fill="#9ca3af">Find it. Hear it.</text>
    </g>
  </svg>`;

  return new Response(svg, {
    headers: {
      ...corsHeaders,
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
});
