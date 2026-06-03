import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("page consistency static guards", () => {
  it("keeps topic detail pages focused on episodes, people and related topics, not podcast-channel recommendations", () => {
    const topic = read("src/pages/TopicDetailPage.tsx");

    expect(topic).toContain("Friss epizódok");
    expect(topic).toContain("Időtálló epizódok");
    expect(topic).toContain("Kapcsolódó személyek");
    expect(topic).toContain("Kapcsolódó témák");
    expect(topic).not.toContain("SimilarPodcasts");
    expect(topic).not.toContain("Kiemelt podcastok");
    expect(topic).not.toContain("Hasonló podcastok");
  });

  it("keeps public copy aligned with the internal player experience", () => {
    const terms = read("src/pages/TermsPage.tsx");
    const about = read("src/pages/AboutPage.tsx");
    const methodology = read("src/pages/MethodologyPage.tsx");

    expect(terms).toContain("saját lejátszóban");
    expect(terms).toContain("eredeti kiadói hangforrás");
    expect(about).toContain("Saját playerrel indítjuk a hallgatást");
    expect(methodology).toContain("A saját lejátszó az eredeti kiadói hangforrást használja");

    expect(terms).not.toContain("a lejátszáshoz az epizód eredeti platformjára irányít át");
    expect(terms).not.toContain("A meghallgatáshoz a Podiverzum az eredeti kiadó");
    expect(about).not.toContain("A hallgatókat visszairányítjuk");
    expect(methodology).not.toContain("nem streameljük");
  });

  it("keeps category links on the Hungarian canonical route", () => {
    const labels = read("src/lib/categoryLabels.ts");
    const categories = read("src/pages/CategoriesPage.tsx");
    const home = read("src/pages/Index.tsx");
    const detail = read("src/pages/CategoryDetail.tsx");
    const autocomplete = read("supabase/functions/search-autocomplete/index.ts");
    const analytics = read("src/pages/AdminAnalyticsPage.tsx");

    for (const source of [labels, categories, home, detail, autocomplete]) {
      expect(source).toContain("/kategoria/");
      expect(source).not.toContain("/category/${");
    }
    expect(labels).toContain("Hírek és politika");
    expect(labels).toContain("Vallás és spiritualitás");
    expect(labels).toContain("Kultúra és társadalom");
    expect(labels).toContain("Bűnügyek és rejtélyek");
    expect(analytics).toContain('return "/kategoria/:slug"');
  });

  it("keeps smart-player related-copy human, not internal AI/vector jargon", () => {
    const related = read("src/components/smart-player/RelatedEpisodes.tsx");
    const discovery = read("src/components/smart-player/SmartDiscoveryPanel.tsx");
    const bar = read("src/components/smart-player/SmartPlayerBar.tsx");

    expect(related).toContain("Tartalmi kapcsolat");
    expect(related).toContain("Keressük a kapcsolódó epizódokat");
    expect(discovery).toContain("Keressük a kapcsolódó epizódokat");
    expect(bar).toContain("Kapcsolódó epizódok és értékelés");

    for (const source of [related, discovery, bar]) {
      expect(source).not.toContain("AI vektor");
      expect(source).not.toContain("vektor-index");
      expect(source).not.toContain("AI ajánlások");
      expect(source).not.toContain("▶ Play");
    }
  });
});
