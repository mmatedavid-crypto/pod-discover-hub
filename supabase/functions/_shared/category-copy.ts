// Shared, pure category landing-page copy. Imported by BOTH the prerender edge
// function and the React CategoryDetail page so bot HTML and user HTML agree.
// No invented rankings, popularity numbers or recommendations — only the
// category name, the editorial description stored in `categories`, and a safe
// slug-keyed fallback for the verified slugs listed below.

export type CategoryCopyInput = {
  name: string;
  slug: string;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

/** Editorial fallbacks keyed to verified, active category slugs. */
const SLUG_FALLBACK_INTRO: Record<string, string> = {
  hirek: "Magyar hírek, politika és közélet epizódonként — napi adások és hosszabb elemző beszélgetések.",
  uzlet: "Vállalkozás, karrier, stratégia és menedzsment magyar podcastokban, interjúkkal és esettanulmányokkal.",
  penzugy: "Befektetés, tőzsde, makrogazdaság és személyes pénzügyek magyar nyelvű podcast epizódokban.",
  tech: "Technológia, szoftverfejlesztés és mesterséges intelligencia magyar podcastokban, hírektől a mély szakmai beszélgetésekig.",
  tudomany: "Tudományos kutatás, fizika, biológia és nagy ötletek magyar podcastokban, kutatói interjúkkal.",
  onfejlesztes: "Önismeret, szokások, motiváció és pszichológia magyar podcast epizódokban.",
  parkapcsolat: "Randizás, párkapcsolat, szexualitás és kapcsolati pszichológia magyar podcastokban.",
  egeszseg: "Egészség, mozgás, mentális jóllét és hosszú élet magyar nyelvű podcast epizódokban.",
  vallas: "Teológia, Biblia, ima és spiritualitás magyar podcastokban, igehirdetésekkel és beszélgetésekkel.",
  oktatas: "Tanulás, nyelvek, készségek és magyarázó előadások magyar podcast epizódokban.",
  tortenelem: "Magyar és világtörténelem, életrajzok és korszakok magyar nyelvű történelmi podcastokban.",
  kultura: "Társadalom, kultúra, filozófia és hosszú interjúk magyar podcastokban.",
  gasztro: "Főzés, receptek, éttermek, kávé, bor és italok magyar gasztronómiai podcastokban.",
  konyvek: "Könyvajánlók, szerzői interjúk, irodalom és hangjáték magyar podcastokban.",
  "film-tv": "Filmek, sorozatok és popkultúra magyar podcastokban, kritikákkal és beszélgetésekkel.",
  zene: "Zenészinterjúk, zenetörténet és zenei kritika magyar podcastokban.",
  muveszet: "Vizuális művészet, design, építészet és színház magyar podcastokban.",
  sport: "Futball, kosárlabda, motorsport és további sportágak magyar sportpodcastokban.",
  humor: "Vicces, szórakoztató beszélgetések, stand-up és reggeli show-k magyar podcastokban.",
  "true-crime": "Igaz bűnügyek, rejtélyek és paranormális történetek magyar podcastokban.",
  gyerek: "Gyerekeknek és családoknak szóló műsorok, mesék és szülőségről szóló beszélgetések.",
};

function clean(text?: string | null): string {
  return String(text ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/** H1 that always contains the "podcastok" keyword, without duplicating it. */
export function categoryHeading(input: CategoryCopyInput): string {
  const name = clean(input.name);
  if (!name) return "Podcastok";
  if (/podcast/i.test(name)) return name;
  return `${name} podcastok`;
}

/**
 * Visible intro paragraph. Prefers the stored editorial description, then the
 * slug-keyed fallback, then a neutral sentence built from the category name.
 */
export function categoryIntro(input: CategoryCopyInput): string {
  const stored = clean(input.description);
  if (stored) return stored;
  const fallback = SLUG_FALLBACK_INTRO[clean(input.slug)];
  if (fallback) return fallback;
  return `${clean(input.name)} témájú magyar podcastok és epizódok.`;
}

/** Second sentence: what the visitor can actually do on this page. */
export function categoryGuidance(input: CategoryCopyInput): string {
  const name = clean(input.name);
  return `Válogass a friss epizódok, a műsorok és a visszatérő témák között, vagy keress rá egy konkrét kérdésre a ${name} kategórián belül.`;
}

/** Meta description (kept under 160 chars by callers/setSeo). */
export function categoryMetaDescription(input: CategoryCopyInput): string {
  const stored = clean(input.seoDescription);
  if (stored) return stored.slice(0, 160);
  const intro = categoryIntro(input);
  const suffix = " Friss epizódok, műsorok és témák egy helyen.";
  return (intro.length + suffix.length <= 160 ? intro + suffix : intro).slice(0, 160);
}

/** Page title. Always contains the category name and the "podcastok" keyword. */
export function categoryTitle(input: CategoryCopyInput): string {
  const stored = clean(input.seoTitle);
  if (stored) return stored;
  return `${categoryHeading(input)} és epizódok — Podiverzum`;
}
