import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");
const adminPagePaths = () =>
  readdirSync(`${root}/src/pages`)
    .filter((file) => file.startsWith("Admin") && file.endsWith(".tsx"))
    .map((file) => `src/pages/${file}`);

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
    const search = read("src/lib/search.ts");

    expect(category).toContain('.eq("language_decision", "accept_hungarian")');
    expect(category).toContain("const taxKeys: string[] = Array.isArray((c as any).taxonomy_keys)");
    expect(category).toContain("const categoryKeys: string[] = Array.isArray(cat.taxonomy_keys)");
    expect(category).toContain("categoryName: cat.name, categoryKeys");
    expect(search).toContain("categoryKeys?: string[] | null");
    expect(search).toContain("function normalizedCategoryKeys");
    expect(search).toContain("function isEpisodeInCategoryKeys");
    expect(search).toContain("inCategory: isEpisodeInCategoryKeys(x.e, categoryKeys)");
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
    for (const source of [peopleHub, prerender]) {
      expect(source).not.toContain("vendégül látnak");
      expect(source).not.toContain("Vendégek és említett");
      expect(source).not.toContain("leggyakrabban szereplő <a href=\"/szemelyek\">vendégeket</a>");
    }
    expect(peopleHub).toContain("műsorvezetők, tényleges megszólalók és gyakran említett közéleti nevek");
    expect(prerender).toContain("Műsorvezetők, megszólalók és említett közéleti nevek profiljai.");
    expect(prerender).toContain("kapcsolódó <a href=\"/szemelyek\">személyeket</a>");
    expect(prerender).toContain('href: "/cegek", label: "Cégek és szervezetek"');
    expect(prerender).toContain('<a href="/cegek">szervezeteket</a>');
    expect(prerender).toContain('kapcsolódó <a href="/cegek">cégeket és intézményeket</a>');
    expect(prerender).toContain('<a href="/cegek">intézményeket és médiumokat</a>');
    expect(prerender).not.toContain('href: "/szervezetek", label: "Szervezetek"');
    expect(prerender).not.toContain('<a href="/szervezetek">szervezeteket</a>');
    expect(peopleHub).toContain("„{debouncedQ}” keresésre {totalAll.toLocaleString");
    expect(companiesHub).toContain("„{debouncedQ}” keresésre {total.toLocaleString");
    expect(partiesHub).toContain("„${debouncedQ}” keresésre");
    expect(episodeDetail).toContain("podcast epizódja — Podiverzum");
    expect(prerender).toContain("Személyek magyar podcastokban");
    expect(prerender).not.toContain("Személyek és podcastvendégek");
    expect(prerender).not.toContain("podcastvendégek és gyakran említett nevek");
    expect(prerender).toContain("`${org.name} – ${eps.length} podcast epizód ${topic.name} témában | Podiverzum`");
    expect(prerender).toContain("`${org.name} említései ${eps.length} magyar podcast epizódban ${topic.name} témában.");
    expect(prerender).toContain('name: "Cégek és szervezetek", item: `${SITE}/cegek`');
    expect(prerender).toContain("${esc(org.name)}</a> említései ${eps.length} magyar podcast epizódban");
    expect(prerender).not.toContain("${org.name} és ${topic.name} témakörben");
    expect(prerender).not.toContain("kapcsolatáról. Magyar podcastek");
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
    const prerender = read("supabase/functions/prerender/index.ts");
    const worker = read("infra/cloudflare-worker/worker.js");
    const lovableWorker = read(".lovable/cloudflare-worker.js");

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
    for (const workerSource of [worker, lovableWorker]) {
      expect(workerSource).toContain('[/^\\/category\\/([^/]+)\\/?$/, "/kategoria/$1"]');
    }
    expect(prerender).toContain('urlPrefix: string = "kategoria"');
    expect(prerender).toContain('buildCategory(supabase, parts[1], "kategoria")');
    expect(prerender).not.toContain("buildCategory(supabase, parts[1], parts[0])");
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

  it("keeps the site publisher visible with the public PREAG name and legal company data", () => {
    const publisher = read("src/lib/sitePublisher.ts");
    const index = read("index.html");
    const home = read("src/pages/Index.tsx");
    const about = read("src/pages/AboutPage.tsx");
    const terms = read("src/pages/TermsPage.tsx");
    const privacy = read("src/pages/PrivacyPage.tsx");
    const contact = read("src/pages/ContactPage.tsx");
    const footer = read("src/components/SiteFooter.tsx");
    const layout = read("src/components/Layout.tsx");
    const siteStructuredData = read("src/components/SiteStructuredData.tsx");
    const daily = read("src/pages/DailyBriefPage.tsx");
    const hetiArticle = read("src/pages/HetiArticlePage.tsx");
    const report = read("src/pages/PodcastReport2026.tsx");
    const reportMarkdown = read("public/jelentes/magyar-podcast-piac-2026.md");
    const reportJson = read("public/jelentes/magyar-podcast-piac-2026.json");
    const llms = read("public/llms.txt");
    const prerender = read("supabase/functions/prerender/index.ts");
    const worker = read("infra/cloudflare-worker/worker.js");
    const lovableWorker = read(".lovable/cloudflare-worker.js");

    for (const source of [publisher, index, llms, prerender, reportMarkdown, reportJson]) {
      expect(source).toContain("PREAG Zrt.");
      expect(source).toContain("26558534-2-13");
      expect(source).toContain("13-10-042640");
      expect(source).toContain("2636");
      expect(source).toContain("Tésa");
      expect(source).toContain("Ady Endre utca 11.");
    }

    expect(publisher).toContain("Precíziós Agrokémia Zártkörűen Működő Részvénytársaság");
    expect(publisher).toContain('id: "https://podiverzum.hu/#publisher"');
    expect(publisher).toContain('siteName: "Podiverzum.hu"');
    expect(publisher).toContain("function siteIdentityJsonLd()");
    expect(publisher).toContain('"@type": "WebSite"');
    expect(publisher).toContain('"@id": "https://podiverzum.hu/#website"');
    expect(publisher).toContain("SearchAction");
    expect(publisher).toContain("hello@podiverzum.hu");
    expect(prerender).toContain("function sitePublisherJsonLd()");
    expect(prerender).toContain("function siteIdentityJsonLd()");
    expect(prerender).toContain("[siteIdentityJsonLd(), ...opts.jsonLd]");
    expect(prerender).toContain('<meta name="publisher" content="${SITE_PUBLISHER.displayName}" />');
    expect(prerender).toContain("publisher: sitePublisherJsonLd()");
    expect(layout).toContain("<SiteStructuredData />");
    expect(siteStructuredData).toContain("siteIdentityJsonLd()");
    expect(siteStructuredData).toContain('script.dataset.seo = "site-identity"');
    expect(index).toContain('"publisher"');
    expect(index).toContain('"legalName": "Precíziós Agrokémia Zártkörűen Működő Részvénytársaság"');
    expect(home).toContain("publisher: sitePublisherJsonLd()");
    expect(daily).toContain("publisher: sitePublisherJsonLd()");
    expect(hetiArticle).toContain("publisher: sitePublisherJsonLd()");
    expect(report).toContain("publisher: sitePublisherJsonLd()");
    expect(daily).not.toContain('publisher: {\n            "@type": "Organization",\n            name: "Podiverzum"');
    expect(hetiArticle).not.toContain('publisher: {\n            "@type": "Organization",\n            name: "Podiverzum"');
    expect(report).not.toContain('publisher: { "@type": "Organization", name: "Podiverzum"');
    expect(report).toContain("publisher=PREAG Zrt.; brand=Podiverzum.hu");
    expect(reportMarkdown).toContain("**Márka / forrás:** Podiverzum.hu");
    expect(reportMarkdown).not.toContain("**Kiadó:** Podiverzum");
    expect(reportJson).toContain('"brand": "Podiverzum.hu"');
    expect(reportJson).toContain('"publisher": "PREAG Zrt."');
    expect(reportJson).not.toContain('"publisher": "Podiverzum"');
    for (const source of [worker, lovableWorker]) {
      expect(source).toContain("publisher=PREAG Zrt.; brand=Podiverzum.hu");
      expect(source).not.toContain("publisher=Podiverzum;");
    }
    expect(about).toContain("A Podiverzum kiadója");
    expect(terms).toContain("A szolgáltatás kiadója");
    expect(privacy).toContain("Adatkezelő:");
    expect(privacy).toContain("publisher: sitePublisherJsonLd()");
    expect(contact).toContain("Kiadó:");
    expect(footer).toContain("Kiadó: {SITE_PUBLISHER.displayName}");
    expect(footer).toContain("SITE_PUBLISHER.companyRegisterNumber");
    expect(footer).toContain('{ to: "/cegek", label: "Cégek és szervezetek" }');
    expect(footer).not.toContain('{ to: "/szervezetek", label: "Szervezetek" }');
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
    const prerender = read("supabase/functions/prerender/index.ts");
    const worker = read("infra/cloudflare-worker/worker.js");
    const lovableWorker = read(".lovable/cloudflare-worker.js");

    expect(entity).toContain('kind === "topic" ? "temak"');
    expect(entity).not.toContain('kind === "topic" ? "tema"');
    expect(app).toContain('<Route path="/tema/:slug/:year" element={<RedirectTopicYear to="/temak" />} />');
    expect(app).toContain('<Route path="/topic/:slug/:year" element={<RedirectTopicYear to="/temak" />} />');
    for (const workerSource of [worker, lovableWorker]) {
      expect(workerSource).toContain('[/^\\/topic\\/([^/]+)\\/(\\d{4})\\/?$/, "/temak/$1/$2"]');
      expect(workerSource).toContain('[/^\\/tema\\/([^/]+)\\/(\\d{4})\\/?$/, "/temak/$1/$2"]');
      expect(workerSource).toContain('[/^\\/topic\\/([^/]+)\\/?$/, "/temak/$1"]');
      expect(workerSource).toContain('[/^\\/tema\\/([^/]+)\\/?$/, "/temak/$1"]');
      expect(workerSource).toContain('target.replace("$1", m[1] || "").replace("$2", m[2] || "")');
    }
    expect(prerender).toContain('buildTopic(supabase, parts[1], "temak")');
    expect(prerender).not.toContain('buildTopic(supabase, parts[1], parts[0])');
    expect(analytics).toContain('return "/temak/:slug"');
    expect(live).toContain('return "/temak/:slug"');
    expect(live).not.toContain('return "/tema/:slug"');
  });

  it("keeps person topic deep-links on the canonical plural person route", () => {
    const app = read("src/App.tsx");
    const prerender = read("supabase/functions/prerender/index.ts");
    const worker = read("infra/cloudflare-worker/worker.js");
    const lovableWorker = read(".lovable/cloudflare-worker.js");

    expect(app).toContain('<Route path="/szemely/:slug/temak/:topicSlug" element={<RedirectWithTwoSlugs to="/szemelyek" />} />');
    expect(app).toContain('<Route path="/person/:slug/temak/:topicSlug" element={<RedirectWithTwoSlugs to="/szemelyek" />} />');
    expect(app).toContain('<Route path="/szemelyek/:slug/temak/:topicSlug" element={<PersonDetailPage />} />');
    expect(app).not.toContain('<Route path="/person/:slug/temak/:topicSlug" element={<PersonDetailPage />} />');
    for (const workerSource of [worker, lovableWorker]) {
      expect(workerSource).toContain('[/^\\/person\\/([^/]+)\\/temak\\/([^/]+)\\/?$/, "/szemelyek/$1/temak/$2"]');
      expect(workerSource).toContain('[/^\\/szemely\\/([^/]+)\\/temak\\/([^/]+)\\/?$/, "/szemelyek/$1/temak/$2"]');
    }
    expect(prerender).toContain('parts[0] === "szemelyek" || parts[0] === "szemely" || parts[0] === "person"');
    expect(prerender).toContain('const canonical = `${SITE}/szemelyek/${personSlug}/temak/${topicSlug}`');
    expect(prerender).toContain("témához kapcsolódik vagy említésként szerepel");
    expect(prerender).not.toContain("témáról beszél vagy említik");
    expect(prerender).toContain('buildPerson(supabase, parts[1], "szemelyek")');
    expect(prerender).not.toContain('buildPerson(supabase, parts[1], parts[0])');
  });

  it("keeps organization detail links on the canonical company route", () => {
    const app = read("src/App.tsx");
    const autocomplete = read("supabase/functions/search-autocomplete/index.ts");
    const orgCard = read("src/components/OrgCard.tsx");
    const report = read("src/pages/PodcastReport2026.tsx");
    const prerender = read("supabase/functions/prerender/index.ts");
    const worker = read("infra/cloudflare-worker/worker.js");
    const lovableWorker = read(".lovable/cloudflare-worker.js");

    expect(app).toContain('<Route path="/szervezetek" element={<Navigate to="/cegek" replace />} />');
    expect(app).toContain('<Route path="/entitasok" element={<Navigate to="/cegek" replace />} />');
    expect(app).toContain('<Route path="/szervezetek/:slug" element={<RedirectWithSlug to="/ceg" />} />');
    expect(app).toContain('<Route path="/szervezetek/:slug/temak/:topicSlug" element={<RedirectWithTwoSlugs to="/ceg" />} />');
    expect(app).toContain('<Route path="/company/:slug/temak/:topicSlug" element={<RedirectWithTwoSlugs to="/ceg" />} />');
    expect(app).toContain('<Route path="/part/:slug/temak/:topicSlug" element={<RedirectWithTwoSlugs to="/ceg" />} />');
    expect(app).not.toContain('<Route path="/szervezetek" element={<OrganizationsIndexPage />} />');
    expect(app).not.toContain('const OrganizationsIndexPage = lazy(() => import("./pages/OrganizationsIndexPage.tsx"));');
    expect(app).not.toContain('<Route path="/entitasok" element={<Navigate to="/szervezetek" replace />} />');
    expect(app).not.toContain('<Route path="/szervezetek/:slug/temak/:topicSlug" element={<EntityPage kind="company" />} />');
    expect(app).not.toContain('<Route path="/company/:slug/temak/:topicSlug" element={<EntityPage kind="company" />} />');
    expect(autocomplete).toContain("return `/ceg/${slug}`");
    expect(autocomplete).not.toContain("`/part/${slug}`");
    expect(orgCard).toContain("return `/ceg/${o.slug}`");
    expect(orgCard).not.toContain("`/part/${o.slug}`");
    expect(report).toContain("to={`/ceg/${p.slug}`}");
    expect(report).not.toContain("to={`/part/${p.slug}`}");
    expect(report).toContain('label="szervezet" link="/cegek"');
    expect(report).not.toContain('label="szervezet" link="/szervezetek"');
    for (const workerSource of [worker, lovableWorker]) {
      expect(workerSource).toContain('[/^\\/szervezetek\\/?$/, "/cegek"]');
      expect(workerSource).toContain('[/^\\/entitasok\\/?$/, "/cegek"]');
      expect(workerSource).toContain('[/^\\/company\\/([^/]+)\\/temak\\/([^/]+)\\/?$/, "/ceg/$1/temak/$2"]');
      expect(workerSource).toContain('[/^\\/szervezetek\\/([^/]+)\\/temak\\/([^/]+)\\/?$/, "/ceg/$1/temak/$2"]');
      expect(workerSource).toContain('[/^\\/part\\/([^/]+)\\/temak\\/([^/]+)\\/?$/, "/ceg/$1/temak/$2"]');
      expect(workerSource).toContain('[/^\\/cegek\\/([^/]+)\\/?$/, "/ceg/$1"]');
      expect(workerSource).toContain('[/^\\/partok\\/([^/]+)\\/?$/, "/ceg/$1"]');
      expect(workerSource).not.toContain('[/^\\/entitasok\\/?$/, "/szervezetek"]');
    }
    expect(prerender).toContain("`${SITE}/ceg/${o.slug}`");
    expect(prerender).toContain("`${SITE}/ceg/${orgSlug}/temak/${topicSlug}`");
    expect(prerender).toContain('const canonical = `${SITE}/${kind === "szervezetek" ? "cegek" : kind}`');
    expect(prerender).not.toContain('const canonical = `${SITE}/${kind === "cegek" ? "szervezetek" : kind}`');
    expect(prerender).toContain('parts[0] === "ceg"');
    expect(prerender).toContain('parts[0] === "ceg" || parts[0] === "szervezetek" || parts[0] === "company" || parts[0] === "part"');
    expect(prerender).toContain('buildOrganization(supabase, parts[1], "ceg")');
    expect(prerender).not.toContain('buildOrganization(supabase, parts[1], parts[0])');
    expect(prerender).toContain('buildLegacyEntity(supabase, enKind as any, parts[1], "hozzavalo")');
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
    expect(personalizedHome).toContain("type RecommendationDiagnostics");
    expect(personalizedHome).toContain("low_similarity?: number");
    expect(personalizedHome).toContain("missing_related_reason?: number");
    expect(personalizedHome).toContain("returned_seed_rail_count?: number");
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
    const topic = read("src/pages/TopicDetailPage.tsx");
    const prerender = read("supabase/functions/prerender/index.ts");

    expect(entity).toContain("Legújabb kapcsolódó epizódok");
    expect(entity).toContain("Epizódok, ahol szó esik róla");
    expect(entity).toContain("episode_id, role, confidence, source_evidence");
    expect(entity).toContain("organizationEvidenceReason");
    expect(entity).toContain("entityEvidenceReason");
    expect(entity).toContain("function entityFallbackIntro");
    expect(entity).toContain("const [totalMatchCount, setTotalMatchCount] = useState(0)");
    expect(entity).toContain("setTotalMatchCount(visible.length)");
    expect(entity).toContain("const total = totalMatchCount || eps.length");
    expect(entity).toContain("const fallbackIntro = entityFallbackIntro(kind, displayName, total, distinctPodcastCount)");
    expect(entity).toContain("why_matched: organizationEvidenceReason");
    expect(entity).toContain("why_matched: entityEvidenceReason");
    expect(entity).toContain("Entitásbizonyíték:");
    expect(entity).toContain("róla vagy hozzá kapcsolódóan");
    expect(entity).not.toContain("Minden magyar podcast epizód, amely ehhez kapcsolódik");
    expect(entity).not.toContain("Minden magyar podcast epizód, amiben");
    expect(entity).not.toContain("Legújabb epizódok, ahol megszólal");
    expect(entity).not.toContain("label={kind === \"person\" ? \"Megszólal\"");
    expect(entity).not.toContain("fő személyként");
    expect(entity).not.toContain("szereplőként");
    expect(personDetail).not.toContain("podcast epizódok, interjúk és említések");
    expect(personDetail).not.toContain("podcast epizódban hallható");
    expect(personDetail).toContain("const hasParticipantSeoEvidence = epList.some((e) => e.role_type === \"participant\")");
    expect(personDetail).toContain("const personSeoRelation = hasParticipantSeoEvidence && !isTemporalTopicOnlyPerson(p) ? \"hallható\" : \"kapcsolódik\"");
    expect(personDetail).toContain("` – ${epCount} podcast epizódban ${personSeoRelation}`");
    expect(personDetail).toContain("kapcsolódó magyar podcast epizód");
    expect(personDetail).toContain("safePersonSeoLead(p) || safeDesc");
    expect(entity).toContain("const companyEpLabel = total > 0 ? ` – ${total} podcast epizódban említve` : \"\"");
    expect(topic).toContain("const titleSource = `${topicName}${countLabel} magyar podcastokból | Podiverzum`");
    expect(topic).toContain("function topicFallbackIntro");
    expect(topic).toContain("function topicIntroText");
    expect(topic).toContain("const introText = topicIntroText(topic)");
    expect(topic).toContain("{introText && (");
    expect(topic).not.toContain("{topic.intro_text && (");
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
    const startSwipe = read("src/pages/StartSwipePage.tsx");

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
    expect(app).toContain('<Route path="/vibe" element={<RedirectPreserveSearch to="/te-podiverzumod" />} />');
    expect(app).not.toContain('<Route path="/vibe" element={<StartSwipePage />} />');
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
    expect(startSwipe).toContain('title: "A Te Podiverzumod – podcast ízlésprofil | Podiverzum"');
    expect(startSwipe).toContain('canonical: "https://podiverzum.hu/te-podiverzumod"');
    expect(startSwipe).toContain('"@type": "WebApplication"');
    expect(startSwipe).toContain("isAccessibleForFree: true");
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
    const person = read("src/pages/PersonDetailPage.tsx");
    const entity = read("src/pages/EntityPage.tsx");
    const search = read("src/pages/SearchPage.tsx");
    const trending = read("src/components/TrendingPodcasts.tsx");
    const episode = read("src/pages/EpisodeDetail.tsx");
    const categories = read("src/pages/CategoriesPage.tsx");
    const orgCard = read("src/components/OrgCard.tsx");
    const personCard = read("src/components/PersonCard.tsx");
    const publicProfile = read("src/pages/PublicProfilePage.tsx");
    const prerender = read("supabase/functions/prerender/index.ts");

    for (const source of [podcast, category, topic, person, entity, search, trending, episode, categories, orgCard, personCard, publicProfile]) {
      expect(source).toContain("sanitizeHungarianPublicText");
    }
    expect(seo).toContain("document.title = opts.title");
    expect(seo).not.toContain("document.title = opts.title.slice(0, 70)");
    expect(podcast).toContain("sanitizeHungarianPublicText(data.seo_description)");
    expect(podcast).toContain("sanitizeHungarianPublicText(data.seo_title)");
    expect(podcast).toContain("const seoTitle = `${displayName} – ${epCountLabel} · podcast | Podiverzum`");
    expect(podcast).toContain("const PODCAST_SEO_CTA = \"Hallgasd meg az összes epizódot a Podiverzumon — magyar podcast katalógus.\"");
    expect(podcast).toContain("function podcastSeoDescription(baseDesc: string, entityLines: string[]): string");
    expect(podcast).toContain("PODCAST_SEO_DESCRIPTION_MAX - ctaBudget");
    expect(podcast).toContain("Műsorvezető: ${hostNamesForSeo.slice(0, 3).join(\", \")}");
    expect(podcast).toContain("const topOrganizationNamesForSeo = topEntitiesFrom(allEps, \"companies\", \"company\", 3)");
    expect(podcast).toContain("Gyakori szervezet: ${topOrganizationNamesForSeo.slice(0, 2).join(\", \")}");
    expect(podcast).toContain("const seoDescription = podcastSeoDescription(baseDesc, [hostLine, organizationLine])");
    expect(podcast).toContain("alternateName: alternateSeoName");
    expect(podcast).not.toContain("? (/\\|\\s*Podiverzum\\s*$/i.test(safeSeoTitle) ? safeSeoTitle");
    expect(prerender).toContain("const PODCAST_SEO_CTA = \"Hallgasd meg az összes epizódot a Podiverzumon — magyar podcast katalógus.\"");
    expect(prerender).toContain("function podcastSeoDescription(baseDesc: string, entityLines: string[]): string");
    expect(prerender).toContain("if (!pod || !isAcceptedHungarianPrerenderPodcast(pod)) return null");
    expect(prerender).toContain("select(\"id\", { count: \"exact\", head: true })");
    expect(prerender).toContain("const title = `${displayName} – ${epCount} epizód · podcast | Podiverzum`");
    expect(prerender).toContain("Gyakori szervezet: ${topOrganizationNamesForSeo.join(\", \")}");
    expect(prerender).toContain("const desc = podcastSeoDescription(baseDesc, [organizationLine])");
    expect(prerender).toContain("numberOfEpisodes: epCount || undefined");
    expect(prerender).not.toContain("const title = pod.seo_title || `${pod.display_title || pod.title} — Podiverzum`");
    expect(podcast).toContain("pickEpisodeDescription(e, 220)");
    expect(podcast).toContain("${pickEpisodeDescription(e, 500)}");
    expect(podcast).toContain("id,title,display_title,slug,published_at,ai_summary,summary,description");
    expect(podcast).not.toContain("stripHtml(e.summary || \"\")");
    expect(podcast).not.toContain("snippet(stripHtml(e.summary || e.description), 220)");
    expect(category).toContain("sanitizeHungarianPublicText(c.seo_title)");
    expect(category).toContain("sanitizeHungarianPublicText(c.seo_description)");
    expect(category).toContain("slug,image_url,ai_summary,summary,description,published_at");
    expect(prerender).toContain("seo_title, seo_description, taxonomy_keys");
    expect(prerender).toContain("const taxKeys = Array.isArray((cat as any).taxonomy_keys)");
    expect(prerender).toContain(".in(\"category\", taxKeys)");
    expect(prerender).toContain("const podcastIds = list.map((p) => p.id).filter(Boolean).slice(0, 50)");
    expect(prerender).toContain(".from(\"episodes\")");
    expect(prerender).toContain("Friss epizódok");
    expect(prerender).toContain("<h2>Podcastok</h2>");
    expect(prerender).toContain("const title = cat.seo_title || `${cat.name} podcastok és epizódok — Podiverzum`");
    expect(prerender).toContain("Válogatás a legjobb ${cat.name} podcast epizódokból.");
    expect(prerender).not.toContain("<main><h2>Podcastek</h2>");
    expect(prerender).not.toContain("const title = cat.seo_title || `${cat.name} podcastek — Podiverzum`");
    expect(topic).toContain("sanitizeHungarianPublicText((t as any).seo_description)");
    expect(topic).toContain("const titleSource = `${topicName}${countLabel} magyar podcastokból | Podiverzum`");
    expect(topic).toContain("topicFallbackIntro(topic.name");
    expect(prerender).toContain("const title = `${topic.name}${countLabel} magyar podcastokból | Podiverzum`");
    expect(prerender).toContain("const title = `${topic.name} – ${eps.length} podcast epizód ${year}-ból | Podiverzum`");
    expect(prerender).toContain("`${topic.name} témájú magyar podcast epizódok ${year}-ból: ${eps.length} releváns találat");
    expect(prerender).toContain("${eps.length} magyar podcast epizód <strong>${year}</strong>-ból");
    expect(prerender).toContain("const title = `${podTitle} – ${eps.length} epizód ${year}-ból · podcast | Podiverzum`");
    expect(prerender).toContain("`${podTitle} ${year}-ben megjelent ${eps.length} podcast epizódja");
    expect(prerender).toContain("`${topic.name} témában ${epCount > 0 ? `${epCount} magyar podcast epizód` : \"magyar podcast epizódok\"}");
    expect(prerender).not.toContain("const title = topic.seo_title || `${topic.name} — epizódok a Podiverzumon`");
    expect(prerender).not.toContain("const title = `${topic.name} ${year} — epizódok a Podiverzumon`");
    expect(prerender).not.toContain("const title = `${podTitle} epizódok ${year} — Podiverzum`");
    expect(person).toContain("const personSeoRelation = hasParticipantSeoEvidence && !isTemporalTopicOnlyPerson(p) ? \"hallható\" : \"kapcsolódik\"");
    expect(person).toContain("` – ${epCount} podcast epizódban ${personSeoRelation}`");
    expect(person).toContain("Megnézhető ${epCount} podcast epizód, amelyben ${personName} ${personSeoRelation}.");
    expect(person).toContain("const fallbackDescriptionRelation = \"említve szerepel\"");
    expect(person).toContain("`${exemplar} – ${fallbackEpCount} podcast epizódban ${fallbackRelation} | Podiverzum`");
    expect(prerender).toContain("const relation = !historicalWithoutEvidence");
    expect(prerender).toContain("function safePersonSeoLeadForPrerender");
    expect(prerender).toContain("overview_text, short_description_hu");
    expect(prerender).toContain("const seoLead = safePersonSeoLeadForPrerender(person) || firstSeoSentence(bio)");
    expect(prerender).toContain("const desc = seoLead");
    expect(prerender).toContain("`${seoLead}${epCount > 0 ? ` Megnézhető ${epCount} podcast epizód, amelyben ${person.name} ${relation}.` : \"\"}`");
    expect(prerender).toContain("`Megnézhető ${epCount} podcast epizód, amelyben ${person.name} ${relation}.");
    expect(prerender).toContain("`${person.name} – ${epCount} podcast epizódban ${relation} | Podiverzum`");
    expect(prerender).not.toContain("const title = `${person.name} podcast epizódok és említések | Podiverzum`");
    expect(entity).toContain("kind === \"company\" ? `${finalName}${companyEpLabel || epLabel} | Podiverzum`");
    expect(entity).toContain("fallbackCompany");
    expect(prerender).toContain("const companyEpLabel = epCount > 0 ? ` – ${epCount} podcast epizódban említve` : \"\"");
    expect(prerender).toContain("const title = `${org.name}${companyEpLabel || \" podcast említések\"} | Podiverzum`");
    expect(prerender).toContain("`${org.name} említései ${epCount > 0 ? `${epCount} ` : \"\"}magyar podcast epizódban.");
    expect(prerender).not.toContain("const title = `${org.name} podcast említések | Podiverzum`");
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
    expect(prerender).toContain("language_decision, rss_status");
    expect(prerender).toContain("const isAcceptedHungarian = isAcceptedHungarianPrerenderPodcast(pod)");
    expect(prerender).toContain("const title = safeSeoTitle || `${ep.display_title || ep.title} — ${pod.display_title || pod.title} | Podiverzum`");
    expect(prerender).toContain("jsonLd: isAcceptedHungarian ? [ld, breadcrumbs] : []");
    expect(prerender).toContain("noindex: !isAcceptedHungarian");
    expect(prerender).not.toContain("const title = ep.seo_title || `${ep.display_title || ep.title} — ${pod.display_title || pod.title}`");
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
    const supabaseTypes = read("src/integrations/supabase/types.ts");
    const adminInsights = read("src/pages/AdminSearchInsightsPage.tsx");

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
    expect(searchPage).toContain("const [timestampMatchCount, setTimestampMatchCount] = useState(0)");
    expect(searchPage).toContain("Number.isFinite(Number(e.chunk_match?.timestamp_start_seconds))");
    expect(searchPage).toContain("timestamp_match_count:");
    expect(searchPage).toContain("chunk_augmented_count:");
    expect(searchPage).toContain("időpontos találat");
    expect(supabaseTypes).toContain("timestamp_match_count: number");
    expect(supabaseTypes).toContain("chunk_augmented_count: number");
    expect(supabaseTypes).toContain("content_snippet: string");
    expect(supabaseTypes).toContain("semantic_used: boolean | null");
    expect(supabaseTypes).toContain("catalog_anchors: Json");
    expect(searchPage).toContain('supabase.from("search_events").insert({');
    expect(searchPage).not.toContain("} as any).then(() => {}, () => {})");
    expect(adminInsights).toContain('await supabase\n          .from("search_events")');
    expect(adminInsights).toContain('import type { Database } from "@/integrations/supabase/types"');
    expect(adminInsights).toContain('type SearchEvent = Database["public"]["Tables"]["search_events"]["Row"]');
    expect(adminInsights).toContain("type Row = Pick<SearchEvent");
    expect(adminInsights).toContain("type QueryStatsRow =");
    expect(adminInsights).toContain("const transcriptCoverageGaps = top");
    expect(adminInsights).toContain("x.timestamped === 0 && x.chunkAugmented === 0");
    expect(adminInsights).toContain("const copyTranscriptCoverageGaps = async () =>");
    expect(adminInsights).toContain("async function copyText(text: string): Promise<boolean>");
    expect(adminInsights).toContain('document.createElement("textarea")');
    expect(adminInsights).toContain('document.execCommand("copy")');
    expect(adminInsights).toContain('setCopyState(ok ? "copied" : "error")');
    expect(adminInsights).toContain("Copy failed");
    expect(adminInsights).toContain("Copy backlog");
    expect(adminInsights).toContain("Transcript coverage gaps");
    expect(adminInsights).toContain('await supabase.rpc("has_role"');
    expect(adminInsights).not.toContain('(supabase as any).rpc("has_role"');
  });

  it("keeps admin has_role checks on generated Supabase RPC types", () => {
    for (const path of adminPagePaths()) {
      const source = read(path);
      expect(source, path).not.toContain('(supabase as any).rpc("has_role"');
    }
  });

  it("keeps generated admin status RPCs on typed Supabase calls", () => {
    const cronStatus = read("src/pages/AdminCronStatusPage.tsx");
    const formulaC = read("src/components/admin/FormulaCRunnerPanel.tsx");

    expect(cronStatus).toContain('await supabase.rpc("get_cron_health")');
    expect(cronStatus).not.toContain('(supabase as any).rpc("get_cron_health"');
    expect(formulaC).toContain('await supabase.rpc("formula_c_status")');
    expect(formulaC).not.toContain('supabase.rpc("formula_c_status" as any)');
  });

  it("keeps generated recommendation and telemetry RPCs on typed Supabase calls", () => {
    const similarPodcasts = read("src/components/SimilarPodcasts.tsx");
    const similarEpisodes = read("src/components/SimilarEpisodes.tsx");
    const redditBot = read("src/pages/AdminRedditBotPage.tsx");
    const personQuality = read("src/pages/AdminPersonQualityReviewPage.tsx");
    const pageViewTracker = read("src/components/PageViewTracker.tsx");

    expect(similarPodcasts).toContain('rpc("get_similar_podcasts_by_embedding"');
    expect(similarPodcasts).not.toContain('rpc("get_similar_podcasts_by_embedding" as any');
    expect(similarEpisodes).toContain('rpc("get_related_episodes_by_embedding"');
    expect(similarEpisodes).not.toContain('rpc("get_related_episodes_by_embedding" as any');
    expect(redditBot).toContain('await supabase.rpc("refresh_reddit_name_index")');
    expect(redditBot).not.toContain('(supabase as any).rpc("refresh_reddit_name_index"');
    expect(personQuality).toContain('await supabase.rpc("refresh_person_activation_status")');
    expect(personQuality).not.toContain('(supabase as any).rpc("refresh_person_activation_status"');
    expect(pageViewTracker).toContain('supabase.rpc("update_page_event_dwell"');
    expect(pageViewTracker).not.toContain('(supabase as any).rpc("update_page_event_dwell"');
  });

  it("keeps search benchmark golden refresh typed and coverage-visible", () => {
    const benchmark = read("src/pages/AdminSearchBenchmarkPage.tsx");
    const supabaseTypes = read("src/integrations/supabase/types.ts");

    expect(benchmark).toContain('import type { Database, Json } from "@/integrations/supabase/types"');
    expect(benchmark).toContain('type Golden = Database["public"]["Tables"]["search_golden_queries"]["Row"]');
    expect(benchmark).toContain('type Run = Database["public"]["Tables"]["search_benchmark_runs"]["Row"]');
    expect(benchmark).toContain('type BenchmarkResult = Database["public"]["Tables"]["search_benchmark_results"]["Row"]');
    expect(benchmark).toContain('type CompetitorResult = Database["public"]["Tables"]["search_benchmark_competitors"]["Row"]');
    expect(benchmark).toContain("type SearchHybridResponse = {");
    expect(benchmark).toContain("function asSearchHybridResponse(value: unknown): SearchHybridResponse");
    expect(benchmark).toContain("chunk_match?: TopResult[\"chunk_match\"]");
    expect(benchmark).toContain("content_snippet?: string | null");
    expect(benchmark).toContain("similarity?: number | null");
    expect(benchmark).toContain("chunk_augmented?: number | null");
    expect(benchmark).toContain("timestamp_match_count: number");
    expect(benchmark).toContain("chunk_augmented_count: number");
    expect(benchmark).toContain("function asChunkMatch(value: Json | undefined): TopResult[\"chunk_match\"]");
    expect(benchmark).toContain("content_snippet: typeof value.content_snippet === \"string\" ? value.content_snippet : null");
    expect(benchmark).toContain("similarity: finiteJsonNumber(value.similarity)");
    expect(benchmark).toContain("content_snippet: typeof e.chunk_match.content_snippet === \"string\" ? e.chunk_match.content_snippet : null");
    expect(benchmark).toContain("score: Number.isFinite(Number(e.chunk_match.similarity)) ? Number(e.chunk_match.similarity) : Number.isFinite(Number(e.chunk_match.score)) ? Number(e.chunk_match.score) : null");
    expect(benchmark).toContain("chunk_match: asChunkMatch(item.chunk_match)");
    expect(benchmark).toContain("<span className=\"font-medium text-foreground/80\">Transcript:</span>");
    expect(benchmark).toContain("function timestampStatsFromResults(rows: ResultRow[])");
    expect(benchmark).toContain("function formatSeconds(seconds: number | null | undefined)");
    expect(benchmark).toContain("Timestamp hits");
    expect(benchmark).toContain("Chunk augmented");
    expect(benchmark).toContain("transcript @{timestamp}");
    expect(benchmark).toContain("type EntityMonitoringCoverage = {");
    expect(benchmark).toContain("function coverageFromProgress(progress: RunnerProgress | null): EntityMonitoringCoverage | null");
    expect(benchmark).toContain('supabase.functions.invoke("search-golden-refresh"');
    expect(benchmark).toContain("Entity monitoring coverage");
    expect(benchmark).toContain("active_entity_goldens");
    expect(benchmark).toContain("function toResultRow(row: BenchmarkResult): ResultRow");
    expect(benchmark).toContain("function toCompetitorRow(row: CompetitorResult): CompetitorRow");
    expect(benchmark).not.toContain("type Golden = {");
    expect(benchmark).not.toContain("type Run = {");
    expect(benchmark).not.toContain("top_results: any[]");
    expect(benchmark).not.toContain("useState<any[]>([])");
    expect(benchmark).not.toContain("map((t: any");
    expect(benchmark).not.toContain("(r.data[0] as any).id");
    expect(benchmark).not.toContain("(runIns as any).id");
    expect(benchmark).not.toContain("(r as any).false_positive_rate");
    expect(benchmark).not.toContain("import.meta as any");
    expect(benchmark).not.toContain("Promise<{ data: any; status: number }>");
    expect(benchmark).not.toContain("let lastErr: any");
    expect(benchmark).toContain("import.meta.env.VITE_SUPABASE_URL");
    expect(benchmark).toContain("import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY");
    expect(supabaseTypes).toContain("refresh_search_golden_queries_from_catalog");
    expect(supabaseTypes).toContain("refresh_search_golden_queries_from_external_demand");
    expect(benchmark).toContain('supabase.functions.invoke("search-golden-refresh"');
    expect(benchmark).toContain('body: { trigger: "admin_search_benchmark_page" }');
    expect(benchmark).not.toContain('supabase.rpc("refresh_search_golden_queries_from_catalog"');
    expect(benchmark).not.toContain('supabase.rpc("refresh_search_golden_queries_from_external_demand"');
    expect(benchmark).not.toContain('(supabase as any).rpc("refresh_search_golden_queries_from_catalog"');
    expect(benchmark).not.toContain('(supabase as any).rpc("refresh_search_golden_queries_from_external_demand"');
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
