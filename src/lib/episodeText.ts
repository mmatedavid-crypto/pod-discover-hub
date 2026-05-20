// Unified episode description resolver + soft tier labels.
// Fallback chain: ai_summary → clean_text excerpt → RSS summary/description excerpt.
// Clean text is read from optional joined `episode_clean_text` row when present;
// the UI never blocks on it.

import { stripHtml } from "@/lib/text";

export type EpisodeTextSource = {
  ai_summary?: string | null;
  summary?: string | null;
  description?: string | null;
  episode_clean_text?: { cleaned_text?: string | null } | null;
  clean_text?: string | null;
};

function clean(s?: string | null): string {
  if (!s) return "";
  return stripHtml(s).replace(/\s+/g, " ").trim();
}

/**
 * Returns the best available description for an episode.
 * Order: ai_summary → clean_text → RSS summary → RSS description.
 */
export function pickEpisodeDescription(e: EpisodeTextSource, maxLen = 320): string {
  const candidates = [
    e.ai_summary,
    e.clean_text ?? e.episode_clean_text?.cleaned_text,
    e.summary,
    e.description,
  ];
  for (const c of candidates) {
    const t = clean(c);
    if (t.length >= 20) return t.length > maxLen ? t.slice(0, maxLen - 1) + "…" : t;
  }
  return "";
}

/**
 * Public-facing soft label for Formula C tiers.
 * Never expose raw S/A/B/C/D/E in public surfaces.
 */
export function softTierLabel(label?: string | null): string | null {
  switch (label) {
    case "S": return "Kiemelt forrás";
    case "A": return "Aktív podcast";
    case "B": return "Rendszeresen frissül";
    default: return null;
  }
}
