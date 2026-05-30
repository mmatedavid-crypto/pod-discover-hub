import { slugify } from "./slug";

export type EntityKind = "topic" | "person" | "company" | "ticker" | "ingredient";

export const ENTITY_COLUMN: Record<EntityKind, "topics" | "people" | "companies" | "tickers" | "ingredients"> = {
  topic: "topics",
  person: "people",
  company: "companies",
  ticker: "tickers",
  ingredient: "ingredients",
};

export const ENTITY_LABEL: Record<EntityKind, string> = {
  topic: "Téma",
  person: "Személy",
  company: "Szervezet",
  ticker: "Részvény",
  ingredient: "Hozzávaló",
};

function norm(v: string) {
  return v.trim().toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

const TOPIC_ALIASES: Record<string, string> = {
  labdarugas: "Labdarúgás",
  foci: "Labdarúgás",
  futball: "Labdarúgás",
  football: "Labdarúgás",
  soccer: "Labdarúgás",
  ai: "Mesterséges intelligencia",
  mi: "Mesterséges intelligencia",
  "artificial intelligence": "Mesterséges intelligencia",
  "mesterseges intelligencia": "Mesterséges intelligencia",
  kozelet: "Közélet",
  "koz elet": "Közélet",
  politika: "Magyar politika",
  politikai: "Magyar politika",
  gazdasag: "Gazdaság",
  uzlet: "Vállalkozás",
  business: "Vállalkozás",
  penzugy: "Pénzügy",
  befektetes: "Befektetés",
  egeszseg: "Egészség",
  "mentalis egeszseg": "Mentális egészség",
  pszichologia: "Pszichológia",
  parkapcsolat: "Párkapcsolat",
  kapcsolatok: "Párkapcsolat",
  onfejlesztes: "Önismeret",
  "self improvement": "Önismeret",
  technologia: "Technológia",
  tech: "Technológia",
  tortenelem: "Történelem",
  historia: "Történelem",
  kultura: "Magyar kultúra",
  muveszet: "Magyar kultúra",
  vallas: "Vallás",
  spiritualitas: "Spiritualitás",
  oktatas: "Oktatás",
  edukacio: "Oktatás",
};

export function canonicalEntityValue(kind: EntityKind, value: string): string {
  if (kind !== "topic") return value.trim();
  return TOPIC_ALIASES[norm(value)] || value.trim();
}

export function entitySlug(kind: EntityKind, value: string): string {
  if (kind === "ticker") return value.replace(/[^a-zA-Z0-9.]+/g, "").toUpperCase();
  return slugify(canonicalEntityValue(kind, value));
}

export function entityHref(kind: EntityKind, value: string): string {
  const route =
    kind === "topic" ? "tema" :
    kind === "person" ? "szemelyek" :
    kind === "company" ? "ceg" :
    kind === "ingredient" ? "hozzavalo" :
    "ticker";
  return `/${route}/${encodeURIComponent(entitySlug(kind, value))}`;
}

// Match against a candidate value (case-insensitive slug for most kinds; symbol for ticker)
export function matchesEntitySlug(kind: EntityKind, value: string, slug: string): boolean {
  if (!value) return false;
  if (kind === "ticker") return value.replace(/[^a-zA-Z0-9.]+/g, "").toUpperCase() === slug.toUpperCase();
  return slugify(canonicalEntityValue(kind, value)) === slug.toLowerCase();
}
