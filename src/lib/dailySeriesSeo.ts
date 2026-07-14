// Daily numbered series SEO booster.
// Some podcasts publish a new episode every day with a "N. nap:" pattern (e.g. Fábry Kornél
// püspök atya "Biblia egy év alatt"). Users search "<host> <N>" or "<host> <N>. nap" —
// so we bake the host name + day number into the <title> and meta description on every
// episode so we can rank #1 on those long-tail queries the day the episode drops.

type DailySeriesConfig = {
  /** Match the podcast this booster applies to. */
  match: (podcastSlug: string, podcastTitle: string) => boolean;
  /** How to render the host in the title (e.g. "Fábry Kornél"). */
  hostName: string;
  /** Short series label used after the em-dash. */
  seriesShortName: string;
  /** Description shown while the audio is already live. Action-oriented copy that reads
   *  well as a Google snippet — starts with a "play" affordance so the user knows they
   *  can listen right now with one tap. `{n}` = day number, `{rest}` = title tail. */
  descriptionLive?: string;
  /** Description shown for a prefetch placeholder (audio hasn't arrived from RSS yet).
   *  Tells the searcher exactly when it'll go live and that they can bookmark now. */
  descriptionPlaceholder?: string;
};

const CONFIGS: DailySeriesConfig[] = [
  {
    match: (slug) => slug === "biblia-egy-ev-alatt-podcast-fabry-kornel-puspok-atyaval",
    hostName: "Fábry Kornél",
    seriesShortName: "Biblia egy év alatt",
    descriptionLive:
      "▶ Hallgasd most: Fábry Kornél {n}. nap – {rest}. Egy kattintás és indul a Biblia egy év alatt új epizódja a Podiverzumon.",
    descriptionPlaceholder:
      "▶ Fábry Kornél {n}. nap – ma este 01:00-kor érkezik az új Biblia egy év alatt epizód. Nyisd meg most és hallgasd, amint elindul.",
  },
];

// "185. nap: Hiszkija imája" → { day: "185", rest: "Hiszkija imája" }
const DAY_RE = /^\s*(\d{1,3})\.\s*nap\s*[:\-–—]?\s*/i;

export type DailySeriesSeo = {
  title: string;
  description: string;
  headline: string;
  dayNumber: string;
  hostName: string;
  seriesShortName: string;
  keywords: string[];
};

export function dailySeriesSeo(
  podcastSlug: string | undefined | null,
  podcastTitle: string | undefined | null,
  episodeTitle: string | undefined | null,
  opts: { isPlaceholder?: boolean } = {},
): DailySeriesSeo | null {
  if (!podcastSlug || !episodeTitle) return null;
  const cfg = CONFIGS.find((c) => c.match(podcastSlug, podcastTitle || ""));
  if (!cfg) return null;
  const m = episodeTitle.match(DAY_RE);
  if (!m) return null;
  const day = m[1];
  const rest = episodeTitle.replace(DAY_RE, "").trim() || cfg.seriesShortName;

  const headline = `${cfg.hostName} ${day}. nap: ${rest}`;
  const title = opts.isPlaceholder
    ? `${cfg.hostName} ${day}. nap – ma este 01:00-kor | ${cfg.seriesShortName}`
    : `${headline} — ${cfg.seriesShortName} | Podiverzum`;
  const template = opts.isPlaceholder
    ? (cfg.descriptionPlaceholder || cfg.descriptionLive || "")
    : (cfg.descriptionLive || "");
  const description = template
    .replace(/\{host\}/g, cfg.hostName)
    .replace(/\{n\}/g, day)
    .replace(/\{rest\}/g, rest)
    .replace(/\{series\}/g, cfg.seriesShortName)
    .slice(0, 160);

  return {
    title,
    description,
    headline,
    dayNumber: day,
    hostName: cfg.hostName,
    seriesShortName: cfg.seriesShortName,
    keywords: [
      `${cfg.hostName} ${day}`,
      `${cfg.hostName} ${day}. nap`,
      `${cfg.seriesShortName} ${day}. nap`,
      `${cfg.seriesShortName} ${day}`,
      cfg.hostName,
      cfg.seriesShortName,
    ],
  };
}
