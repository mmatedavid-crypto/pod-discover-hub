// Receipt → PNG export + share/download helper.
// Mobil-first Web Share API `files`-szel, fallback letöltés és link másolás.

import { toPng } from "html-to-image";

export type ReceiptExportFormat = "story" | "square";

const TARGETS: Record<ReceiptExportFormat, { w: number; h: number }> = {
  story: { w: 1080, h: 1920 },
  square: { w: 1080, h: 1080 },
};

/**
 * A megadott DOM node-ot (receipt komponens gyökere) PNG-vé alakítja egy
 * fix méretű "vászonra" középre rendezve, 2× pixel ratio-val.
 *
 * A receipt belső szélessége 360px — a vászonra arányosan skálázzuk fel,
 * hogy mobil-share méretben éles legyen.
 */
export async function renderReceiptPng(
  node: HTMLElement,
  format: ReceiptExportFormat = "story",
): Promise<Blob> {
  const target = TARGETS[format];

  // Off-screen wrapper, hogy ne befolyásolja az aktuális layoutot.
  const wrap = document.createElement("div");
  wrap.style.position = "fixed";
  wrap.style.left = "-99999px";
  wrap.style.top = "0";
  wrap.style.width = `${target.w}px`;
  wrap.style.height = `${target.h}px`;
  wrap.style.display = "flex";
  wrap.style.alignItems = "center";
  wrap.style.justifyContent = "center";
  wrap.style.background = "#0a0a0a";
  // Halk, warm-paper "asztal" háttér a nyugta köré.
  wrap.style.backgroundImage =
    "radial-gradient(ellipse at center, #1a1a1a 0%, #050505 70%)";

  // A receipt klónja arányosan felskálázva.
  const clone = node.cloneNode(true) as HTMLElement;
  // A natív szélesség 360 — a vászon szélességének ~70%-át töltse ki.
  const scale = (target.w * 0.78) / 360;
  clone.style.transform = `scale(${scale})`;
  clone.style.transformOrigin = "center center";
  wrap.appendChild(clone);
  document.body.appendChild(wrap);

  try {
    // iOS Safari fix #1: várjuk meg a webfontokat. Ha még betöltőben vannak,
    // az első toPng üres szöveget rajzol, mert a font swap a render után jön.
    try {
      if ((document as any).fonts?.ready) {
        await (document as any).fonts.ready;
      }
    } catch { /* ignore */ }

    const opts = {
      width: target.w,
      height: target.h,
      pixelRatio: 2,
      cacheBust: true,
      style: { transform: "none" },
      // iOS Safari hibázik foreignObject-tel ha fontEmbedCss üres — explicit kapcsoljuk ki a font fetch-et.
      skipFonts: true,
    };

    // iOS Safari fix #2: WARM-UP render. Az első hívás gyakran üres/blank
    // PNG-t ad vissza, mert a foreignObject még nem hidratált. A 2. hívás
    // már a teljes tartalmat tartalmazza.
    try { await toPng(wrap, opts); } catch { /* ignore warm-up errors */ }
    // Kis szünet, hogy a layout/style biztosan committelt legyen.
    await new Promise((r) => requestAnimationFrame(() => r(null)));

    const dataUrl = await toPng(wrap, opts);
    const res = await fetch(dataUrl);
    return await res.blob();
  } finally {
    document.body.removeChild(wrap);
  }
}

export type ShareOutcome = "shared" | "downloaded" | "copied" | "cancelled" | "error";

export async function shareReceipt(opts: {
  blob: Blob;
  filename?: string;
  title: string;
  text: string;
  url: string;
}): Promise<ShareOutcome> {
  const { blob, filename = "podiverzum-receipt.png", title, url } = opts;
  const file = new File([blob], filename, { type: "image/png", lastModified: Date.now() });
  const nav = navigator as Navigator & {
    canShare?: (d: ShareData) => boolean;
    share?: (d: ShareData) => Promise<void>;
  };
  // iOS Safari bug: ha `files` ÉS `url`/`text` is megy, a share sheet sokszor
  // csak a linket osztja meg, a képet eldobja. Ezért FÁJL-only payload —
  // így iOS képként kezeli, és megjelenik a "Stories", "Save Image" (Photos)
  // és "Instagram" target a sheet-ben.
  if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title });
      return "shared";
    } catch (e: any) {
      if (e?.name === "AbortError") return "cancelled";
      // continue to fallback
    }
  }
  // Fallback: link másolás (asztali Safari / régi böngészők).
  try {
    await navigator.clipboard.writeText(url);
    return "copied";
  } catch {
    return "error";
  }
}

function isIOS(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes("Mac") && "ontouchend" in document);
}

export function downloadReceipt(blob: Blob, filename = "podiverzum-receipt.png") {
  try {
    const url = URL.createObjectURL(blob);
    // iOS Safari: az `<a download>` mindig a Files-ba ment, nem a Photos-ba.
    // Helyette új fülön megnyitjuk a képet — a user long-press → "Hozzáadás
    // a Fotókhoz" 1 mozdulattal a Photos appba kerül.
    if (isIOS()) {
      const win = window.open(url, "_blank", "noopener");
      if (!win) {
        // Pop-up blokkolva — fallback ugyanaz a tabra.
        window.location.href = url;
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return true;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}
