import { slugify } from "./slug";

const CATEGORY_TO_HU: Record<string, { label: string; slug: string }> = {
  "News & Politics": { label: "Hírek és politika", slug: "hirek" },
  "Business & Finance": { label: "Üzlet és gazdaság", slug: "uzlet" },
  Finance: { label: "Pénzügy és befektetés", slug: "penzugy" },
  Technology: { label: "Tech", slug: "tech" },
  "Science & Ideas": { label: "Tudomány", slug: "tudomany" },
  "Self-Improvement": { label: "Önfejlesztés", slug: "onfejlesztes" },
  "Psychology & Relationships": { label: "Önfejlesztés", slug: "onfejlesztes" },
  Relationships: { label: "Párkapcsolat", slug: "parkapcsolat" },
  "Health, Fitness & Longevity": { label: "Egészség", slug: "egeszseg" },
  "Religion & Spirituality": { label: "Vallás és spiritualitás", slug: "vallas" },
  "Education & Explainer": { label: "Oktatás", slug: "oktatas" },
  History: { label: "Történelem", slug: "tortenelem" },
  "Society & Culture": { label: "Kultúra és társadalom", slug: "kultura" },
  Food: { label: "Gasztronómia", slug: "gasztro" },
  "Books & Literature": { label: "Könyvek és irodalom", slug: "konyvek" },
  "Fiction & Audio Drama": { label: "Rádiószínház", slug: "radioszinhaz" },
  "Film, TV & Pop Culture": { label: "Film, tévé és popkultúra", slug: "film-tv" },
  Music: { label: "Zene", slug: "zene" },
  Arts: { label: "Művészet", slug: "muveszet" },
  Sports: { label: "Sport", slug: "sport" },
  Comedy: { label: "Humor", slug: "humor" },
  "True Crime & Paranormal": { label: "Bűnügyek és rejtélyek", slug: "true-crime" },
  "Kids & Family": { label: "Gyerek és család", slug: "gyerek" },
};

export function categoryLabel(category?: string | null): string | null {
  if (!category) return null;
  return CATEGORY_TO_HU[category]?.label || category;
}

export function categoryHref(category?: string | null): string {
  if (!category) return "/kategoriak";
  return `/kategoria/${CATEGORY_TO_HU[category]?.slug || slugify(category)}`;
}
