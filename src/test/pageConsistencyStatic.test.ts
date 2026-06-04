import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("page consistency static guards", () => {
  it("keeps heavyweight public pages out of the global app shell", () => {
    const app = read("src/App.tsx");

    expect(app).toContain('const Index = lazy(() => import("./pages/Index.tsx"))');
    expect(app).toContain('const NotFound = lazy(() => import("./pages/NotFound.tsx"))');
    expect(app).not.toContain('import Index from "./pages/Index.tsx"');
    expect(app).not.toContain('import NotFound from "./pages/NotFound.tsx"');
  });

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

  it("keeps anonymous listeners one click away from their local Podiverzum profile", () => {
    const userMenu = read("src/components/UserMenu.tsx");

    expect(userMenu).toContain("hasLocalTasteResult");
    expect(userMenu).toContain('to="/te-podiverzumod"');
    expect(userMenu).toContain('localTasteDone ? "Hallgatói profilom" : "Te Podiverzumod"');
    expect(userMenu).toContain('to="/belepes"');
    expect(userMenu).not.toContain('if (!user) {\\n    return (\\n      <Link\\n        to="/belepes"');
  });

  it("keeps Te Podiverzumod recommendations useful even when vector matching is unavailable", () => {
    const startSwipe = read("src/pages/StartSwipePage.tsx");
    const tasteRecommend = read("supabase/functions/taste-recommend/index.ts");

    expect(startSwipe).toContain("INTEREST_GROUPS");
    expect(startSwipe).toContain("expandTasteTags(fallbackTags)");
    expect(startSwipe).toContain("episodeInterestKeys(r)");
    expect(startSwipe).toContain("fallbackQuery.overlaps(\"topics\", expandedFallbackTags)");
    expect(startSwipe).toContain("expandedFallbackTags");
    expect(startSwipe).toContain("recommendationRows = ((fallbackData || []) as any[]).map");
    expect(startSwipe).toContain("accept_hungarian");
    expect(startSwipe).toContain("Friss magyar epizódokat készítünk elő a profilodhoz.");
    expect(startSwipe).not.toContain("Nem sikerült lekérni az ajánlásokat");
    expect(startSwipe).not.toContain("Most nem sikerült lekérni az ajánlásokat");

    expect(tasteRecommend).toContain("INTEREST_GROUPS");
    expect(tasteRecommend).toContain("expandTasteTags(likedTopics)");
    expect(tasteRecommend).toContain("episodeInterestKeys({ title, podcastTitle, category, topics })");
  });

  it("keeps Te Podiverzumod sharing link-first so PNG rendering cannot break sharing", () => {
    const startSwipe = read("src/pages/StartSwipePage.tsx");

    expect(startSwipe).toContain("async function shareProfileLink");
    expect(startSwipe).toContain("await navigator.share(opts)");
    expect(startSwipe).toContain("return (await copyText(opts.url)) ? \"copied\" : \"error\"");
    expect(startSwipe).toContain("const outcome = await shareProfileLink");
    expect(startSwipe).toContain('await import("@/lib/receiptImage")');
    expect(startSwipe).toContain("const blob = await renderReceiptPng(receiptRef.current, \"story\")");
    expect(startSwipe).not.toContain("shareReceipt");
    expect(startSwipe).not.toContain('from "@/lib/receiptImage"');
    expect(startSwipe).toContain('lazy(() => import("@/components/EmailCaptureCard")');
    expect(startSwipe).toContain('lazy(() => import("@/components/SoftAuthCTA")');
    expect(startSwipe).not.toContain('import { EmailCaptureCard }');
    expect(startSwipe).not.toContain('import { SoftAuthCTA }');

    const shareBlock = startSwipe.slice(
      startSwipe.indexOf("const handleShare = async () => {"),
      startSwipe.indexOf("const handleDownload = async () => {"),
    );
    expect(shareBlock).toContain("shareProfileLink");
    expect(shareBlock).not.toContain("renderReceiptPng");
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
    expect(analytics).toContain('return "/kereses"');
    expect(analytics).toContain('return "/temak/:slug"');
    expect(analytics).toContain('return "/szemelyek/:slug"');
    expect(analytics).toContain('return "/ceg/:slug"');
    expect(analytics).toContain('return "/hangulatok/:slug"');
  });

  it("keeps live analytics route labels canonical for people and moods", () => {
    const live = read("src/pages/AdminLivePage.tsx");

    expect(live).toContain('return "/szemelyek/:slug"');
    expect(live).toContain('return "/hangulatok/:slug"');
    expect(live).not.toContain('return "/szemely/:slug"');
    expect(live).not.toContain('return "/hangulat/:slug"');
  });

  it("keeps topic chips on the canonical plural topic route", () => {
    const entity = read("src/lib/entity.ts");
    const analytics = read("src/pages/AdminAnalyticsPage.tsx");
    const live = read("src/pages/AdminLivePage.tsx");

    expect(entity).toContain('kind === "topic" ? "temak"');
    expect(entity).not.toContain('kind === "topic" ? "tema"');
    expect(analytics).toContain('return "/temak/:slug"');
    expect(live).toContain('return "/temak/:slug"');
    expect(live).not.toContain('return "/tema/:slug"');
  });

  it("keeps organization detail links on the canonical company route", () => {
    const autocomplete = read("supabase/functions/search-autocomplete/index.ts");
    const orgCard = read("src/components/OrgCard.tsx");
    const report = read("src/pages/PodcastReport2026.tsx");
    const prerender = read("supabase/functions/prerender/index.ts");

    expect(autocomplete).toContain("return `/ceg/${slug}`");
    expect(autocomplete).not.toContain("`/part/${slug}`");
    expect(orgCard).toContain("return `/ceg/${o.slug}`");
    expect(orgCard).not.toContain("`/part/${o.slug}`");
    expect(report).toContain("to={`/ceg/${p.slug}`}");
    expect(report).not.toContain("to={`/part/${p.slug}`}");
    expect(prerender).toContain("`${SITE}/ceg/${o.slug}`");
    expect(prerender).toContain("`${SITE}/ceg/${orgSlug}/temak/${topicSlug}`");
    expect(prerender).toContain('parts[0] === "ceg"');
    expect(prerender).not.toContain("`${SITE}/szervezetek/${o.slug}`");
    expect(prerender).not.toContain("`${SITE}/szervezetek/${orgSlug}/temak/${topicSlug}`");
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

  it("keeps entity pages careful about person evidence", () => {
    const entity = read("src/pages/EntityPage.tsx");

    expect(entity).toContain("Minden magyar podcast epizód, amely ehhez kapcsolódik");
    expect(entity).toContain("Legújabb kapcsolódó epizódok");
    expect(entity).toContain("Epizódok, ahol szó esik róla");
    expect(entity).not.toContain("Minden magyar podcast epizód, amiben");
    expect(entity).not.toContain("Legújabb epizódok, ahol megszólal");
    expect(entity).not.toContain("label={kind === \"person\" ? \"Megszólal\"");
  });

  it("keeps SEO fallback and prerender links on canonical Hungarian routes", () => {
    const notFound = read("src/pages/NotFound.tsx");
    const prerender = read("supabase/functions/prerender/index.ts");
    const searchInsights = read("src/pages/AdminSearchInsightsPage.tsx");

    expect(notFound).toContain("nav(`/kereses?q=");
    expect(notFound).not.toContain("nav(`/search?q=");
    expect(searchInsights).toContain("/kereses?q=");
    expect(searchInsights).not.toContain("/search?q=");
    expect(prerender).toContain('href="/toplista"');
    expect(prerender).toContain("`${SITE}/toplista`");
    expect(prerender).not.toContain('href="/podcastok"');
    expect(prerender).not.toContain("`${SITE}/podcastok`");
  });

  it("keeps public SEO surfaces behind the Hungarian text sanitizer", () => {
    const podcast = read("src/pages/PodcastDetail.tsx");
    const category = read("src/pages/CategoryDetail.tsx");
    const topic = read("src/pages/TopicDetailPage.tsx");
    const search = read("src/pages/SearchPage.tsx");
    const trending = read("src/components/TrendingPodcasts.tsx");
    const episode = read("src/pages/EpisodeDetail.tsx");

    for (const source of [podcast, category, topic, search, trending, episode]) {
      expect(source).toContain("sanitizeHungarianPublicText");
    }
    expect(podcast).toContain("sanitizeHungarianPublicText(data.seo_description)");
    expect(podcast).toContain("sanitizeHungarianPublicText(data.seo_title)");
    expect(category).toContain("sanitizeHungarianPublicText(c.seo_title)");
    expect(category).toContain("sanitizeHungarianPublicText(c.seo_description)");
    expect(topic).toContain("sanitizeHungarianPublicText((t as any).seo_description)");
    expect(search).toContain("sanitizeHungarianPublicText(heroPodcast.summary)");
    expect(trending).toContain("sanitizeHungarianPublicText(p.summary)");
    expect(episode).toContain("const description = sanitizeHungarianPublicText(e.description)");
    expect(episode).toContain("extractKeyMoments(sanitizeHungarianPublicText(data?.e?.description)");
    expect(episode).not.toContain("const description = stripHtml(e.description)");
  });

  it("keeps public search on the accepted Hungarian catalog, not query accent language guesses", () => {
    const search = read("src/lib/search.ts");
    const searchPage = read("src/pages/SearchPage.tsx");

    expect(search).toContain("is_hungarian.eq.true,language_decision.eq.accept_hungarian");
    expect(search).toContain("accepted Hungarian podcasts");
    expect(search).toContain("ASCII Hungarian queries");
    expect(search).toContain("language_decision");
    expect(search).not.toContain('tq.like("podcasts.language"');
    expect(search).not.toContain('aq.like("podcasts.language"');
    expect(searchPage).toContain('.or("is_hungarian.eq.true,language_decision.eq.accept_hungarian")');
    expect(searchPage).toContain("reject_non_hungarian");
    expect(searchPage).toContain("sanitizeHungarianPublicText(p.summary).toLowerCase()");
  });
});
