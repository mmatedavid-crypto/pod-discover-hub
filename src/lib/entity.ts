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
  focis: "Labdarúgás",
  "magyar foci": "Labdarúgás",
  "magyar futball": "Labdarúgás",
  "nb i": "Labdarúgás",
  nbi: "Labdarúgás",
  football: "Labdarúgás",
  soccer: "Labdarúgás",
  kosar: "Kosárlabda",
  kosarlabda: "Kosárlabda",
  ai: "Mesterséges intelligencia",
  mi: "Mesterséges intelligencia",
  genai: "Mesterséges intelligencia",
  chatgpt: "Mesterséges intelligencia",
  llm: "Mesterséges intelligencia",
  "generativ ai": "Mesterséges intelligencia",
  "artificial intelligence": "Mesterséges intelligencia",
  "mesterseges intelligencia": "Mesterséges intelligencia",
  "gepi tanulas": "Mesterséges intelligencia",
  kozelet: "Közélet",
  "koz elet": "Közélet",
  kozugyek: "Közélet",
  politika: "Magyar politika",
  politikai: "Magyar politika",
  belpolitika: "Magyar politika",
  parlament: "Magyar politika",
  kulpolitika: "Külpolitika",
  eu: "Európai Unió",
  "europai unio": "Európai Unió",
  valasztas: "Választás",
  valasztasok: "Választás",
  haboru: "Háború",
  "ukrajnai haboru": "Háború",
  gazdasag: "Gazdaság",
  makro: "Makrogazdaság",
  makrogazdasag: "Makrogazdaság",
  uzlet: "Vállalkozás",
  business: "Vállalkozás",
  vallalkozas: "Vállalkozás",
  cegepites: "Cégépítés",
  startup: "Startup",
  penzugy: "Pénzügy",
  penzugyek: "Pénzügy",
  befektetes: "Befektetés",
  befektetesek: "Befektetés",
  tozsde: "Tőzsde",
  reszveny: "Tőzsde",
  reszvenyek: "Tőzsde",
  inflacio: "Infláció",
  dragulas: "Infláció",
  ingatlan: "Ingatlan",
  lakaspiac: "Ingatlan",
  egeszseg: "Egészség",
  egeszsegugy: "Egészség",
  eletmod: "Egészséges életmód",
  etrend: "Táplálkozás",
  dieta: "Táplálkozás",
  alvas: "Alvás",
  "mentalis egeszseg": "Mentális egészség",
  "lelki egeszseg": "Mentális egészség",
  szorongas: "Mentális egészség",
  pszichologia: "Pszichológia",
  pszicho: "Pszichológia",
  lelektan: "Pszichológia",
  parkapcsolat: "Párkapcsolat",
  kapcsolat: "Párkapcsolat",
  kapcsolatok: "Párkapcsolat",
  gyerekneveles: "Gyereknevelés",
  gyermekneveles: "Gyereknevelés",
  szuloseg: "Gyereknevelés",
  csalad: "Család",
  onfejlesztes: "Önismeret",
  onismeret: "Önismeret",
  szemelyisegfejlesztes: "Önismeret",
  "self improvement": "Önismeret",
  technologia: "Technológia",
  tech: "Technológia",
  it: "Technológia",
  digitalizacio: "Digitalizáció",
  kiberbiztonsag: "Kiberbiztonság",
  cybersecurity: "Kiberbiztonság",
  programozas: "Szoftverfejlesztés",
  tortenelem: "Történelem",
  historia: "Történelem",
  kultura: "Magyar kultúra",
  muveszet: "Magyar kultúra",
  film: "Film",
  mozi: "Film",
  zene: "Zene",
  konyvek: "Könyvek",
  irodalom: "Könyvek",
  sajto: "Média",
  media: "Média",
  tudomany: "Tudomány",
  vallas: "Vallás",
  hit: "Vallás",
  keresztenyseg: "Kereszténység",
  kereszteny: "Kereszténység",
  biblia: "Biblia",
  szentiras: "Biblia",
  spiritualitas: "Spiritualitás",
  spiritualis: "Spiritualitás",
  meditacio: "Meditáció",
  mindfulness: "Meditáció",
  oktatas: "Oktatás",
  edukacio: "Oktatás",
  tanulas: "Tanulás",
  tarsadalom: "Társadalom",
  bunugy: "Bűnügy",
  "true crime": "True crime",
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
    kind === "topic" ? "temak" :
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
