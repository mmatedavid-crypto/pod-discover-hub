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
  // Heuristic: clearly Hungarian if HU stopwords > 4% OR diacritic density > 1.5/100ch.
  // Clearly NOT Hungarian if EN stopwords > 8% AND HU stopwords < 1% AND diacritics < 0.3/100ch.
  const notHu = enRatio > 0.08 && huRatio < 0.01 && diaPer100 < 0.3;
  const ok = !notHu;
  return { ok, huRatio, enRatio, diaPer100, totalWords: total };
}

export function isHungarianish(text: string): boolean {
  if (!text || text.trim().length < 20) return true; // too short to judge
  return huScore(text).ok;
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
