type EpisodeUnderstandingSource = {
  ai_summary?: string | null;
  summary?: string | null;
  description?: string | null;
  topics?: string[] | null;
  people?: string[] | null;
  mentioned?: string[] | null;
  companies?: string[] | null;
  organizations?: string[] | null;
  tickers?: string[] | null;
  ingredients?: string[] | null;
};

export type UnderstandingChip = {
  kind: "topic" | "person" | "company" | "ticker" | "ingredient";
  label: string;
};

export type EpisodeUnderstanding = {
  confidence: "strong" | "medium" | "light";
  headline: string;
  chips: UnderstandingChip[];
  signalCount: number;
};

function takeClean(values: Array<string | null | undefined>, max: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const v = String(value || "").replace(/\s+/g, " ").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function arr(value: string[] | null | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

export function getEpisodeUnderstanding(e: EpisodeUnderstandingSource): EpisodeUnderstanding | null {
  const topics = takeClean(arr(e.topics), 4);
  const people = takeClean([...arr(e.people), ...arr(e.mentioned)], 3);
  const companies = takeClean([...arr(e.companies), ...arr(e.organizations)], 3);
  const tickers = takeClean(arr(e.tickers), 2);
  const ingredients = takeClean(arr(e.ingredients), 2);
  const summaryLen = String(e.ai_summary || e.summary || "").trim().length;
  const descriptionLen = String(e.description || "").trim().length;

  const chips: UnderstandingChip[] = [
    ...topics.map((label) => ({ kind: "topic" as const, label })),
    ...people.map((label) => ({ kind: "person" as const, label })),
    ...companies.map((label) => ({ kind: "company" as const, label })),
    ...tickers.map((label) => ({ kind: "ticker" as const, label })),
    ...ingredients.map((label) => ({ kind: "ingredient" as const, label })),
  ].slice(0, 8);

  const signalCount = chips.length + (summaryLen >= 80 ? 2 : summaryLen >= 30 ? 1 : 0) + (descriptionLen >= 300 ? 1 : 0);
  if (signalCount < 2) return null;

  const leadParts = [
    topics[0],
    people[0],
    companies[0],
  ].filter(Boolean);

  const headline = leadParts.length
    ? leadParts.slice(0, 3).join(" · ")
    : chips.slice(0, 3).map((chip) => chip.label).join(" · ");

  return {
    confidence: signalCount >= 7 ? "strong" : signalCount >= 4 ? "medium" : "light",
    headline,
    chips,
    signalCount,
  };
}
