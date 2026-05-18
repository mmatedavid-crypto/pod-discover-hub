// Smart Player preview gating — enable via ?player_preview=1 (persisted).
const LS_KEY = "podiverzum_player_preview";

export function isPlayerPreviewActive(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("player_preview");
    if (q === "1" || q === "true") {
      try { localStorage.setItem(LS_KEY, "true"); } catch { /* noop */ }
      return true;
    }
    if (q === "0" || q === "false") {
      try { localStorage.removeItem(LS_KEY); } catch { /* noop */ }
      return false;
    }
    return localStorage.getItem(LS_KEY) === "true";
  } catch {
    return false;
  }
}

export function setPlayerPreview(enabled: boolean) {
  try {
    if (enabled) localStorage.setItem(LS_KEY, "true");
    else localStorage.removeItem(LS_KEY);
  } catch { /* noop */ }
}
