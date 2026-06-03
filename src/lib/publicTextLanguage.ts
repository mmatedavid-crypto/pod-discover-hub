import { stripHtml } from "@/lib/text";

const HU_DIACRITICS = /[őűáéíóúöüÖÜÓŐÚÉÁŰÍ]/g;
const EN_STOPWORDS = new Set([
  "the", "and", "of", "to", "in", "is", "for", "on", "with", "that", "this", "are", "was", "were",
  "by", "from", "as", "at", "an", "be", "or", "it", "its", "their", "they", "you", "we", "our",
  "your", "has", "have", "had", "but", "not", "which", "also", "more", "than", "these", "those",
  "about", "when", "what", "who", "how", "why", "episode", "discusses", "explores", "features",
  "conversation", "interview", "host", "guest", "listeners", "summary",
]);
const HU_STOPWORDS = new Set([
  "és", "hogy", "a", "az", "egy", "van", "nem", "mert", "podcast", "adás", "adas", "epizód",
  "epizod", "beszélgetés", "beszelgetes", "magyar", "témája", "temaja", "vendég", "vendeg",
  "műsor", "musor", "hallgatók", "hallgatok", "szól", "szol", "bemutatja", "körül", "korul",
  "kapcsolatban", "szerint", "alapján", "alapjan", "közben", "kozben", "arról", "arrol",
  "erről", "errol", "hazai", "közéleti", "kozeleti", "gazdasági", "gazdasagi", "társadalmi",
  "tarsadalmi",
]);

export function isHungarianishPublicText(text?: string | null): boolean {
  const raw = stripHtml(text || "").replace(/\s+/g, " ").trim();
  if (raw.length < 20) return true;
  const t = raw.toLowerCase();
  const words = t.match(/[\p{L}']+/gu) || [];
  const total = words.length || 1;
  let hu = 0;
  let en = 0;
  for (const word of words) {
    if (HU_STOPWORDS.has(word)) hu++;
    else if (EN_STOPWORDS.has(word)) en++;
  }
  const diaPer100 = ((t.match(HU_DIACRITICS) || []).length / Math.max(t.length, 1)) * 100;
  const huRatio = hu / total;
  const enRatio = en / total;
  return !((enRatio > 0.06 && huRatio < 0.01 && diaPer100 < 1.0) || enRatio > 0.12);
}

export function sanitizeHungarianPublicText(text?: string | null): string {
  const clean = stripHtml(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  return isHungarianishPublicText(clean) ? clean : "";
}
