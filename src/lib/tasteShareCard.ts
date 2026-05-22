// Render a 1080x1350 share card to a Blob (PNG). Pure canvas — no external deps.
import type { Archetype } from "./tasteArchetypes";

export type ShareCardInput = {
  archetype: Archetype;
  interests: string[]; // 3-5 short labels
  dna: Array<{ label: string; intensity: string; strength: number }>; // top 3-5 topics, rank-based
};

export async function renderShareCard(input: ShareCardInput): Promise<Blob> {
  const W = 1080, H = 1350;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;

  // Background
  ctx.fillStyle = "#0a0a0a";
  ctx.fillRect(0, 0, W, H);

  // Red accent stripe
  ctx.fillStyle = "#e11d48";
  ctx.fillRect(0, 0, W, 14);

  // Brand
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 36px Inter, system-ui, sans-serif";
  ctx.fillText("Podiverzum", 70, 120);

  ctx.fillStyle = "#e11d48";
  ctx.font = "500 28px Inter, system-ui, sans-serif";
  ctx.fillText("Ez az én Podiverzumom", 70, 180);

  // Archetype name (large)
  ctx.fillStyle = "#ffffff";
  ctx.font = "700 76px Inter, system-ui, sans-serif";
  wrap(ctx, input.archetype.name, 70, 320, W - 140, 86);

  // Tagline
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = "400 30px Inter, system-ui, sans-serif";
  wrap(ctx, input.archetype.tagline, 70, 520, W - 140, 42);

  // Interests
  let chipY = 700;
  let chipX = 70;
  ctx.font = "500 26px Inter, system-ui, sans-serif";
  for (const label of input.interests.slice(0, 5)) {
    const w = ctx.measureText(label).width + 40;
    if (chipX + w > W - 70) { chipX = 70; chipY += 60; }
    ctx.fillStyle = "rgba(225,29,72,0.18)";
    roundRect(ctx, chipX, chipY, w, 46, 23);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, chipX + 20, chipY + 31);
    chipX += w + 14;
  }

  // DNA bars
  let dnaY = chipY + 110;
  ctx.fillStyle = "#ffffff";
  ctx.font = "600 28px Inter, system-ui, sans-serif";
  ctx.fillText("Podcast-DNS", 70, dnaY);
  dnaY += 30;
  for (const row of input.dna.slice(0, 5)) {
    dnaY += 50;
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "400 22px Inter, system-ui, sans-serif";
    ctx.fillText(row.label, 70, dnaY);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(ctx, 70, dnaY + 10, W - 140, 12, 6);
    ctx.fill();
    ctx.fillStyle = "#e11d48";
    roundRect(ctx, 70, dnaY + 10, Math.max(20, (W - 140) * Math.min(1, row.pct)), 12, 6);
    ctx.fill();
  }

  // Footer
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.font = "400 24px Inter, system-ui, sans-serif";
  ctx.fillText("Find it. Hear it.", 70, H - 90);
  ctx.fillStyle = "#e11d48";
  ctx.font = "600 26px Inter, system-ui, sans-serif";
  ctx.fillText("podiverzum.hu", 70, H - 50);

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error("toBlob failed")), "image/png", 0.95);
  });
}

function wrap(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxW: number, lineH: number) {
  const words = text.split(/\s+/);
  let line = "";
  for (const w of words) {
    const test = line ? line + " " + w : w;
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y);
      y += lineH;
      line = w;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, y);
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

export async function shareOrDownload(blob: Blob, filename = "podiverzum.png") {
  const file = new File([blob], filename, { type: "image/png" });
  // @ts-ignore
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      // @ts-ignore
      await navigator.share({ files: [file], title: "Ez az én Podiverzumom" });
      return;
    } catch { /* user cancelled, fall through to download */ }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
