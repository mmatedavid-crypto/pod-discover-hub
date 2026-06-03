// Hungarian output guard for public-facing AI text on podiverzum.hu.
// Lightweight heuristic — detects obviously non-Hungarian output (e.g. English summary).
// Usage:
//   import { isHungarianish, ensureHungarian } from "../_shared/hu-language-guard.ts";

const HU_DIACRITICS = /[őűáéíóúöüÖÜÓŐÚÉÁŰÍ]/g;
const EN_STOPWORDS = new Set([
  "the","and","of","to","in","is","for","on","with","that","this","are","was","were","by","from","as","at","an","be","or","it","its","their","they","you","we","our","your","has","have","had","but","not","which","also","more","than","these","those","about","when","what","who","how","why",
]);
const HU_STOPWORDS = new Set([
  "és","hogy","a","az","nem","van","ezt","ezek","ehhez","azt","azok","is","de","ha","vagy","ami","amely","amikor","mert","míg","mint","csak","még","már","így","úgy","ezért","ezzel","azzal","arra","erről","arról","kapcsolatban","alapján","szerint","közben","közül","között","kapcsolat","például","találtunk","epizód","epizódok","podcast",
]);

export function huScore(text: string): { ok: boolean; huRatio: number; enRatio: number; diaPer100: number; totalWords: number } {
  const t = String(text || "").toLowerCase();
  const words = t.match(/[\p{L}']+/gu) || [];
  const total = words.length || 1;
  let hu = 0, en = 0;
  for (const w of words) {
    if (HU_STOPWORDS.has(w)) hu++;
    else if (EN_STOPWORDS.has(w)) en++;
  }
  const dia = (t.match(HU_DIACRITICS) || []).length;
  const diaPer100 = (dia / Math.max(t.length, 1)) * 100;
  const huRatio = hu / total;
  const enRatio = en / total;
  // Heuristic v2 (2026-05-26): a single accented char in a proper noun (e.g. "Ábris")
  // is NOT enough proof of Hungarian. Require either real HU stopwords OR genuine
  // diacritic density. Otherwise, if EN signal dominates, mark as non-HU.
  // - Clearly NOT Hungarian: EN stopwords > 6% AND HU stopwords < 1% AND diacritic
  //   density < 1.0/100ch (was 0.3 — too lenient, missed English text with 1 Hungarian name).
  // - Also NOT Hungarian: EN stopwords > 12% regardless of diacritics (very strong EN signal).
  const notHu = (enRatio > 0.06 && huRatio < 0.01 && diaPer100 < 1.0) || enRatio > 0.12;
  const ok = !notHu;
  return { ok, huRatio, enRatio, diaPer100, totalWords: total };
}

export function isHungarianish(text: string): boolean {
  if (!text || text.trim().length < 20) return true; // too short to judge
  return huScore(text).ok;
}

export function nonHungarianPublicFields(fields: Record<string, unknown>): string[] {
  const entries = Object.entries(fields)
    .map(([key, value]) => [key, String(value || "").replace(/\s+/g, " ").trim()] as const)
    .filter(([, value]) => value.length > 0);

  const failing = new Set<string>();
  for (const [key, value] of entries) {
    if (value.length >= 20 && !isHungarianish(value)) failing.add(key);
  }

  const combined = entries.map(([, value]) => value).join(" ");
  if (combined.length >= 20 && !isHungarianish(combined)) {
    for (const [key] of entries) failing.add(key);
  }

  return Array.from(failing);
}

export function assertHungarianPublicFields(fields: Record<string, unknown>): void {
  const failing = nonHungarianPublicFields(fields);
  if (failing.length > 0) {
    throw new Error(`hu_language_guard_failed:${failing.join(",")}`);
  }
}

// Wrap an async generator function. If the first output is non-HU, regenerate once with stronger HU instruction.
// If still non-HU, return fallback.
export async function ensureHungarian(
  generate: (extraSystemHint?: string) => Promise<string>,
  fallback: string,
): Promise<{ text: string; regenerated: boolean; fellBack: boolean }> {
  const first = (await generate()).trim();
  if (isHungarianish(first)) return { text: first, regenerated: false, fellBack: false };
  const second = (await generate("KRITIKUS: A válasz NYELVE KIZÁRÓLAG MAGYAR. Soha ne válaszolj angolul. Ha a forrás angol, fordítsd le természetes magyar nyelvre. Ne keverd a két nyelvet.")).trim();
  if (isHungarianish(second)) return { text: second, regenerated: true, fellBack: false };
  return { text: fallback, regenerated: true, fellBack: true };
}
