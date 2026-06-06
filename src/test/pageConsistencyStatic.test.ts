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

  it("keeps stable vendor libraries in cacheable build chunks", () => {
    const vite = read("vite.config.ts");

    expect(vite).toContain("manualChunks(id)");
    expect(vite).toContain('return "vendor-react"');
    expect(vite).toContain('return "vendor-supabase"');
    expect(vite).toContain('return "vendor-query"');
    expect(vite).toContain('return "vendor-ui"');
    expect(vite).toContain('return "vendor-icons"');
    expect(vite).toContain('return "vendor-motion"');
  });

  it("keeps the homepage focused and avoids obsolete duplicate topic/media rails", () => {
    const index = read("src/pages/Index.tsx");
    const shortcuts = read("src/components/home/HomeDiscoveryShortcuts.tsx");
    const header = read("src/components/SiteHeader.tsx");

    expect(index).toContain("<TrendingPodcasts />");
    expect(index).toContain("<HomeDiscoveryShortcuts />");
    expect(index).toContain("Most érdemes meghallgatni");
    expect(index).toContain("pickDiverseHomepageCategories(populated, 3)");
    expect(index).toContain("categoryDiversityGroup");
    expect(index).not.toContain("HomeTopicsSection");
    expect(index).not.toContain("HomeCurrentSignals");
    expect(index).not.toContain("HomeMediaSignals");
    expect(shortcuts).not.toContain("Podcast témák szerint");
    expect(shortcuts).not.toContain("Médiafigyelés");
    expect(header).not.toContain('className="ml-auto hidden lg:inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"');
  });

  it("keeps topic detail pages focused on episodes, people and related topics, not podcast-channel recommendations", () => {
    const topic = read("src/pages/TopicDetailPage.tsx");

    expect(topic).toContain("Friss epizódok");
    expect(topic).toContain("Időtálló epizódok");
    expect(topic).toContain("Kapcsolódó személyek");
    expect(topic).toContain("Kapcsolódó témák");
    expect(topic).toContain("function isUnsafeTemporalPerson");
    expect(topic).toContain("is_deceased, is_historical, has_archival_evidence, persona, is_topic_only, date_of_death, is_living, participant_count, host_count, guest_count");
    expect(topic).toContain('.eq("is_indexable", true)');
    expect(topic).toContain("const safePeople = ((ppl || []) as any[]).filter");
    expect(topic).toContain("if (isUnsafeTemporalPerson(p)) return false");
    expect(topic).toContain("p.identity_ambiguous && !p.manual_approved && !trustedWiki");
    expect(topic).toContain("published_at, ai_summary, summary, description");
    expect(topic).toContain('.eq("episodes.podcasts.language_decision", "accept_hungarian")');
    expect(topic).not.toContain("SimilarPodcasts");
    expect(topic).not.toContain("Kiemelt podcastok");
    expect(topic).not.toContain("Hasonló podcastok");
    expect(topic).not.toContain('.eq("episodes.podcasts.is_hungarian", true)');
    expect(topic).not.toContain('.from("people")\\n          .select("slug, name")');
  });

  it("keeps the people hub identity-safe across top, alpha and topic-figure rails", () => {
    const peopleHub = read("src/pages/PeopleHubPage.tsx");

    expect(peopleHub).toContain("function isSafePeopleHubPerson");
    expect(peopleHub).toContain("setTop(rows.filter(isSafePeopleHubPerson))");
    expect(peopleHub).toContain("setList(rows.filter(isSafePeopleHubPerson))");
    expect(peopleHub).toContain("setTopicFigures(((data || []) as any[]).filter(isSafePeopleHubPerson))");
    expect(peopleHub).toContain(".eq(\"is_indexable\", true)");
    expect(peopleHub).toContain("p.identity_ambiguous && !p.manual_approved && !trustedWiki");
    expect(peopleHub).toContain('["needs_human_review", "duplicate_candidate"].includes(p.ai_review_status || "")');
  });

  it("keeps podcast host person links identity-safe", () => {
    const podcastDetail = read("src/pages/PodcastDetail.tsx");

    expect(podcastDetail).toContain("function isSafeHostPerson");
    expect(podcastDetail).toContain("filter(isSafeHostPerson)");
    expect(podcastDetail).toContain("if (!row.person_id || !isSafeHostPerson(row.people)) continue");
    expect(podcastDetail).toContain("identity_ambiguous, manual_approved");
    expect(podcastDetail).toContain("is_deceased, is_historical, has_archival_evidence");
    expect(podcastDetail).not.toContain('select("id, slug, name, image_url").in("name", manualNames)');
  });

  it("keeps homepage episode rails AI-summary aware", () => {
    const home = read("src/pages/Index.tsx");

    expect(home).toContain("ai_summary: r.ai_summary");
    expect(home).toContain("episode_id,title,display_title,slug,ai_summary,summary,description");
  });

  it("keeps category episode discovery open to accepted Hungarian non-spam shows", () => {
    const category = read("src/pages/CategoryDetail.tsx");

    expect(category).toContain('.eq("language_decision", "accept_hungarian")');
    expect(category).toContain("const categoryPodcastIds = visible.map");
    expect(category).toContain(".in(\"podcast_id\", categoryPodcastIds)");
    expect(category).toContain("slug,image_url,ai_summary,summary,description");
    expect(category).toContain('.eq("episodes.podcasts.language_decision", "accept_hungarian")');
    expect(category).not.toContain(".or(\"is_hungarian.eq.true,language_decision.eq.accept_hungarian\")");
    expect(category).not.toContain("is_hungarian");
    expect(category).not.toContain("p.language_decision !== \"reject_foreign\"");
    expect(category).not.toContain(".in(\"podcast_id\", promotedIds)");
    expect(category).not.toContain('.eq("episodes.podcasts.is_hungarian", true)');
  });

  it("keeps the live index bar on accepted Hungarian episodes", () => {
    const liveIndex = read("src/components/LiveIndexBar.tsx");

    expect(liveIndex).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
    expect(liveIndex).not.toContain("is_hungarian");
    expect(liveIndex).not.toContain('or("is_hungarian.eq.true,language_decision.eq.accept_hungarian"');
    expect(liveIndex).not.toContain('language_decision !== "reject_foreign"');
  });

  it("keeps daily public stats on the accepted Hungarian catalog", () => {
    const stats = read("src/components/DailyStatsStrip.tsx");

    expect(stats).toContain('podcasts!inner(language_decision)');
    expect(stats).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
    expect(stats).toContain('.eq("language_decision", "accept_hungarian")');
    expect(stats).not.toContain('.eq("podcasts.is_hungarian", true)');
    expect(stats).not.toContain('.eq("is_hungarian", true)');
  });

  it("keeps admin audit and backfill views on accepted Hungarian decisions", () => {
    const hosts = read("src/pages/AdminHostsPage.tsx");
    const piBackfill = read("src/pages/AdminPiBackfillPage.tsx");
    const intelligenceAudit = read("src/pages/AdminIntelligenceAuditPage.tsx");
    const auditScript = read("scripts/audit-intelligence.mjs");

    for (const source of [hosts, piBackfill, intelligenceAudit, auditScript]) {
      expect(source).toContain("language_decision");
      expect(source).toContain("accept_hungarian");
      expect(source).not.toContain('.eq("is_hungarian", true)');
      expect(source).not.toContain('.eq("podcasts.is_hungarian", true)');
      expect(source).not.toContain("is_hungarian.eq.true");
    }
  });

  it("keeps mood pages polished and sanitized instead of exposing raw DB labels", () => {
    const homeMoods = read("src/components/MoodCollections.tsx");
    const moods = read("src/pages/MoodsPage.tsx");
    const moodDetail = read("src/pages/MoodCollectionPage.tsx");

    for (const source of [homeMoods, moods, moodDetail]) {
      expect(source).toContain("sanitizeHungarianPublicText");
      expect(source).toContain("polishMoodTitle");
    }
    expect(moodDetail).toContain("const pageTitle = polishMoodTitle");
    expect(moodDetail).toContain("{pageTitle}</h1>");
    expect(homeMoods).toContain('test: "Mozgás és egészség"');
    expect(homeMoods).toContain('fej: "Gondolatok és tudás"');
    expect(homeMoods).toContain('élet: "Lélek és élethelyzetek"');
    expect(homeMoods).toContain("Hallgatási helyzetek</h2>");
    expect(homeMoods).not.toContain("Mihez van most kedved?</h2>");
    expect(moodDetail).not.toContain("{mood.title}</h1>");
    expect(moods).not.toContain("{m.description}</div>");
    expect(homeMoods).not.toContain("c.short_description || c.description || \"\"");
  });

  it("keeps public copy aligned with the internal player experience", () => {
    const terms = read("src/pages/TermsPage.tsx");
    const about = read("src/pages/AboutPage.tsx");
    const methodology = read("src/pages/MethodologyPage.tsx");
    const podcastCard = read("src/components/PodcastCard.tsx");
    const podcastDetail = read("src/pages/PodcastDetail.tsx");

    expect(terms).toContain("saját lejátszóban");
    expect(terms).toContain("eredeti kiadói hangforrás");
    expect(about).toContain("Saját playerrel indítjuk a hallgatást");
    expect(methodology).toContain("A saját lejátszó az eredeti kiadói hangforrást használja");
    expect(podcastCard).toContain("Megnyitás <ArrowRight");
    expect(podcastCard).toContain('aria-label="Külső platformok"');
    expect(podcastCard).toContain('className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-secondary hover:text-foreground"');
    expect(podcastDetail).toContain("Legfrissebb epizód");
    expect(podcastDetail).toContain('aria-label="Külső platformok"');

    expect(terms).not.toContain("a lejátszáshoz az epizód eredeti platformjára irányít át");
    expect(terms).not.toContain("A meghallgatáshoz a Podiverzum az eredeti kiadó");
    expect(about).not.toContain("A hallgatókat visszairányítjuk");
    expect(methodology).not.toContain("nem streameljük");
  });

  it("keeps podcast detail search copy natural and channel-scoped", () => {
    const podcastDetail = read("src/pages/PodcastDetail.tsx");

    expect(podcastDetail).toContain("const podcastTitle = podcast.display_title || podcast.title");
    expect(podcastDetail).toContain("keress kifejezetten ebben a csatornában");
    expect(podcastDetail).toContain("Keresés csak ebben a csatornában:");
    expect(podcastDetail).toContain("Csak a „{podcastTitle}” epizódjai között keres.");
    expect(podcastDetail).toContain("Nincs találat a „{q}” keresésre ebben a műsorban.");
    expect(podcastDetail).not.toContain("podcastben");
    expect(podcastDetail).not.toContain("a(z)");
  });

  it("keeps podcast and episode detail SEO indexed only for accepted Hungarian shows", () => {
    const podcastDetail = read("src/pages/PodcastDetail.tsx");
    const episodeDetail = read("src/pages/EpisodeDetail.tsx");

    expect(podcastDetail).toContain('const isAcceptedHungarian = data.language_decision === "accept_hungarian"');
    expect(episodeDetail).toContain('const isAcceptedHungarian = p.language_decision === "accept_hungarian"');
    expect(podcastDetail).toContain("const noindex = !isAcceptedHungarian");
    expect(episodeDetail).toContain("noindex: !isAcceptedHungarian");
    expect(podcastDetail).not.toContain('data.is_hungarian === true || data.language_decision === "accept_hungarian"');
    expect(episodeDetail).not.toContain('p.is_hungarian === true || p.language_decision === "accept_hungarian"');
  });

  it("keeps public Hungarian copy free of awkward a-z placeholders", () => {
    const peopleHub = read("src/pages/PeopleHubPage.tsx");
    const companiesHub = read("src/pages/CompaniesHubPage.tsx");
    const partiesHub = read("src/pages/PartiesHubPage.tsx");
    const episodeDetail = read("src/pages/EpisodeDetail.tsx");
    const prerender = read("supabase/functions/prerender/index.ts");

    for (const source of [peopleHub, companiesHub, partiesHub, episodeDetail, prerender]) {
      expect(source).not.toContain("a(z)");
      expect(source).not.toContain("podcastben");
      expect(source).not.toContain("podcast vendégek");
    }
    expect(peopleHub).toContain("„{debouncedQ}” keresésre {totalAll.toLocaleString");
    expect(companiesHub).toContain("„{debouncedQ}” keresésre {total.toLocaleString");
    expect(partiesHub).toContain("„${debouncedQ}” keresésre");
    expect(episodeDetail).toContain("podcast epizódja — Podiverzum");
    expect(prerender).toContain("Személyek magyar podcastokban");
    expect(prerender).not.toContain("Személyek és podcastvendégek");
    expect(prerender).not.toContain("podcastvendégek és gyakran említett nevek");
    expect(prerender).toContain("${org.name} és ${topic.name} témakörben");
    expect(prerender).toContain("${a.name} és ${b.name} közös témájában");
  });

  it("labels podcast search results as search results, not recommendations", () => {
    const search = read("src/pages/SearchPage.tsx");

    expect(search).toContain("Podcast találatok");
    expect(search).toContain("További podcast találatok");
    expect(search).not.toContain("Kapcsolódó podcastok");
    expect(search).not.toContain("További kapcsolódó podcastok");
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
    expect(startSwipe).toContain("categoryLabel(r.category)");
    expect(startSwipe).toContain("accept_hungarian");
    expect(startSwipe).not.toContain('.eq("podcasts.is_hungarian", true)');
    expect(tasteRecommend).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
    expect(tasteRecommend).not.toContain("is_hungarian");
    expect(tasteRecommend).not.toContain("is_hungarian.eq.true,language_decision.eq.accept_hungarian");
    expect(tasteRecommend).not.toContain('language_decision !== "reject_foreign"');
    expect(startSwipe).toContain("Friss magyar epizódokat készítünk elő a profilodhoz.");
    expect(startSwipe).toContain("Még kevés jelünk van pontos epizódajánláshoz");
    expect(startSwipe).toContain("Finomítom a profilom");
    expect(startSwipe).toContain("Indítsd az első ajánlást");
    expect(startSwipe).not.toContain("Nem sikerült lekérni az ajánlásokat");
    expect(startSwipe).not.toContain("Most nem sikerült lekérni az ajánlásokat");
    expect(startSwipe).not.toContain("Podcastok nekem");
    expect(startSwipe).not.toContain("Irány: ${r.category}");

    expect(tasteRecommend).toContain("INTEREST_GROUPS");
    expect(tasteRecommend).toContain("expandTasteTags(likedTopics)");
    expect(tasteRecommend).toContain("episodeInterestKeys({ title, podcastTitle, category, topics })");
    expect(tasteRecommend).toContain("const newsPolicy = newsPolicyForTopics(likedTopics)");
    expect(tasteRecommend).toContain("diversifyRecommendations(ranked, FINAL_LIMIT, newsPolicy)");
    expect(tasteRecommend).toContain("const noEvidencePenalty = topicOverlap === 0 ? -5 : 0");
    expect(tasteRecommend).toContain("const bulletinPenalty = isBulletinLike({ title, podcastTitle }) ? -10 : 0");
    expect(tasteRecommend).toContain("maxBulletin: newsPolicy.allowBulletins ? 1 : 0");
    expect(tasteRecommend).toContain("maxNews: newsPolicy.allowNews ? 2 : 0");
    expect(tasteRecommend).toContain("newsPolicy.allowBulletins ? -8 : -40");
    expect(startSwipe).toContain("hírek röviden|röviden|hírpercek");
  });

  it("keeps Te Podiverzumod sharing link-first so PNG rendering cannot break sharing", () => {
    const startSwipe = read("src/pages/StartSwipePage.tsx");
    const listenerProfile = read("src/pages/ListenerProfilePage.tsx");
    const shareRecs = read("src/components/share/ShareRecommendedEpisodes.tsx");

    expect(startSwipe).toContain("async function shareProfileLink");
    expect(startSwipe).toContain("await navigator.share(opts)");
    expect(startSwipe).toContain("return (await copyText(opts.url)) ? \"copied\" : \"error\"");
    expect(startSwipe).toContain("const outcome = await shareProfileLink");
    expect(startSwipe).toContain("Próbáld a Link másolása gombot");
    expect(startSwipe).not.toContain("Hoppá, valami félrement.");
    expect(startSwipe).toContain('await import("@/lib/receiptImage")');
    expect(startSwipe).toContain("const blob = await renderReceiptPng(receiptRef.current, \"story\")");
    expect(startSwipe).not.toContain("shareReceipt");
    expect(startSwipe).not.toContain('from "@/lib/receiptImage"');
    expect(startSwipe).toContain('lazy(() => import("@/components/EmailCaptureCard")');
    expect(startSwipe).toContain('lazy(() => import("@/components/SoftAuthCTA")');
    expect(startSwipe).not.toContain('import { EmailCaptureCard }');
    expect(startSwipe).not.toContain('import { SoftAuthCTA }');
    expect(startSwipe).toContain("...topInterests");
    expect(startSwipe).toContain("...topInterestLabels");
    expect(listenerProfile).toContain('import { ShareRecommendedEpisodes } from "@/components/share/ShareRecommendedEpisodes"');
    expect(listenerProfile).toContain("<ShareRecommendedEpisodes");
    expect(listenerProfile).toContain("autoplayTop");
    expect(shareRecs).toContain("function newsPolicyForTags");
    expect(shareRecs).toContain("expandTasteTags(inputTags)");
    expect(shareRecs).toContain("!newsPolicy.allowNews && isNewsLike");
    expect(shareRecs).toContain("!newsPolicy.allowBulletins && isBulletinLike");

    const shareBlock = startSwipe.slice(
      startSwipe.indexOf("const handleShare = async () => {"),
      startSwipe.indexOf("const handleDownload = async () => {"),
    );
    expect(shareBlock).toContain("shareProfileLink");
    expect(shareBlock).not.toContain("renderReceiptPng");
  });

  it("keeps category links on the Hungarian canonical route", () => {
    const app = read("src/App.tsx");
    const labels = read("src/lib/categoryLabels.ts");
    const categories = read("src/pages/CategoriesPage.tsx");
    const search = read("src/pages/SearchPage.tsx");
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
    expect(labels).toContain("Technológia");
    expect(labels).not.toContain('{ label: "Tech"');
    expect(app).toContain('<Route path="/categories" element={<Navigate to="/kategoriak" replace />} />');
    expect(app).toContain('<Route path="/category/:slug" element={<RedirectWithSlug to="/kategoria" />} />');
    expect(app).not.toContain('<Route path="/category/:slug" element={<CategoryDetail />} />');
    expect(search).toContain("categoryLabel(c)");
    expect(search).toContain("categoryLabel(heroPodcast.category)");
    expect(search).not.toMatch(/categoryLabels\[c\]\s*\|\|\s*c\b/);
    expect(search).not.toMatch(/categoryLabels\[heroPodcast\.category\]\s*\|\|\s*heroPodcast\.category\b/);
    expect(analytics).toContain('return "/kategoria/:slug"');
    expect(analytics).toContain('return "/kereses"');
    expect(analytics).toContain('return "/temak/:slug"');
    expect(analytics).toContain('return "/szemelyek/:slug"');
    expect(analytics).toContain('return "/ceg/:slug"');
    expect(analytics).toContain('return "/hangulatok/:slug"');
  });

  it("keeps public-facing generic UI copy Hungarian", () => {
    const about = read("src/pages/AboutPage.tsx");
    const carousel = read("src/components/ui/carousel.tsx");
    const home = read("src/pages/Index.tsx");
    const topics = read("src/pages/TopicsHubPage.tsx");

    expect(about).toContain("Találd meg. Hallgasd meg.");
    expect(about).not.toContain("Find it. Hear it.");
    expect(carousel).toContain("Előző elem");
    expect(carousel).toContain("Következő elem");
    expect(carousel).not.toContain("Previous slide");
    expect(carousel).not.toContain("Next slide");
    expect(home).toContain("Technológia és MI");
    expect(topics).toContain('tech: "Technológia és MI"');
    expect(home).not.toContain("Tech és MI");
    expect(topics).not.toContain("Tech és MI");
  });

  it("does not promise disabled similar-podcast recommendations in public methodology", () => {
    const methodology = read("src/pages/MethodologyPage.tsx");

    expect(methodology).toContain("Személyek, témák, felfedezési utak");
    expect(methodology).toContain("kapcsolódó személyeket, szervezeteket");
    expect(methodology).toContain("hallgatási helyzetek");
    expect(methodology).not.toContain("kapcsolódó podcastokat");
    expect(methodology).not.toContain("hasonló podcastok");
    expect(methodology).not.toContain("hasonló témájú beszélgetéseket");
  });

  it("keeps live analytics route labels canonical for people and moods", () => {
    const live = read("src/pages/AdminLivePage.tsx");

    expect(live).toContain('return "/szemelyek/:slug"');
    expect(live).toContain('return "/hangulatok/:slug"');
    expect(live).not.toContain('return "/szemely/:slug"');
    expect(live).not.toContain('return "/hangulat/:slug"');
  });

  it("keeps topic chips on the canonical plural topic route", () => {
    const app = read("src/App.tsx");
    const entity = read("src/lib/entity.ts");
    const analytics = read("src/pages/AdminAnalyticsPage.tsx");
    const live = read("src/pages/AdminLivePage.tsx");

    expect(entity).toContain('kind === "topic" ? "temak"');
    expect(entity).not.toContain('kind === "topic" ? "tema"');
    expect(app).toContain('<Route path="/tema/:slug/:year" element={<RedirectTopicYear to="/temak" />} />');
    expect(app).toContain('<Route path="/topic/:slug/:year" element={<RedirectTopicYear to="/temak" />} />');
    expect(analytics).toContain('return "/temak/:slug"');
    expect(live).toContain('return "/temak/:slug"');
    expect(live).not.toContain('return "/tema/:slug"');
  });

  it("keeps person topic deep-links on the canonical plural person route", () => {
    const app = read("src/App.tsx");
    const prerender = read("supabase/functions/prerender/index.ts");

    expect(app).toContain('<Route path="/szemely/:slug/temak/:topicSlug" element={<RedirectWithTwoSlugs to="/szemelyek" />} />');
    expect(app).toContain('<Route path="/person/:slug/temak/:topicSlug" element={<RedirectWithTwoSlugs to="/szemelyek" />} />');
    expect(app).toContain('<Route path="/szemelyek/:slug/temak/:topicSlug" element={<PersonDetailPage />} />');
    expect(app).not.toContain('<Route path="/person/:slug/temak/:topicSlug" element={<PersonDetailPage />} />');
    expect(prerender).toContain('parts[0] === "szemelyek" || parts[0] === "szemely" || parts[0] === "person"');
    expect(prerender).toContain('const canonical = `${SITE}/szemelyek/${personSlug}/temak/${topicSlug}`');
  });

  it("keeps organization detail links on the canonical company route", () => {
    const app = read("src/App.tsx");
    const autocomplete = read("supabase/functions/search-autocomplete/index.ts");
    const orgCard = read("src/components/OrgCard.tsx");
    const report = read("src/pages/PodcastReport2026.tsx");
    const prerender = read("supabase/functions/prerender/index.ts");

    expect(app).toContain('<Route path="/szervezetek/:slug" element={<RedirectWithSlug to="/ceg" />} />');
    expect(app).toContain('<Route path="/szervezetek/:slug/temak/:topicSlug" element={<RedirectWithTwoSlugs to="/ceg" />} />');
    expect(app).toContain('<Route path="/company/:slug/temak/:topicSlug" element={<RedirectWithTwoSlugs to="/ceg" />} />');
    expect(app).toContain('<Route path="/part/:slug/temak/:topicSlug" element={<RedirectWithTwoSlugs to="/ceg" />} />');
    expect(app).not.toContain('<Route path="/szervezetek/:slug/temak/:topicSlug" element={<EntityPage kind="company" />} />');
    expect(app).not.toContain('<Route path="/company/:slug/temak/:topicSlug" element={<EntityPage kind="company" />} />');
    expect(autocomplete).toContain("return `/ceg/${slug}`");
    expect(autocomplete).not.toContain("`/part/${slug}`");
    expect(orgCard).toContain("return `/ceg/${o.slug}`");
    expect(orgCard).not.toContain("`/part/${o.slug}`");
    expect(report).toContain("to={`/ceg/${p.slug}`}");
    expect(report).not.toContain("to={`/part/${p.slug}`}");
    expect(prerender).toContain("`${SITE}/ceg/${o.slug}`");
    expect(prerender).toContain("`${SITE}/ceg/${orgSlug}/temak/${topicSlug}`");
    expect(prerender).toContain('parts[0] === "ceg"');
    expect(prerender).toContain('parts[0] === "ceg" || parts[0] === "szervezetek" || parts[0] === "company" || parts[0] === "part"');
    expect(prerender).not.toContain("`${SITE}/szervezetek/${o.slug}`");
    expect(prerender).not.toContain("`${SITE}/szervezetek/${orgSlug}/temak/${topicSlug}`");
  });

  it("keeps smart-player related-copy human, not internal AI/vector jargon", () => {
    const related = read("src/components/smart-player/RelatedEpisodes.tsx");
    const discovery = read("src/components/smart-player/SmartDiscoveryPanel.tsx");
    const bar = read("src/components/smart-player/SmartPlayerBar.tsx");
    const similar = read("src/components/SimilarEpisodes.tsx");
    const config = read("src/components/smart-player/recommendationsConfig.ts");
    const personalizedHome = read("src/components/home/PersonalizedHomeRails.tsx");
    const episodeCard = read("src/components/EpisodeCard.tsx");

    expect(related).toContain("Tartalmi kapcsolat");
    expect(related).toContain("Keressük a kapcsolódó epizódokat");
    expect(discovery).toContain("Keressük a kapcsolódó epizódokat");
    expect(bar).toContain("Kapcsolódó epizódok és értékelés");
    expect(config).toContain("SMART_PLAYER_RECOMMENDATIONS_ENABLED = true");
    expect(similar).toContain("if (!SMART_PLAYER_RECOMMENDATIONS_ENABLED) return null");
    expect(similar).toContain("sanitizeHungarianPublicText(r.related_reason)");
    expect(episodeCard).toContain("function safeEpisodeCardPublicText");
    expect(episodeCard).toContain("const safeWhyMatched = safeEpisodeCardPublicText(e.why_matched, 12)");
    expect(episodeCard).toContain("const safeHomepageReason = safeEpisodeCardPublicText(e.homepageReason)");
    expect(episodeCard).not.toContain("{e.why_matched}");
    expect(episodeCard).not.toContain("{e.homepageReason}");
    expect(similar).not.toContain("relatedReasonFromSimilarity");
    expect(personalizedHome).toContain("A korábbi hallgatásaidhoz és érdeklődéseidhez közel álló epizódok.");
    expect(personalizedHome).not.toContain("szemantikailag");

    for (const source of [related, discovery, bar, personalizedHome]) {
      expect(source).not.toContain("AI vektor");
      expect(source).not.toContain("vektor-index");
      expect(source).not.toContain("AI ajánlások");
      expect(source).not.toContain("▶ Play");
    }
  });

  it("keeps entity pages careful about person evidence", () => {
    const entity = read("src/pages/EntityPage.tsx");
    const personDetail = read("src/pages/PersonDetailPage.tsx");
    const prerender = read("supabase/functions/prerender/index.ts");

    expect(entity).toContain("Minden magyar podcast epizód, amely ehhez kapcsolódik");
    expect(entity).toContain("Legújabb kapcsolódó epizódok");
    expect(entity).toContain("Epizódok, ahol szó esik róla");
    expect(entity).toContain("episode_id, role, confidence, source_evidence");
    expect(entity).toContain("organizationEvidenceReason");
    expect(entity).toContain("entityEvidenceReason");
    expect(entity).toContain("why_matched: organizationEvidenceReason");
    expect(entity).toContain("why_matched: entityEvidenceReason");
    expect(entity).toContain("Entitásbizonyíték:");
    expect(entity).toContain("róla vagy hozzá kapcsolódóan");
    expect(entity).not.toContain("Minden magyar podcast epizód, amiben");
    expect(entity).not.toContain("Legújabb epizódok, ahol megszólal");
    expect(entity).not.toContain("label={kind === \"person\" ? \"Megszólal\"");
    expect(entity).not.toContain("fő személyként");
    expect(entity).not.toContain("szereplőként");
    expect(personDetail).not.toContain("podcast epizódok, interjúk és említések");
    expect(personDetail).not.toContain("podcast epizódban hallható");
    expect(personDetail).toContain("kapcsolódó podcast epizód");
    expect(prerender).not.toContain("podcast epizódok és interjúk");
    expect(prerender).toContain("podcast epizódok és említések");
  });

  it("keeps SEO fallback and prerender links on canonical Hungarian routes", () => {
    const app = read("src/App.tsx");
    const notFound = read("src/pages/NotFound.tsx");
    const notFoundState = read("src/components/NotFoundState.tsx");
    const prerender = read("supabase/functions/prerender/index.ts");
    const episode = read("src/pages/EpisodeDetail.tsx");
    const searchInsights = read("src/pages/AdminSearchInsightsPage.tsx");
    const toplist = read("src/pages/ToplistaPage.tsx");
    const toplistAllTime = read("src/pages/ToplistaAllTimePage.tsx");

    expect(notFound).toContain("nav(`/kereses?q=");
    expect(notFound).not.toContain("nav(`/search?q=");
    expect(notFoundState).toContain("useNavigate");
    expect(notFoundState).toContain("nav(`/kereses?q=");
    expect(notFoundState).toContain("Keress podcastot, személyt vagy témát");
    expect(notFoundState).toContain('to="/toplista"');
    expect(notFoundState).toContain('to="/temak"');
    expect(notFoundState).not.toContain("nav(`/search?q=");
    expect(app).toContain("function RedirectPreserveSearch");
    expect(app).toContain('<Route path="/search" element={<RedirectPreserveSearch to="/kereses" />} />');
    expect(app).not.toContain('<Route path="/search" element={<SearchPage />} />');
    expect(searchInsights).toContain("/kereses?q=");
    expect(searchInsights).not.toContain("/search?q=");
    expect(prerender).toContain('href="/toplista"');
    expect(prerender).toContain("`${SITE}/toplista`");
    expect(prerender).not.toContain('href="/podcastok"');
    expect(prerender).not.toContain("`${SITE}/podcastok`");
    for (const source of [episode, prerender]) {
      expect(source).toContain("mainEntityOfPage: canonical");
      expect(source).toContain('inLanguage: "hu-HU"');
      expect(source).toContain("isAccessibleForFree: true");
    }
    expect(episode).not.toContain("url: typeof window !== \"undefined\" ? window.location.href : undefined");
    for (const source of [toplist, toplistAllTime]) {
      expect(source).toContain("setSeo({");
      expect(source).toContain('"@type": "CollectionPage"');
      expect(source).toContain('inLanguage: "hu-HU"');
      expect(source).toContain("isAccessibleForFree: true");
      expect(source).not.toContain("react-helmet-async");
      expect(source).not.toContain("<Helmet>");
      expect(source).not.toContain("/podcastok/");
    }
  });

  it("keeps public SEO surfaces behind the Hungarian text sanitizer", () => {
    const seo = read("src/lib/seo.ts");
    const podcast = read("src/pages/PodcastDetail.tsx");
    const category = read("src/pages/CategoryDetail.tsx");
    const topic = read("src/pages/TopicDetailPage.tsx");
    const search = read("src/pages/SearchPage.tsx");
    const trending = read("src/components/TrendingPodcasts.tsx");
    const episode = read("src/pages/EpisodeDetail.tsx");
    const categories = read("src/pages/CategoriesPage.tsx");
    const orgCard = read("src/components/OrgCard.tsx");
    const personCard = read("src/components/PersonCard.tsx");
    const publicProfile = read("src/pages/PublicProfilePage.tsx");

    for (const source of [podcast, category, topic, search, trending, episode, categories, orgCard, personCard, publicProfile]) {
      expect(source).toContain("sanitizeHungarianPublicText");
    }
    expect(seo).toContain("document.title = opts.title");
    expect(seo).not.toContain("document.title = opts.title.slice(0, 70)");
    expect(podcast).toContain("sanitizeHungarianPublicText(data.seo_description)");
    expect(podcast).toContain("sanitizeHungarianPublicText(data.seo_title)");
    expect(podcast).toContain("const seoTitle = `${displayName} – ${epCountLabel} · podcast | Podiverzum`");
    expect(podcast).toContain("const PODCAST_SEO_CTA = \"Hallgasd meg az összes epizódot a Podiverzumon — magyar podcast katalógus.\"");
    expect(podcast).toContain("Műsorvezető: ${hostNamesForSeo.slice(0, 3).join(\", \")}");
    expect(podcast).toContain("alternateName: alternateSeoName");
    expect(podcast).not.toContain("? (/\\|\\s*Podiverzum\\s*$/i.test(safeSeoTitle) ? safeSeoTitle");
    expect(podcast).toContain("pickEpisodeDescription(e, 220)");
    expect(podcast).toContain("${pickEpisodeDescription(e, 500)}");
    expect(podcast).toContain("id,title,display_title,slug,published_at,ai_summary,summary,description");
    expect(podcast).not.toContain("stripHtml(e.summary || \"\")");
    expect(podcast).not.toContain("snippet(stripHtml(e.summary || e.description), 220)");
    expect(category).toContain("sanitizeHungarianPublicText(c.seo_title)");
    expect(category).toContain("sanitizeHungarianPublicText(c.seo_description)");
    expect(category).toContain("slug,image_url,ai_summary,summary,description,published_at");
    expect(topic).toContain("sanitizeHungarianPublicText((t as any).seo_description)");
    expect(search).toContain("sanitizeHungarianPublicText(heroPodcast.summary)");
    expect(search).toContain("sanitizeHungarianPublicText(heroOrganization.short_bio)");
    expect(search).toContain("sanitizeHungarianPublicText(heroTopic.short_bio)");
    expect(categories).toContain("const description = sanitizeHungarianPublicText(c.description)");
    expect(trending).toContain("sanitizeHungarianPublicText(p.summary)");
    expect(orgCard).toContain("const t = sanitizeHungarianPublicText(raw)");
    expect(personCard).toContain("const contextLine = sanitizeHungarianPublicText(p.context_line)");
    expect(personCard).toContain("const identityLabel = sanitizeHungarianPublicText(p.disambiguation_label)");
    expect(episode).toContain("const description = sanitizeHungarianPublicText(e.description)");
    expect(episode).toContain("id,title,display_title,slug,image_url,published_at,ai_summary,summary,description");
    expect(episode).toContain("extractKeyMoments(sanitizeHungarianPublicText(data?.e?.description)");
    expect(episode).not.toContain("const description = stripHtml(e.description)");
    expect(publicProfile).toContain("function publicProfileText(value: unknown");
    expect(publicProfile).toContain("const seoDescription = publicProfileText");
    expect(publicProfile).toContain("const archetypeDescription = publicProfileText");
    expect(publicProfile).toContain("const archetypeTags = publicProfileTags");
    expect(publicProfile).not.toContain("archetype.result_description && <p");
    expect(publicProfile).not.toContain("{archetype.result_title}");
  });

  it("keeps public search on the accepted Hungarian catalog, not query accent language guesses", () => {
    const search = read("src/lib/search.ts");
    const searchPage = read("src/pages/SearchPage.tsx");
    const autocomplete = read("supabase/functions/search-autocomplete/index.ts");
    const suggest = read("supabase/functions/search-suggest/index.ts");

    expect(search).toContain("published_at,ai_summary,summary,description");
    expect(search).toContain('${e.ai_summary || ""} ${e.summary || ""}');
    expect(search).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
    expect(autocomplete).toContain('.eq("language_decision", "accept_hungarian")');
    expect(autocomplete).toContain('p.language_decision !== "accept_hungarian"');
    expect(suggest).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
    expect(search).toContain("accepted Hungarian podcasts");
    expect(search).toContain("ASCII Hungarian queries");
    expect(search).toContain("language_decision");
    expect(search).not.toContain('tq.like("podcasts.language"');
    expect(search).not.toContain('aq.like("podcasts.language"');
    expect(searchPage).toContain('.eq("language_decision", "accept_hungarian")');
    expect(searchPage).toContain('decision === "accept_hungarian"');
    expect(search).not.toContain("is_hungarian");
    expect(searchPage).not.toContain("is_hungarian");
    expect(search).not.toContain("is_hungarian.eq.true,language_decision.eq.accept_hungarian");
    expect(searchPage).not.toContain('.or("is_hungarian.eq.true,language_decision.eq.accept_hungarian")');
    expect(autocomplete).not.toContain('.eq("is_hungarian", true)');
    expect(autocomplete).not.toContain("podiverzum_rank,rank_label,is_hungarian,language_decision");
    expect(suggest).not.toContain("is_hungarian.eq.true,language_decision.eq.accept_hungarian");
    expect(suggest).not.toContain('language_decision !== "reject_foreign"');
    expect(searchPage).not.toContain("reject_non_hungarian");
    expect(searchPage).toContain("sanitizeHungarianPublicText(p.summary).toLowerCase()");
    expect(searchPage).toContain("function sanitizeSearchWhy(reason: unknown)");
    expect(searchPage).toContain("const safeWhy = sanitizeSearchWhy(e.why_matched)");
    expect(searchPage).toContain("why_matched: safeWhy");
  });

  it("keeps the search AI overview Hungarian, guarded, and user-facing", () => {
    const searchPage = read("src/pages/SearchPage.tsx");

    expect(searchPage).toContain("function sanitizeSearchAnswer(answer: string)");
    expect(searchPage).toContain("setAiAnswer(sanitizeSearchAnswer(acc))");
    expect(searchPage).toContain('const [degradedSearch, setDegradedSearch] = useState<"timeout" | "fallback" | null>(null)');
    expect(searchPage).toContain('setDegradedSearch((err as Error)?.message === "search_timeout" ? "timeout" : "fallback")');
    expect(searchPage).toContain("A mélyebb keresés most lassú volt");
    expect(searchPage).toContain("tartalék találati listát mutatunk");
    expect(searchPage).toContain("Találati összkép");
    expect(searchPage).toContain("Áttekintés készül a legerősebb epizódok alapján");
    expect(searchPage).toContain("Automatikus összegzés a találati lista alapján");
    expect(searchPage).not.toContain("MI-összefoglaló");
    expect(searchPage).not.toContain("MI-alapú összefoglaló");
  });

  it("keeps public podcast discovery fallbacks on the accepted Hungarian decision field", () => {
    const newest = read("src/pages/NewPodcastsPage.tsx");
    const recent = read("src/components/RecentlyAddedPodcasts.tsx");
    const notFound = read("src/pages/NotFound.tsx");
    const daily = read("src/pages/DailyBriefPage.tsx");
    const dailyExtras = read("supabase/functions/daily-brief-extras/index.ts");

    for (const source of [newest, recent, notFound]) {
      expect(source).toContain('.eq("language_decision", "accept_hungarian")');
      expect(source).not.toContain('.eq("is_hungarian", true)');
    }
    expect(daily).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
    expect(daily).not.toContain("is_hungarian");
    expect(daily).not.toContain('or("is_hungarian.eq.true,language_decision.eq.accept_hungarian"');
    expect(daily).not.toContain('language_decision !== "reject_foreign"');
    expect(dailyExtras).toContain('.eq("podcasts.language_decision", "accept_hungarian")');
    expect(dailyExtras).not.toContain("is_hungarian");
    expect(dailyExtras).not.toContain("is_hungarian.eq.true,language_decision.eq.accept_hungarian");
    expect(dailyExtras).not.toContain('language_decision !== "reject_foreign"');
  });

  it("keeps entity pages on accepted Hungarian episodes with AI-summary-aware cards", () => {
    const entity = read("src/pages/EntityPage.tsx");

    expect(entity).toContain("sanitizeHungarianPublicText");
    expect(entity).toContain("function safeEntityBio");
    expect(entity).toContain("const profileBio = safeEntityBio(prof?.bio)");
    expect(entity).toContain("description: profileBio || undefined");
    expect(entity).toContain("const profileBio = safeEntityBio(profile?.bio)");
    expect(entity).toContain("snippet(profileBio, 300)");
    expect(entity).not.toContain("snippet(profile.bio, 300)");
    expect(entity).not.toContain("description: prof?.bio || undefined");
    expect(entity).toContain("published_at,ai_summary,summary,description");
    expect(entity).toContain('ps.language_decision === "accept_hungarian"');
    expect(entity).not.toContain("ps.is_hungarian === true || ps.language_decision === \"accept_hungarian\"");
  });

  it("keeps public toplist copy Hungarian and reader-facing", () => {
    const toplist = read("src/pages/ToplistaPage.tsx");

    expect(toplist).toContain("toplista-mutató");
    expect(toplist).toContain("Friss mérés");
    expect(toplist).toContain("platformok közötti eltérések");
    expect(toplist).toContain("mutató {p.trending_score.toFixed(3)}");
    expect(toplist).not.toContain("score {p.trending_score.toFixed(3)}");
    expect(toplist).not.toContain("score = Σ 1/rank");
    expect(toplist).not.toContain("a magasabb score");
    expect(toplist).not.toContain("Friss snapshot");
    expect(toplist).not.toContain("view-delta");
    expect(toplist).not.toContain("platform-bias index");
  });

  it("keeps public podcast category labels translated from source taxonomy", () => {
    const toplist = read("src/pages/ToplistaPage.tsx");
    const myUniverse = read("src/pages/EnPodiverzumomPage.tsx");

    for (const source of [toplist, myUniverse]) {
      expect(source).toContain("categoryLabel");
      expect(source).toContain("displayCategory");
      expect(source).not.toContain("{p.category}</div>");
    }
  });

  it("keeps empty personal library states aligned with the icon system", () => {
    const myUniverse = read("src/pages/EnPodiverzumomPage.tsx");

    expect(myUniverse).toContain("<Bell className=\"h-4 w-4\" />");
    expect(myUniverse).toContain("Még nem követsz podcastot.");
    expect(myUniverse).toContain("kapcsold be a követést");
    expect(myUniverse).not.toContain("🔔");
    expect(myUniverse).not.toContain("nyomd meg a");
  });
});
