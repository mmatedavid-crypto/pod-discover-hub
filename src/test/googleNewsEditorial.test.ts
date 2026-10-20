import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as front from "@/lib/hetiSlug";
import {
  buildNewsSitemapXml,
  decideNewsSubmit,
  hetiSlug,
  resolveHetiSlug,
  selectNewsEditorialEntries,
} from "../../supabase/functions/_shared/heti-editorial";

const SITE = "https://podiverzum.hu";
const NOW = Date.parse("2026-10-20T09:00:00Z");
const H = 3600 * 1000;
const read = (p: string) => readFileSync(p, "utf8");

const live = {
  week_start: "2026-10-12",
  title: "A hét a Podiverzumon — okt. 12. – 19.",
  status: "published",
  published_at: "2026-10-19T06:30:18.411Z",
};

describe("Podiverzum Heti slug + resolution", () => {
  it("matches the SPA slug algorithm exactly", () => {
    for (const p of [
      live,
      { week_start: "2026-09-21", title: "A hét a Podiverzumon — szept. 21. – 28." },
      { week_start: "2025-12-29", title: "Évzáró: Űrhajó, Ő és Ü" },
      { week_start: "2026-01-04", title: null },
    ]) {
      expect(hetiSlug(p)).toBe(front.hetiSlug(p));
    }
    expect(hetiSlug(live)).toBe("2026-42-a-het-a-podiverzumon-okt-12-19");
  });

  it("serves a published article on its exact slug", () => {
    const r = resolveHetiSlug([live], "2026-42-a-het-a-podiverzumon-okt-12-19", NOW);
    expect(r.kind).toBe("ok");
  });

  it("treats unpublished (draft) articles as absent", () => {
    const draft = { ...live, status: "draft", published_at: null };
    expect(resolveHetiSlug([draft], "2026-42-a-het-a-podiverzumon-okt-12-19", NOW).kind).toBe("missing");
  });

  it("treats a future publish time as absent", () => {
    const future = { ...live, published_at: "2026-10-21T06:30:00Z" };
    expect(resolveHetiSlug([future], "2026-42-a-het-a-podiverzumon-okt-12-19", NOW).kind).toBe("missing");
  });

  it("never falls back to the latest article for an unknown week", () => {
    expect(resolveHetiSlug([live], "2026-30-nem-letezo-cikk", NOW).kind).toBe("missing");
    expect(resolveHetiSlug([live], "nem-heti-slug", NOW).kind).toBe("missing");
  });

  it("redirects a same-week stale tail to the canonical slug, like the SPA", () => {
    const r = resolveHetiSlug([live], "2026-42-regi-cim", NOW);
    expect(r).toMatchObject({ kind: "redirect", slug: "2026-42-a-het-a-podiverzumon-okt-12-19" });
  });
});

describe("Google News sitemap", () => {
  const at = (hoursAgo: number, extra: Record<string, unknown> = {}) => ({
    ...live,
    published_at: new Date(NOW - hoursAgo * H).toISOString(),
    ...extra,
  });

  it("includes a published article from 47 hours ago", () => {
    expect(selectNewsEditorialEntries([at(47)], SITE, NOW)).toHaveLength(1);
  });

  it("excludes a published article from 49 hours ago", () => {
    expect(selectNewsEditorialEntries([at(49)], SITE, NOW)).toHaveLength(0);
  });

  it("excludes future-dated and unpublished articles", () => {
    expect(selectNewsEditorialEntries([at(-1), at(2, { status: "draft" })], SITE, NOW)).toHaveLength(0);
  });

  it("never lists the /heti hub or podcast catalog pages", () => {
    const locs = selectNewsEditorialEntries([at(1)], SITE, NOW).map((e) => e.loc);
    expect(locs).toEqual([`${SITE}/heti/2026-42-a-het-a-podiverzumon-okt-12-19`]);
    expect(read("supabase/functions/refresh-sitemap/index.ts")).not.toMatch(/addNewsItem\(`\$\{SITE\}\/(heti`|podcast\/)/);
  });

  it("publishes an empty news sitemap when nothing is fresh", () => {
    const xml = buildNewsSitemapXml(selectNewsEditorialEntries([at(100)], SITE, NOW));
    expect(xml).toContain('xmlns:news="http://www.google.com/schemas/sitemap-news/0.9"');
    expect(xml).not.toContain("<url>");
  });

  it("retries a failed Search Console submission even without new URLs", () => {
    expect(decideNewsSubmit({ hasReliableBaseline: true, newUrlCount: 0, previousSubmitNeeded: true }))
      .toEqual({ submit: true, trigger: "pending_retry" });
    expect(decideNewsSubmit({ hasReliableBaseline: true, newUrlCount: 0, previousSubmitNeeded: false }).submit)
      .toBe(false);
    expect(decideNewsSubmit({ hasReliableBaseline: true, newUrlCount: 1, previousSubmitNeeded: false }).trigger)
      .toBe("new_urls");
  });
});

describe("podcast episode structured data", () => {
  const prerender = read("supabase/functions/prerender/index.ts");
  const episodeBuilder = prerender.slice(
    prerender.indexOf("async function buildEpisode("),
    prerender.indexOf("function huDateText("),
  );
  const episodePage = read("src/pages/EpisodeDetail.tsx");

  it("emits no NewsArticle on podcast episode pages (crawler + app)", () => {
    expect(episodeBuilder).not.toContain('"NewsArticle"');
    expect(episodePage).not.toContain('"NewsArticle"');
  });

  it("keeps PodcastEpisode on podcast episode pages", () => {
    expect(episodeBuilder).toContain('"@type": "PodcastEpisode"');
    expect(episodePage).toContain('"@type": "PodcastEpisode"');
  });

  it("does not claim the site owner publishes third-party podcasts", () => {
    expect(episodeBuilder).not.toContain("publisher: sitePublisherJsonLd()");
  });

  it("routes Heti and informational pages to crawler HTML", () => {
    for (const fn of ["buildHetiHub(", "buildHetiArticle(", "buildAboutPage(", "buildContactPage(", "buildEditorialStaffPage("]) {
      expect(prerender).toContain(`return ${fn.startsWith("buildHeti") ? "await " : ""}${fn}`);
    }
    const worker = read("infra/cloudflare-worker/worker.js");
    expect(worker).toContain('"/szerkesztoseg"');
    expect(read(".lovable/cloudflare-worker.js")).toBe(worker);
  });
});
