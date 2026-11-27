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

// Unchanged active HU canonical control shows (zero duplicate aliases, zero pilot overlap).
export const ACTIVE_SHOW_TRIAL_CONTROL_SLUGS = [
  "nyilt-titok",
  "alapos-elemzo",
  "4th-long",
  "delelott-kossuth-radio",
  "felkelo",
  "balazsek",
  "portfolio-checklist",
  "telex-after",
  "szelsokozep",
  "partizan-podcast",
] as const;

// Explicitly excluded from active trial with documented reasons.
export const ACTIVE_SHOW_TRIAL_EXCLUDED_SLUGS: Record<string, string> = {
  ot: "last_episode_2026_05_27_inactive",
  "sajat-toke": "unmerged_alternate_edition_excluded",
};

const TRIAL_SET = new Set<string>(ACTIVE_SHOW_TRIAL_SLUGS);
const HU_MONTHS_SHORT = [
  "jan.", "febr.", "márc.", "ápr.", "máj.", "jún.",
  "júl.", "aug.", "szept.", "okt.", "nov.", "dec.",
];

export function isActiveShowTrialSlug(slug: string | null | undefined): boolean {
  return !!slug && TRIAL_SET.has(slug);
}

export type TrialEpisodeInput = {
  id?: string | null;
  slug?: string | null;
  title?: string | null;
  display_title?: string | null;
  published_at?: string | null;
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
    const ts = Date.parse(ep.published_at);
    if (!Number.isFinite(ts) || ts > nowMs + 60_000) continue;
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
    const lower = trimmed.toLocaleLowerCase("hu-HU");
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

const TRAILING_DANGLING_WORDS = new Set([
  "a", "az", "egy", "és", "is", "de", "vagy", "hogy", "mert", "míg", "ha",
  "mint", "szerint", "mellett", "után", "előtt", "alatt", "felett", "beszélgetés",
]);

function endWithSentencePunctuation(s: string): string {
  const clean = s.trim();
  if (!clean) return "";
  return /[.!?…]$/.test(clean) ? clean : `${clean}.`;
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

  // Concise human Hungarian <title>: "<Show>: <Latest topic> | Podiverzum" (word-safe, no ellipsis)
  const brandSuffix = " | Podiverzum";
  const titleBudget = Math.max(22, 66 - showName.length - brandSuffix.length - 2);
  const cutCleanWord = (text: string, max: number) => {
    const clean = text.replace(/\s+/g, " ").trim();
    if (clean.length <= max) return clean;
    const cut = clean.slice(0, max);
    const sp = cut.lastIndexOf(" ");
    let head = (sp > max * 0.55 ? cut.slice(0, sp) : cut).replace(/[,;:\-–—/|]+$/, "").trim();
    // If a complete question/exclamation ended earlier in the slice, prefer stopping there
    // instead of keeping an unfinished trailing fragment like "Mennyire közel az AGI? Beszélgetés".
    const sentenceEnd = head.match(/^(.{12,}[?!])\s+\S+$/);
    if (sentenceEnd?.[1]) return sentenceEnd[1].trim();
    const words = head.split(/\s+/);
    while (words.length > 2 && TRAILING_DANGLING_WORDS.has(words[words.length - 1].toLocaleLowerCase("hu-HU").replace(/[,;:\-–—/|]+$/, ""))) {
      words.pop();
    }
    return words.join(" ").replace(/[,;:\-–—/|]+$/, "").trim();
  };
  const shortTopic = cutCleanWord(latestHeadline, titleBudget);
  const title = `${showName}: ${shortTopic}${brandSuffix}`;

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