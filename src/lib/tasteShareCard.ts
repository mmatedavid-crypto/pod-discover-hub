// Render a 1080x1350 share card to a Blob (PNG). Pure canvas — no external deps.
import type { Archetype } from "./tasteArchetypes";

export type ShareCardInput = {
  archetype: Archetype;
  interests: string[]; // 3-5 short labels
  dna: Array<{ label: string; intensity: string; strength: number }>; // top 3-5 topics, rank-based
  element?: { label: string; symbol: string } | null;
  auraColors?: string[]; // top 2-3 HSL color strings for the aura background
};

const LOGO_SRC = "/icon-512.png";

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function ensureFontsReady() {
  try {
    // Ensure Inter is actually rasterised before drawing to canvas.
    // Fallback to system if not present.
    if ((document as any).fonts?.load) {
      await Promise.all([
        (document as any).fonts.load("700 76px Inter"),
        (document as any).fonts.load("600 36px Inter"),
        (document as any).fonts.load("500 26px Inter"),
        (document as any).fonts.load("400 22px Inter"),
      ]);
      await (document as any).fonts.ready;
    }
  } catch { /* ignore */ }
}

export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  await ensureFontsReady();

  const W = 1080, H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // ── Aura background (radial gradients blended over deep base)
  ctx.fillStyle = "#08070d";
  ctx.fillRect(0, 0, W, H);

  const auraColors = (input.auraColors && input.auraColors.length > 0)
    ? input.auraColors
    : ["hsl(340 80% 55%)", "hsl(280 70% 50%)", "hsl(220 80% 45%)"];

  auraColors.slice(0, 3).forEach((c, i) => {
    const cx = i === 0 ? W * 0.75 : i === 1 ? W * 0.2 : W * 0.5;
    const cy = i === 0 ? H * 0.18 : i === 1 ? H * 0.55 : H * 0.85;
    const r = i === 0 ? 720 : 600;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, c.replace(")", " / 0.55)").replace("hsl(", "hsla("));
    g.addColorStop(1, c.replace(")", " / 0)").replace("hsl(", "hsla("));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  });

  // Subtle grain overlay (vignette)
  const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.75);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.55)");
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, W, H);

  // Red accent stripe
  ctx.fillStyle = "#e11d48";
  ctx.fillRect(0, 0, W, 10);

  // ── Top bar: logo + wordmark + url
  const logo = await loadImage(LOGO_SRC);
  if (logo) {
    // Rounded square mask
    const lx = 70, ly = 70, ls = 72;
    ctx.save();
    roundRect(ctx, lx, ly, ls, ls, 14);
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fillRect(lx, ly, ls, ls);
    ctx.drawImage(logo, lx, ly, ls, ls);
    ctx.restore();
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 38px Inter, system-ui, sans-serif";
  ctx.fillText("Podiverzum", logo ? 160 : 70, 100);
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.font = "500 22px Inter, system-ui, sans-serif";
  ctx.fillText("podiverzum.hu", logo ? 160 : 70, 132);

  // Kicker
  ctx.fillStyle = "#fda4af";
  ctx.font = "600 24px Inter, system-ui, sans-serif";
  ctx.fillText("EZ AZ ÉN PODIVERZUMOM", 70, 240);

  // Archetype name (large)
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 84px Inter, system-ui, sans-serif";
  const nameEnd = wrap(ctx, input.archetype.name, 70, 330, W - 140, 92);

  // Tagline
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = "400 30px Inter, system-ui, sans-serif";
  const taglineEnd = wrap(ctx, input.archetype.tagline, 70, nameEnd + 40, W - 140, 42);

  // Optional element chip
  let cursorY = taglineEnd + 50;
  if (input.element) {
    const label = `${input.element.symbol}  ${input.element.label}`;
    ctx.font = "600 24px Inter, system-ui, sans-serif";
    const w = ctx.measureText(label).width + 40;
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    roundRect(ctx, 70, cursorY - 30, w, 44, 22);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    roundRect(ctx, 70, cursorY - 30, w, 44, 22);
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, 90, cursorY);
    cursorY += 50;
  }

  // Interests chips
  let chipY = cursorY + 20;
  let chipX = 70;
  ctx.font = "500 26px Inter, system-ui, sans-serif";
  for (const label of input.interests.slice(0, 5)) {
    const w = ctx.measureText(label).width + 40;
    if (chipX + w > W - 70) { chipX = 70; chipY += 60; }
    ctx.fillStyle = "rgba(225,29,72,0.22)";
    roundRect(ctx, chipX, chipY, w, 46, 23);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, chipX + 20, chipY + 31);
    chipX += w + 14;
  }

  // DNA bars
  let dnaY = chipY + 110;
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 30px Inter, system-ui, sans-serif";
  ctx.fillText("Podcast-DNS", 70, dnaY);
  dnaY += 30;
  for (const row of input.dna.slice(0, 5)) {
    dnaY += 54;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = "500 24px Inter, system-ui, sans-serif";
    ctx.fillText(row.label, 70, dnaY);
    ctx.fillStyle = "rgba(253,164,175,0.95)";
    ctx.font = "500 20px Inter, system-ui, sans-serif";
    const intensityW = ctx.measureText(row.intensity).width;
    ctx.fillText(row.intensity, W - 70 - intensityW, dnaY);
    ctx.fillStyle = "rgba(255,255,255,0.14)";
    roundRect(ctx, 70, dnaY + 12, W - 140, 12, 6);
    ctx.fill();
    ctx.fillStyle = "#e11d48";
    roundRect(ctx, 70, dnaY + 12, Math.max(20, (W - 140) * Math.min(1, row.strength)), 12, 6);
    ctx.fill();
  }

  // ── Footer brand band
  const fbH = 150;
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  ctx.fillRect(0, H - fbH, W, fbH);
  ctx.fillStyle = "#e11d48";
  ctx.fillRect(0, H - fbH, W, 4);

  if (logo) {
    const fls = 64;
    const fly = H - fbH + (fbH - fls) / 2;
    ctx.save();
    roundRect(ctx, 70, fly, fls, fls, 12);
    ctx.clip();
    ctx.fillStyle = "#000";
    ctx.fillRect(70, fly, fls, fls);
    ctx.drawImage(logo, 70, fly, fls, fls);
    ctx.restore();
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = "800 44px Inter, system-ui, sans-serif";
  ctx.fillText("podiverzum.hu", logo ? 160 : 70, H - fbH / 2 - 4);
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "500 22px Inter, system-ui, sans-serif";
  ctx.fillText("Találd meg a tied. Hallgasd. ·  Magyar podcast univerzum", logo ? 160 : 70, H - fbH / 2 + 30);

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png", 0.95);
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number): number {
  const words = (text || "").split(/\s+/);
  let line = "";
  let lastY = y;
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      lastY = y;
      y += lineH;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, x, y); lastY = y; }
  return lastY;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export type ShareResult = "shared" | "downloaded" | "cancelled" | "error";

export async function shareOrDownload(blob: Blob, filename = "podiverzum.png"): Promise<ShareResult> {
  const file = new File([blob], filename, { type: "image/png" });
  // @ts-ignore
  if (typeof navigator !== "undefined" && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      // @ts-ignore
      await navigator.share({ files: [file], title: "Ez az én Podiverzumom", text: "Ez az én Podiverzumom — podiverzum.hu" });
      return "shared";
    } catch (e: any) {
      if (e?.name === "AbortError") return "cancelled";
      // fall through to download
    }
  }
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return "downloaded";
  } catch {
    return "error";
  }
}
