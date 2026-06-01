// Receipt → PNG export + share/download helper.
// Mobil-first Web Share API `files`-szel, fallback letöltés és link másolás.
//
// iOS WebKit `foreignObject` bug — a html-to-image gyakran üres / fekete
// képet rajzol Safari/Chrome iOS alatt. A `modern-screenshot` lib pont erre
// készült (pre-warm + retry + safer SVG serialization).

import { domToBlob } from "modern-screenshot";

export type ReceiptExportFormat = "story" | "square";

const RECEIPT_BG = "#f7f4ee"; // megegyezik a ListenerReceipt belső háttérével

/**
 * A megadott DOM node-ot (receipt komponens gyökere) PNG Blob-ká alakítja.
 * Capture közben ideiglenesen lekapcsoljuk az iOS-en problémás CSS-eket
 * (SVG noise háttér, box-shadow), majd visszaállítjuk őket.
 */
export async function renderReceiptPng(
  node: HTMLElement,
  _format: ReceiptExportFormat = "story",
): Promise<Blob> {
  const rect = node.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width || node.offsetWidth || 360));
  const h = Math.max(1, Math.round(rect.height || node.offsetHeight || 640));

  // Webfontok betöltésére várunk — különben az első render üres szöveget rajzol.
  try {
    if ((document as any).fonts?.ready) {
      await (document as any).fonts.ready;
    }
  } catch { /* ignore */ }

  // iOS WebKit-en a feTurbulence SVG háttér + box-shadow gyakran kinyírja a
  // foreignObject rasterizációt → fekete/üres PNG. Capture idejére kivesszük.
  const prevBgImage = node.style.backgroundImage;
  const prevBoxShadow = node.style.boxShadow;
  node.style.backgroundImage = "none";
  node.style.boxShadow = "none";

  // Egy layout-commit, mielőtt rasterizálunk.
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => setTimeout(r, 30));

  try {
    const blob = await domToBlob(node, {
      width: w,
      height: h,
      scale: 3,
      backgroundColor: RECEIPT_BG,
      type: "image/png",
      // iOS: néha az első próbálkozás üres — a lib belső retry-ja segít.
      features: { removeControlCharacter: false },
    });
    if (!blob) throw new Error("domToBlob returned null");
    return blob;
  } finally {
    node.style.backgroundImage = prevBgImage;
    node.style.boxShadow = prevBoxShadow;
  }
}

export type ShareOutcome = "shared" | "downloaded" | "copied" | "cancelled" | "error";

async function copyTextFallback(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    ta.style.top = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

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
  // csak a linket osztja meg, a képet eldobja. Ezért FÁJL-only payload.
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
  return (await copyTextFallback(url)) ? "copied" : "error";
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
