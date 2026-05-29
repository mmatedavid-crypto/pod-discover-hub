export type AuditEpisode = {
  id: string;
  title: string;
  description: string | null;
  clean_text_status: string;
  ai_entities_version: number;
  ai_summary: string | null;
  people: string[] | null;
  mentioned: string[] | null;
  companies: string[] | null;
  organizations: unknown;
  topics: string[] | null;
  tickers: string[] | null;
  published_at: string | null;
  podcasts?: {
    title?: string | null;
    display_title?: string | null;
    shadow_rank_tier?: string | null;
  } | null;
  episode_clean_text?: {
    cleaned_text?: string | null;
    cleaner_method?: string | null;
    removed_categories?: string[] | null;
    updated_at?: string | null;
  }[] | { cleaned_text?: string | null; cleaner_method?: string | null; removed_categories?: string[] | null; updated_at?: string | null } | null;
};

export type EpisodeAuditScore = {
  id: string;
  title: string;
  podcastTitle: string;
  publishedAt: string | null;
  rawLength: number;
  cleanLength: number;
  retentionRatio: number | null;
  dirtySignals: string[];
  missingSignals: string[];
  entityCount: number;
  hasEmbedding: boolean;
  risk: "ok" | "watch" | "bad";
};

export type AuditSummary = {
  sampleSize: number;
  cleanDone: number;
  embedded: number;
  entityBackfilled: number;
  dirtyCleanText: number;
  overCleaned: number;
  underCleaned: number;
  noEntities: number;
  noSummary: number;
};

const SOCIAL_RX = /\b(instagram|insta|facebook|tiktok|youtube|spotify|apple podcasts?|patreon|discord|telegram|linkedin|twitter|x\.com|threads|whatsapp|rss)\b/i;
const CTA_RX = /\b(kövess|kövessetek|iratkozz|feliratkoz|hallgasd meg|támogasd|lájkold|oszd meg|subscribe|follow us|support us|listen on)\b/i;
const URL_RX = /https?:\/\/|www\./i;
const EMAIL_RX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function normalizeCleanJoin(row: AuditEpisode) {
  const value = row.episode_clean_text;
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function countOrganizations(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== "object") return 0;
  return Object.keys(value).length;
}

function countArray(value: string[] | null | undefined): number {
  return Array.isArray(value) ? value.filter(Boolean).length : 0;
}

export function scoreAuditEpisode(row: AuditEpisode, embeddedIds: Set<string>): EpisodeAuditScore {
  const cleanRow = normalizeCleanJoin(row);
  const raw = row.description || "";
  const clean = cleanRow?.cleaned_text || "";
  const rawLength = raw.trim().length;
  const cleanLength = clean.trim().length;
  const retentionRatio = rawLength > 0 ? cleanLength / rawLength : null;
  const dirtySignals: string[] = [];
  const missingSignals: string[] = [];

  if (URL_RX.test(clean)) dirtySignals.push("url");
  if (SOCIAL_RX.test(clean)) dirtySignals.push("social");
  if (CTA_RX.test(clean)) dirtySignals.push("cta");
  if (EMAIL_RX.test(clean)) dirtySignals.push("email");

  if (row.clean_text_status !== "done") missingSignals.push("clean_text");
  if (!embeddedIds.has(row.id)) missingSignals.push("embedding");
  if (!row.ai_summary) missingSignals.push("summary");
  if (row.ai_entities_version < 4) missingSignals.push("entity_v4");

  const entityCount =
    countArray(row.people) +
    countArray(row.mentioned) +
    countArray(row.companies) +
    countOrganizations(row.organizations) +
    countArray(row.topics) +
    countArray(row.tickers);

  if (entityCount === 0) missingSignals.push("entities");
  if (rawLength > 500 && cleanLength < 80) dirtySignals.push("overcleaned");
  if (rawLength > 500 && retentionRatio !== null && retentionRatio > 0.9 && (SOCIAL_RX.test(raw) || URL_RX.test(raw) || CTA_RX.test(raw))) {
    dirtySignals.push("undercleaned");
  }

  const bad = dirtySignals.includes("overcleaned") || dirtySignals.length >= 2 || missingSignals.includes("entities");
  const watch = dirtySignals.length > 0 || missingSignals.length > 1;

  return {
    id: row.id,
    title: row.title,
    podcastTitle: row.podcasts?.display_title || row.podcasts?.title || "Unknown podcast",
    publishedAt: row.published_at,
    rawLength,
    cleanLength,
    retentionRatio,
    dirtySignals,
    missingSignals,
    entityCount,
    hasEmbedding: embeddedIds.has(row.id),
    risk: bad ? "bad" : watch ? "watch" : "ok",
  };
}

export function summarizeAudit(scores: EpisodeAuditScore[]): AuditSummary {
  return {
    sampleSize: scores.length,
    cleanDone: scores.filter((s) => !s.missingSignals.includes("clean_text")).length,
    embedded: scores.filter((s) => s.hasEmbedding).length,
    entityBackfilled: scores.filter((s) => !s.missingSignals.includes("entity_v4")).length,
    dirtyCleanText: scores.filter((s) => s.dirtySignals.some((x) => ["url", "social", "cta", "email"].includes(x))).length,
    overCleaned: scores.filter((s) => s.dirtySignals.includes("overcleaned")).length,
    underCleaned: scores.filter((s) => s.dirtySignals.includes("undercleaned")).length,
    noEntities: scores.filter((s) => s.missingSignals.includes("entities")).length,
    noSummary: scores.filter((s) => s.missingSignals.includes("summary")).length,
  };
}

export function pct(n: number, d: number): string {
  if (!d) return "-";
  return `${Math.round((n / d) * 100)}%`;
}
