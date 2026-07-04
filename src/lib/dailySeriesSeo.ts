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
  /** Optional description template (`{n}` = day number, `{rest}` = title without the "N. nap:" prefix, `{host}` = host name). */
  descriptionTemplate?: string;
};

const CONFIGS: DailySeriesConfig[] = [
  {
    match: (slug) => slug === "biblia-egy-ev-alatt-podcast-fabry-kornel-puspok-atyaval",
    hostName: "Fábry Kornél",
    seriesShortName: "Biblia egy év alatt",
    descriptionTemplate:
      "Fábry Kornél püspök atya {n}. napi elmélkedése – {rest}. Hallgasd a Biblia egy év alatt podcast {n}. napi részét a Podiverzumon.",
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
): DailySeriesSeo | null {
  if (!podcastSlug || !episodeTitle) return null;
  const cfg = CONFIGS.find((c) => c.match(podcastSlug, podcastTitle || ""));
  if (!cfg) return null;
  const m = episodeTitle.match(DAY_RE);
  if (!m) return null;
  const day = m[1];
  const rest = episodeTitle.replace(DAY_RE, "").trim() || cfg.seriesShortName;

  const headline = `${cfg.hostName} ${day}. nap: ${rest}`;
  const title = `${headline} — ${cfg.seriesShortName} | Podiverzum`;
  const description = (cfg.descriptionTemplate || "{host} {n}. napi epizódja – {rest}. Hallgasd a {series} podcastot a Podiverzumon.")
    .replaceAll("{host}", cfg.hostName)
    .replaceAll("{n}", day)
    .replaceAll("{rest}", rest)
    .replaceAll("{series}", cfg.seriesShortName)
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
