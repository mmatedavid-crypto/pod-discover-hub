import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  normalizeFeedUrlConservative,
  normalizeFeedUrlForLookup,
} from "../../supabase/functions/_shared/rss-url-normalize";
import {
  ANNUAL_ARCHIVE_PAGE_SIZE,
  buildArchivePaginationMeta,
  formatAnnualArchiveCopy,
  parseStrictArchivePage,
  parseStrictArchiveYear,
  podcastYearArchivePath,
} from "../../supabase/functions/_shared/podcast-annual-archive";
import {
  ACTIVE_SHOW_TRIAL_CONTROL_SLUGS,
  ACTIVE_SHOW_TRIAL_EXCLUDED_SLUGS,
  ACTIVE_SHOW_TRIAL_SLUGS,
  cleanLatestEpisodeTopic,
  formatActiveShowTrial,
  isActiveShowTrialSlug,
  selectLatestReleasedPublicEpisode,
} from "../../supabase/functions/_shared/podcast-active-trial";

describe("Task 1: Conservative RSS URL normalization & Worker sync", () => {
  it("strips trailing %20 and whitespace without altering distinct paths or queries", () => {
    expect(normalizeFeedUrlConservative("https://feeds.megaphone.fm/markoesbarna%20")).toBe(
      "https://feeds.megaphone.fm/markoesbarna",
    );
    expect(normalizeFeedUrlConservative("  https://example.hu/feed.xml%20%09  ")).toBe(
      "https://example.hu/feed.xml",
    );
    expect(normalizeFeedUrlForLookup("http://www.feeds.megaphone.fm/markoesbarna%20?utm_source=x")).toBe(
      "https://feeds.megaphone.fm/markoesbarna",
    );
    expect(normalizeFeedUrlForLookup("https://example.hu/feed?id=1")).not.toBe(
      normalizeFeedUrlForLookup("https://example.hu/feed?id=2"),
    );
  });

  it("keeps infra and .lovable Cloudflare Workers byte-identical with 22 verified aliases", () => {
    const infra = fs.readFileSync(path.resolve("infra/cloudflare-worker/worker.js"), "utf8");
    const lov = fs.readFileSync(path.resolve(".lovable/cloudflare-worker.js"), "utf8");
    expect(infra).toBe(lov);
    expect(infra).toContain('"marko-es-barna": "marko-es-barna-1"');
    expect(infra).toContain('"juhi-podcast": "juhi-podcast-9ee9"');
    expect(infra).not.toContain('"sajat-toke":');
    expect(infra).toContain("epizodok\\/\\d{4}(?:\\/oldal\\/[^/]+)?");
    expect(infra).toContain("20261127-archive-paginated");
    expect(infra).toContain("20261127-active-show-trial");
  });
});

describe("Task 2: Paginated annual archive rules (no 200 cap)", () => {
  it("strictly validates years and page numbers", () => {
    expect(parseStrictArchiveYear("2026")).toBe(2026);
    expect(parseStrictArchiveYear("1999")).toBeNull();
    expect(parseStrictArchiveYear("2026a")).toBeNull();
    expect(parseStrictArchivePage("1")).toBe(1);
    expect(parseStrictArchivePage("9")).toBe(9);
    expect(parseStrictArchivePage("0")).toBeNull();
    expect(parseStrictArchivePage("01")).toBeNull();
    expect(parseStrictArchivePage("-2")).toBeNull();
    expect(parseStrictArchivePage("abc")).toBeNull();
  });

  it("computes exact Balázsék 2026 (869 -> 9 pages) and Szélsőközép 2025 (464 -> 5 pages) pagination", () => {
    expect(ANNUAL_ARCHIVE_PAGE_SIZE).toBe(100);
    const b1 = buildArchivePaginationMeta("balazsek", 2026, 1, 869);
    expect(b1.totalPages).toBe(9);
    expect(b1.prevPath).toBeNull();
    expect(b1.nextPath).toBe("/podcast/balazsek/epizodok/2026/oldal/2");
    expect(b1.startIndex).toBe(1);
    expect(b1.endIndex).toBe(100);

    const b9 = buildArchivePaginationMeta("balazsek", 2026, 9, 869);
    expect(b9.prevPath).toBe("/podcast/balazsek/epizodok/2026/oldal/8");
    expect(b9.nextPath).toBeNull();
    expect(b9.startIndex).toBe(801);
    expect(b9.endIndex).toBe(869);

    const s5 = buildArchivePaginationMeta("szelsokozep", 2025, 5, 464);
    expect(s5.totalPages).toBe(5);
    expect(s5.startIndex).toBe(401);
    expect(s5.endIndex).toBe(464);
    expect(podcastYearArchivePath("szelsokozep", 2025, 1)).toBe("/podcast/szelsokozep/epizodok/2025");
    expect(podcastYearArchivePath("szelsokozep", 2025, 2)).toBe("/podcast/szelsokozep/epizodok/2025/oldal/2");

    const copy = formatAnnualArchiveCopy({
      podcastTitle: "Balázsék",
      year: 2026,
      page: 9,
      totalCount: 869,
      totalPages: 9,
      startIndex: 801,
      endIndex: 869,
    });
    expect(copy.title).toContain("869 epizód");
    expect(copy.title).toContain("9/9. oldal");
  });
});

describe("Task 3: 10-show active title + latest episode trial", () => {
  it("enforces exact 10 canonical trial shows, zero control overlap, and excludes Öt & aliases", () => {
    expect(ACTIVE_SHOW_TRIAL_SLUGS).toHaveLength(10);
    expect(isActiveShowTrialSlug("friderikusz-podcast")).toBe(true);
    expect(isActiveShowTrialSlug("sajat-toke-podcast")).toBe(true);
    expect(isActiveShowTrialSlug("sajat-toke")).toBe(false);
    expect(isActiveShowTrialSlug("ot")).toBe(false);
    expect(isActiveShowTrialSlug("marko-es-barna")).toBe(false);
    expect(isActiveShowTrialSlug("juhi-podcast")).toBe(false);
    expect(ACTIVE_SHOW_TRIAL_EXCLUDED_SLUGS.ot).toBeDefined();
    for (const ctrl of ACTIVE_SHOW_TRIAL_CONTROL_SLUGS) {
      expect(isActiveShowTrialSlug(ctrl)).toBe(false);
    }
  });

  it("picks the real most recent released episode, ignores future timestamps, and produces grounded Hungarian copy", () => {
    const nowMs = Date.parse("2026-11-27T20:00:00Z");
    const latest = selectLatestReleasedPublicEpisode([
      { id: "future", slug: "jovo", title: "Jövőbeli adás", published_at: "2026-12-05T10:00:00Z" },
      { id: "older", slug: "regi", title: "Régi adás", published_at: "2026-11-10T10:00:00Z" },
      {
        id: "real-latest",
        slug: "szabo-norton",
        title: "EGY HUSZONÉVES CSILLAGÁSZ: Szabó Norton új egzobolygót fedezett fel /// Friderikusz Podcast 154.",
        published_at: "2026-11-24T17:00:00Z",
        summary: "A fiatal magyar csillagász az egzobolygó-kutatásról és az új felfedezésről mesél.",
      },
    ], nowMs);
    expect(latest?.id).toBe("real-latest");

    expect(cleanLatestEpisodeTopic(
      "EGY HUSZONÉVES CSILLAGÁSZ: Szabó Norton új egzobolygót fedezett fel /// Friderikusz Podcast 154.",
      "Friderikusz Podcast",
    )).toBe("Egy huszonéves csillagász: Szabó Norton új egzobolygót fedezett fel");

    const out = formatActiveShowTrial({
      podcastSlug: "friderikusz-podcast",
      podcastTitle: "Friderikusz Podcast",
      totalEpisodes: 294,
      episodes: [latest!],
      nowMs,
    });
    expect(out).not.toBeNull();
    expect(out!.title).toContain("Friderikusz Podcast:");
    expect(out!.title).toContain("| Podiverzum");
    expect(out!.title).not.toContain("///");
    expect(out!.title.length).toBeLessThanOrEqual(66);
    expect(out!.description).toContain("2026. nov. 24.");
    expect(out!.description).toContain("294 epizód");
    expect(out!.description.length).toBeLessThanOrEqual(160);
    expect(out!.latestEpisodeJsonLd["@type"]).toBe("PodcastEpisode");
    expect(out!.latestEpisodeJsonLd.url).toBe("https://podiverzum.hu/podcast/friderikusz-podcast/szabo-norton");

    // Control shows get null (zero global switch).
    expect(formatActiveShowTrial({
      podcastSlug: "balazsek",
      podcastTitle: "Balázsék",
      totalEpisodes: 1000,
      episodes: [latest!],
      nowMs,
    })).toBeNull();
  });
});