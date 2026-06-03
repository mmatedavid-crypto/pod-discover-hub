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

  it("parses RSS content:encoded as article text without DOMParser", () => {
    const items = parsePublisherFeed(`
      <rss xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel>
        <item>
          <title><![CDATA[Podcastcikk hosszabb leírással]]></title>
          <link>https://444.hu/podcast/podcastcikk</link>
          <description><![CDATA[<p>Rövid bevezető &amp; ajánló</p>]]></description>
          <content:encoded><![CDATA[<article><p>Ez a hosszabb cikk törzse, amelyből jobb description készülhet.</p></article>]]></content:encoded>
          <pubDate>Sun, 31 May 2026 10:00:00 GMT</pubDate>
        </item>
      </channel></rss>
    `, "444");

    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://444.hu/podcast/podcastcikk");
    expect(items[0].excerpt).toBe("Rövid bevezető & ajánló");
    expect(items[0].text).toContain("jobb description");
  });

  it("parses Atom entries with href links", () => {
    const items = parsePublisherFeed(`
      <feed>
        <entry>
          <title>Telex podcast háttéranyag</title>
          <link href="https://telex.hu/podcast/2026/06/03/telex-podcast-hatteranyag" />
          <summary>Podcast cikk összefoglalója.</summary>
          <updated>2026-06-03T12:00:00Z</updated>
        </entry>
      </feed>
    `, "telex");

    expect(items).toHaveLength(1);
    expect(items[0].url).toBe("https://telex.hu/podcast/2026/06/03/telex-podcast-hatteranyag");
    expect(items[0].title).toBe("Telex podcast háttéranyag");
    expect(items[0].text).toBe("Podcast cikk összefoglalója.");
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

  it("extracts same-domain absolute links for expanded Hungarian publisher sources", () => {
    const items = parsePublisherListingHtml(`
      <script>{"url":"https://www.portfolio.hu/podcast/2026/06/02/checklist-inflacio-forint-arfolyam"}</script>
      <a href="https://example.com/podcast/2026/06/02/foreign-copy">másik domain</a>
      <a href="/uzlet/podcast/2026/06/02/portfolio-checklist-befektetesek">relatív portfolio link</a>
    `, "portfolio", "https://www.portfolio.hu/podcast");

    const urls = items.map((item) => item.url);
    expect(urls).toContain("https://www.portfolio.hu/podcast/2026/06/02/checklist-inflacio-forint-arfolyam");
    expect(urls).toContain("https://www.portfolio.hu/uzlet/podcast/2026/06/02/portfolio-checklist-befektetesek");
    expect(urls.some((url) => url.includes("example.com"))).toBe(false);
  });

  it("keeps publisher article matching conservative for broad financial terms", () => {
    const score = scorePublisherArticleMatch(
      {
        id: "ep-hold",
        podcast_id: "pod-hold",
        title: "Hold After Hours: Mi történik a forinttal és az inflációval?",
        display_title: null,
        published_at: "2026-06-02T08:00:00Z",
        podcasts: { title: "Hold After Hours", display_title: "Hold After Hours" },
      },
      {
        outlet: "portfolio",
        url: "https://www.portfolio.hu/gazdasag/2026/06/02/inflacio-forint",
        title: "Gyengült a forint, új inflációs adat érkezett",
        excerpt: "Pénzpiaci összefoglaló podcast nélkül.",
        text: "A forint árfolyama és az inflációs adat mozgatta a piacokat, de a cikk nem a Hold After Hours adásáról szól.",
        published_at: "2026-06-02T09:00:00Z",
      },
    );

    expect(score.score).toBeLessThan(0.82);
  });
});
