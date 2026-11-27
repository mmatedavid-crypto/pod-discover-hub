// Deterministic 10-show active title + latest episode trial.
// Shared between React (PodcastDetail) and crawler prerender for full parity.
// No global switch: ONLY the 10 explicit canonical slugs receive trial treatment.

export const ACTIVE_SHOW_TRIAL_SLUGS = [
  "ziccer-24-hu",
  "juhi-podcast-9ee9",
  "sajat-toke-podcast",
  "marko-es-barna-1",
  "nem-futball-calcio",
  "neked-ugatok",
  "sinoa-podcast",
  "filmklub-podcast",
  "csukas-meseradio",
  "friderikusz-podcast",
] as const;

// Fixed unchanged active HU canonical comparison/control shows (zero duplicate aliases, zero pilot overlap).
export const ACTIVE_SHOW_TRIAL_CONTROL_SLUGS = [
  "4th-long",
  "balazsek",
  "delelott-kossuth-radio",
  "felkelo",
  "kettes-szamrendszer",
  "nyilt-titok",
  "alapos-elemzo",
] as const;

// Explicitly excluded from active trial with documented reasons.
export const ACTIVE_SHOW_TRIAL_EXCLUDED_SLUGS: Record<string, string> = {
  ot: "last_episode_2026_05_27_inactive",
  "sajat-toke": "unmerged_alternate_edition_excluded",
};

const TRIAL_SET = new Set<string>(ACTIVE_SHOW_TRIAL_SLUGS);
const CONTROL_SET = new Set<string>(ACTIVE_SHOW_TRIAL_CONTROL_SLUGS);
const HU_MONTHS_SHORT = [
  "jan.", "febr.", "márc.", "ápr.", "máj.", "jún.",
  "júl.", "aug.", "szept.", "okt.", "nov.", "dec.",
];

export function isActiveShowTrialSlug(slug: string | null | undefined): boolean {
  return !!slug && TRIAL_SET.has(slug);
}

export type ShowTrialCohort = "pilot" | "control";

export function getShowTrialCohort(slug: string | null | undefined): ShowTrialCohort | null {
  if (!slug) return null;
  if (TRIAL_SET.has(slug)) return "pilot";
  if (CONTROL_SET.has(slug)) return "control";
  return null;
}

export function matchShowTrialLandingPath(
  pathname: string | null | undefined,
): { showSlug: string; cohort: ShowTrialCohort } | null {
  if (!pathname) return null;
  const clean = pathname.split("?")[0].split("#")[0].replace(/\/+$/, "");
  const m = clean.match(/^\/podcast\/([^/]+)$/);
  if (!m?.[1]) return null;
  const showSlug = m[1];
  const cohort = getShowTrialCohort(showSlug);
  return cohort ? { showSlug, cohort } : null;
}

export type ShowTrialPlaybackScope = {
  cohort: ShowTrialCohort;
  showSlug: string;
  landingPath: string;
  currentPath: string;
  directShowLanding: boolean;
};

export function resolveShowTrialPlaybackScope(input: {
  landingPath: string | null | undefined;
  currentPath: string | null | undefined;
  episodePodcastSlug?: string | null;
}): ShowTrialPlaybackScope | null {
  const landingPath = (input.landingPath || "").split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  const currentPath = (input.currentPath || "").split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
  const currentMatch = matchShowTrialLandingPath(currentPath);
  const landingMatch = matchShowTrialLandingPath(landingPath);

  if (currentMatch) {
    return {
      cohort: currentMatch.cohort,
      showSlug: currentMatch.showSlug,
      landingPath,
      currentPath,
      directShowLanding: landingMatch?.showSlug === currentMatch.showSlug,
    };
  }
  if (
    landingMatch &&
    (input.episodePodcastSlug === landingMatch.showSlug ||
      currentPath.startsWith(`/podcast/${landingMatch.showSlug}/`))
  ) {
    return {
      cohort: landingMatch.cohort,
      showSlug: landingMatch.showSlug,
      landingPath,
      currentPath,
      directShowLanding: true,
    };
  }
  return null;
}

export type TrialEpisodeInput = {
  id?: string | null;
  slug?: string | null;
  title?: string | null;
  display_title?: string | null;
  published_at?: string | null;
  is_prefetch_placeholder?: boolean | null;
  ai_summary?: string | null;
  summary?: string | null;
  description?: string | null;
  card_summary?: string | null;
  audio_url?: string | null;
  audio_health_status?: string | null;
  audio_manual_override?: string | null;
};

export type ActiveShowTrialCopy = {
  active: true;
  episode: TrialEpisodeInput;
  title: string;
  description: string;
  latestDateIso: string;
  latestDateLabel: string;
  latestHeadline: string;
  latestSummary: string;
  latestEpisodeUrl: string;
  latestEpisodeJsonLd: Record<string, unknown>;
};

export function formatHuShortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCFullYear()}. ${HU_MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}.`;
}

export function selectLatestReleasedPublicEpisode<T extends TrialEpisodeInput>(
  episodes: T[],
  nowMs = Date.now(),
): T | null {
  let best: T | null = null;
  let bestTs = -Infinity;
  for (const ep of episodes) {
    if (!ep?.slug || !(ep.display_title || ep.title) || !ep.published_at) continue;
    if (ep.is_prefetch_placeholder === true) continue;
    const ts = Date.parse(ep.published_at);
    if (!Number.isFinite(ts) || ts > nowMs) continue;
    if (ts > bestTs) {
      bestTs = ts;
      best = ep;
    }
  }
  return best;
}

function stripHtmlPlain(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function stripEmojis(s: string): string {
  return s
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeAllCapsLead(s: string): string {
  // Turn shouting leading clauses like "EGY HUSZONÉVES CSILLAGÁSZ: Szabó Norton..."
  // into readable sentence case without touching short acronyms like "AGI" or "FLEX".
  return s.replace(/^([A-ZÁÉÍÓÖŐÚÜŰ0-9,\- ]{12,}):\s*/, (_m, lead: string) => {
    const trimmed = lead.trim();
    if (trimmed !== trimmed.toLocaleUpperCase("hu-HU")) return _m;
    const lower = trimmed
      .toLocaleLowerCase("hu-HU")
      .replace(/\bs(\d+)e(\d+)\b/g, "S$1E$2");
    return `${lower.charAt(0).toLocaleUpperCase("hu-HU")}${lower.slice(1)}: `;
  });
}

export function cleanLatestEpisodeTopic(rawTitle: string, showTitle: string): string {
  let t = stripEmojis(stripHtmlPlain(rawTitle));
  if (!t) return "";

  // Build candidate show-name variants to strip duplicate prefixes/suffixes
  const showClean = stripHtmlPlain(showTitle);
  const showBase = showClean
    .replace(/\s*\bpodcast\b\s*/gi, " ")
    .replace(/\s*[-–—|:]\s*\d+\.hu$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  const variants = [...new Set([showClean, showBase].filter((v) => v.length >= 3))]
    .sort((a, b) => b.length - a.length);

  for (const v of variants) {
    const ev = escapeRegExp(v);
    // Trailing "/// Friderikusz Podcast 154." or "| Saját Tőke" or "- Show Name"
    t = t.replace(new RegExp(`\\s*(?:\\/{2,}|\\||[-–—])\\s*${ev}(?:\\s*#?\\d+\\.?)?\\s*$`, "i"), "").trim();
    // Leading "JUHI x " or "Show Name: "
    t = t.replace(new RegExp(`^${ev}\\s*(?:[:\\-|–—]|x\\s+)\\s*`, "i"), "").trim();
  }

  // Clean common noisy episode decorations without deleting real topic words
  t = t
    .replace(/\s*\|\s*(?:RÖVID VÁLTOZAT\s*)?#\d+\s*$/i, "")
    .replace(/\s*\|\s*#\d+\s*$/i, "")
    .replace(/:\s*[-–—]\s*/g, " – ")
    .replace(/\s+[-–—]\s+/g, " – ")
    .replace(/\s+/g, " ")
    .trim();

  t = normalizeAllCapsLead(t);
  return t || stripEmojis(stripHtmlPlain(rawTitle));
}

function truncateWordSafe(text: string, maxLen: number): string {
  const s = text.replace(/\s+/g, " ").trim();
  if (s.length <= maxLen) return s;
  const cut = s.slice(0, Math.max(12, maxLen - 1));
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace >= Math.floor(maxLen * 0.55) ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[,;:\-–—/|]+$/, "").trim()}…`;
}

function firstCleanSentence(raw: string | null | undefined, maxLen: number): string {
  const text = stripHtmlPlain(raw);
  if (!text) return "";
  const m = text.match(/^(.{35,220}?[.!?])(?:\s|$)/);
  const candidate = m?.[1]?.trim() || text;
  return truncateWordSafe(candidate, maxLen);
}

const MAX_TRIAL_TITLE_LENGTH = 105;

const TRAILING_DANGLING_WORDS = new Set([
  "a", "az", "egy", "és", "is", "de", "vagy", "hogy", "mert", "míg", "ha",
  "mint", "szerint", "mellett", "után", "előtt", "alatt", "felett", "miatt",
  "ellen", "között", "kapcsán", "témában", "arról", "erről", "valamint",
  "beszélgetés", "interjú", "vendég", "vendége", "adás", "rész", "epizód",
]);

const COMPLETE_PHRASE_SUFFIX_RE = /(?:vel|val|ról|ről|ban|ben|tól|től|nál|nél|nak|nek|hoz|hez|höz|[.!?])$/i;

function stripTrailingDanglingWords(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  while (
    words.length > 2 &&
    TRAILING_DANGLING_WORDS.has(
      words[words.length - 1].toLocaleLowerCase("hu-HU").replace(/[,;:\-–—/|"'„”»()]+$/g, ""),
    )
  ) {
    words.pop();
  }
  return words.join(" ").replace(/[,;:\-–—/|]+$/, "").trim();
}

function isCleanPhraseEnding(candidate: string): boolean {
  const clean = candidate.replace(/[,;:\-–—/|]+$/, "").trim();
  if (!clean) return false;
  const words = clean.split(/\s+/);
  const last = words[words.length - 1]?.toLocaleLowerCase("hu-HU").replace(/[,;:\-–—/|"'„”»()]+$/g, "") || "";
  return Boolean(last) && !TRAILING_DANGLING_WORDS.has(last);
}

export function fitNaturalTrialHeadline(text: string, maxLen: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;

  const minKeep = Math.max(18, Math.floor(maxLen * 0.45));
  const candidates: number[] = [];

  // 1. Prefer clear clause boundaries (dash, pipe, semicolon, comma, " és ")
  const clauseRe = /(?:\s+[–—|]\s+|;\s+|,\s+|\s+és\s+)/gi;
  let m: RegExpExecArray | null;
  while ((m = clauseRe.exec(clean)) !== null) {
    const end = m.index;
    if (end > maxLen) break;
    if (end >= minKeep && end <= maxLen && isCleanPhraseEnding(clean.slice(0, end))) {
      candidates.push(end);
    }
  }

  // 2. Allow cutting before a prepositional/topic clause (" az " / " a ") ONLY when the
  //    preceding token completes an inflected speaker/topic phrase (e.g. "...AI-szakértővel"),
  //    never mid-predicate before its required object.
  const prepRe = /\s+(?:az|a)\s+/gi;
  while ((m = prepRe.exec(clean)) !== null) {
    const end = m.index;
    if (end > maxLen) break;
    if (end < minKeep) continue;
    const left = clean.slice(0, end).trim();
    const lastWord = left.split(/\s+/).pop() || "";
    if (isCleanPhraseEnding(left) && COMPLETE_PHRASE_SUFFIX_RE.test(lastWord)) {
      candidates.push(end);
    }
  }

  // 3. Complete earlier sentence boundaries ([.!?] followed by space)
  const sentRe = /[.!?](?=\s)/g;
  let lastSentenceEnd = -1;
  while ((m = sentRe.exec(clean)) !== null) {
    const end = m.index + 1;
    if (end > maxLen) break;
    if (end >= 15 && end <= maxLen) {
      lastSentenceEnd = end;
      if (end >= minKeep) candidates.push(end);
    }
  }

  if (candidates.length > 0) {
    const bestEnd = Math.max(...candidates);
    return clean.slice(0, bestEnd).replace(/[,;:\-–—/|]+$/, "").trim();
  }

  // If an earlier complete sentence ended (e.g. "Mennyire közel az AGI?") and the following
  // clause could not fit cleanly, stop at the sentence end instead of keeping "? Beszélgetés".
  if (lastSentenceEnd >= 15) {
    return clean.slice(0, lastSentenceEnd).trim();
  }

  // Word-safe fallback with dangling-word cleanup
  const cut = clean.slice(0, maxLen);
  const sp = cut.lastIndexOf(" ");
  const head = (sp > maxLen * 0.55 ? cut.slice(0, sp) : cut).replace(/[,;:\-–—/|]+$/, "").trim();
  return stripTrailingDanglingWords(head);
}

function endWithSentencePunctuation(s: string): string {
  const clean = s.trim();
  if (!clean) return "";
  return /[.!?…]["”»)]*$/.test(clean) ? clean : `${clean}.`;
}

export function formatActiveShowTrial(input: {
  podcastSlug: string;
  podcastTitle: string;
  totalEpisodes: number;
  episodes: TrialEpisodeInput[];
  site?: string;
  nowMs?: number;
}): ActiveShowTrialCopy | null {
  if (!isActiveShowTrialSlug(input.podcastSlug)) return null;
  const latest = selectLatestReleasedPublicEpisode(input.episodes, input.nowMs);
  if (!latest || !latest.slug || !latest.published_at) return null;

  const site = (input.site || "https://podiverzum.hu").replace(/\/+$/, "");
  const showName = stripHtmlPlain(input.podcastTitle);
  const rawEpTitle = stripHtmlPlain(latest.display_title || latest.title || "");
  if (!showName || !rawEpTitle) return null;

  const latestDateLabel = formatHuShortDate(latest.published_at);
  if (!latestDateLabel) return null;

  const latestHeadline = cleanLatestEpisodeTopic(rawEpTitle, showName);
  const latestSummary = firstCleanSentence(
    latest.card_summary || latest.ai_summary || latest.summary || latest.description,
    170,
  );

  // Natural human Hungarian <title>: preserve complete episode titles up to 105 chars;
  // for longer titles cut only at clear clause/sentence boundaries (never leaving a dangling object or opener).
  const brandSuffix = " | Podiverzum";
  const separator = /[!?]$/.test(showName) || latestHeadline.includes(": ") ? " – " : ": ";
  const titleBudget = Math.max(40, MAX_TRIAL_TITLE_LENGTH - showName.length - separator.length - brandSuffix.length);
  const shortTopic = fitNaturalTrialHeadline(latestHeadline, titleBudget);
  const title = `${showName}${separator}${shortTopic}${brandSuffix}`;

  // Grounded human Hungarian meta description (<= 160 chars, no promo, no duplicated show name)
  const epCountLabel = input.totalEpisodes > 0 ? ` (${input.totalEpisodes} epizód)` : "";
  const lead = `${showName}${epCountLabel}. Legutóbbi adás (${latestDateLabel}): ${endWithSentencePunctuation(latestHeadline)}`;
  let description = lead;
  if (latestSummary && lead.length < 120) {
    const summaryStartsWithShow = latestSummary.toLocaleLowerCase("hu-HU").startsWith(showName.toLocaleLowerCase("hu-HU"));
    const summaryClause = summaryStartsWithShow ? "" : latestSummary;
    if (summaryClause) {
      description = `${lead} ${summaryClause}`;
    }
  }
  description = truncateWordSafe(description, 160);

  const latestEpisodeUrl = `${site}/podcast/${input.podcastSlug}/${latest.slug}`;
  const latestEpisodeJsonLd: Record<string, unknown> = {
    "@type": "PodcastEpisode",
    name: rawEpTitle,
    url: latestEpisodeUrl,
    datePublished: latest.published_at,
    ...(latestSummary ? { description: latestSummary } : {}),
  };

  return {
    active: true,
    episode: latest,
    title,
    description,
    latestDateIso: latest.published_at,
    latestDateLabel,
    latestHeadline,
    latestSummary,
    latestEpisodeUrl,
    latestEpisodeJsonLd,
  };
}