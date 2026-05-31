import { describe, expect, it } from "vitest";

const {
  parsePublisherListingHtml,
  parsePublisherFeed,
  scorePublisherArticleMatch,
} = await import("../../supabase/functions/_shared/publisher-article-match");

describe("publisher article matching", () => {
  it("confidently matches a publisher article to the corresponding podcast episode", () => {
    const score = scorePublisherArticleMatch(
      {
        id: "ep-1",
        podcast_id: "pod-1",
        title: "Vagyonfalva: milyen a milliárdosok városa? Interjú Schmied Andival",
        display_title: null,
        published_at: "2026-05-31T10:00:00Z",
        podcasts: { title: "Telex Podcast", display_title: "Telex Podcast" },
      },
      {
        outlet: "telex",
        url: "https://telex.hu/podcast/vagyonfalva-milliardosok-varosa-schmied-andi",
        title: "Vagyonfalva: milyen a milliárdosok városa? Interjú Schmied Andival",
        excerpt: "A Telex Podcast új adásában Schmied Andival beszélgettünk.",
        text: "A beszélgetésben szóba kerül a milliárdosok városa, a vagyon koncentrációja és Schmied Andi tapasztalata.",
        published_at: "2026-05-31T11:20:00Z",
      },
    );

    expect(score.score).toBeGreaterThanOrEqual(0.82);
    expect(score.reasons).toContain("title_token_match");
    expect(score.reasons).toContain("published_near_episode");
  });

  it("does not confirm unrelated articles just because they are from the same day", () => {
    const score = scorePublisherArticleMatch(
      {
        id: "ep-1",
        podcast_id: "pod-1",
        title: "Vagyonfalva: milyen a milliárdosok városa? Interjú Schmied Andival",
        display_title: null,
        published_at: "2026-05-31T10:00:00Z",
        podcasts: { title: "Telex Podcast", display_title: "Telex Podcast" },
      },
      {
        outlet: "telex",
        url: "https://telex.hu/sport/bl-donto-budapest",
        title: "Egy biztos: az egyik csapat pihentebb lesz a BL-döntőben",
        excerpt: "Sporthír podcast nélkül.",
        text: "A döntő előtti felkészülésről és a stadion környéki forgalomról szóló cikk.",
        published_at: "2026-05-31T11:20:00Z",
      },
    );

    expect(score.score).toBeLessThan(0.68);
    expect(score.reasons).not.toContain("title_token_match");
  });

  it("parses RSS content:encoded as article text", () => {
    const items = parsePublisherFeed(`
      <rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
        <item>
          <title><![CDATA[Podcastcikk hosszabb leírással]]></title>
          <link>https://444.hu/podcast/podcastcikk</link>
          <description><![CDATA[Rövid bevezető]]></description>
          <content:encoded><![CDATA[<article><p>Ez a hosszabb cikk törzse, amelyből jobb description készülhet.</p></article>]]></content:encoded>
          <pubDate>Sun, 31 May 2026 10:00:00 GMT</pubDate>
        </item>
      </channel></rss>
    `, "444");

    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://444.hu/podcast/podcastcikk");
    expect(items[0].text).toContain("jobb description");
  });

  it("extracts publisher article links from listing HTML when there is no RSS feed", () => {
    const items = parsePublisherListingHtml(`
      <a href="/2026/04/29/az-orban-rendszerben-boven-van-meg-banyasznivalo-ujsagiras-es-media-eddig-es-ezutan">
        podcast cikk
      </a>
      <script>{"url":"https://444.hu/2026/05/30/borizu-hang-podcast-majus-vege"}</script>
      <a href="/assets/logo.svg">asset</a>
    `, "444", "https://444.hu/category/podcast");

    expect(items.map((item) => item.url)).toContain("https://444.hu/2026/04/29/az-orban-rendszerben-boven-van-meg-banyasznivalo-ujsagiras-es-media-eddig-es-ezutan");
    expect(items.map((item) => item.url)).toContain("https://444.hu/2026/05/30/borizu-hang-podcast-majus-vege");
    expect(items.some((item) => item.url.includes("assets"))).toBe(false);
    expect(items[0].title.length).toBeGreaterThan(8);
  });
});
