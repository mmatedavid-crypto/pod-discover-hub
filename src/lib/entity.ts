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
  topic: "Topic",
  person: "Person",
  company: "Company",
  ticker: "Ticker",
  ingredient: "Ingredient",
};

export function entitySlug(kind: EntityKind, value: string): string {
  if (kind === "ticker") return value.replace(/[^a-zA-Z0-9.]+/g, "").toUpperCase();
  return slugify(value);
}

export function entityHref(kind: EntityKind, value: string): string {
  return `/${kind === "ticker" ? "ticker" : kind}/${encodeURIComponent(entitySlug(kind, value))}`;
}

// Match against a candidate value (case-insensitive slug for most kinds; symbol for ticker)
export function matchesEntitySlug(kind: EntityKind, value: string, slug: string): boolean {
  if (!value) return false;
  if (kind === "ticker") return value.replace(/[^a-zA-Z0-9.]+/g, "").toUpperCase() === slug.toUpperCase();
  return slugify(value) === slug.toLowerCase();
}
