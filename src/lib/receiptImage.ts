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
  _format: ReceiptExportFormat = "story",
): Promise<Blob> {
  // iOS WebKit foreignObject bugok elkerülése:
  //  - NINCS off-screen wrapper transform: scale-lel (ez okozta a blank PNG-t).
  //  - Magát a receipt node-ot rasterizáljuk natív méretben, magas pixelRatio-val.
  //  - A node CSAK display:none-ban nem lehet → ha rejtve van, ideiglenesen láthatóvá tesszük
  //    egy off-screen konténerben.

  const rect = node.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width || node.offsetWidth || 360));
  const h = Math.max(1, Math.round(rect.height || node.offsetHeight || 640));

  // Várjuk meg a webfontokat — különben az első render üres szöveget rajzol.
  try {
    if ((document as any).fonts?.ready) {
      await (document as any).fonts.ready;
    }
  } catch { /* ignore */ }

  const opts = {
    width: w,
    height: h,
    pixelRatio: 3,
    cacheBust: true,
    backgroundColor: "#0a0a0a",
    skipFonts: true,
  };

  // iOS Safari: az ELSŐ toPng gyakran blank PNG, mert a foreignObject még nem
  // hidratált. Egy warm-up renderrel + rAF-fel kikényszerítjük a layout commitot.
  try { await toPng(node, opts); } catch { /* ignore warm-up */ }
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => setTimeout(r, 50));

  const dataUrl = await toPng(node, opts);
  const res = await fetch(dataUrl);
  return await res.blob();
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
