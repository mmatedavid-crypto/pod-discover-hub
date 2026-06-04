import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes, Navigate, useParams } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

// Permanent redirect that carries the :slug URL param to a new base path.
// Used to fold legacy entity URLs (/szemely/:slug, /person/:slug) into the
// canonical PersonDetailPage at /szemelyek/:slug.
function RedirectWithSlug({ to }: { to: string }) {
  const { slug = "" } = useParams();
  return <Navigate to={`${to}/${slug}`} replace />;
}
function RedirectWithTwoSlugs({ to }: { to: string }) {
  const { slug = "", topicSlug = "" } = useParams();
  return <Navigate to={`${to}/${slug}/temak/${topicSlug}`} replace />;
}
import PageViewTracker from "./components/PageViewTracker.tsx";
import { SearchHotkey } from "./components/SearchHotkey.tsx";
import { SmartPlayerProvider } from "./components/smart-player/SmartPlayerProvider";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

const Index = lazy(() => import("./pages/Index.tsx"));
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const StartSwipePage = lazy(() => import("./pages/StartSwipePage.tsx"));
const StartLandingPage = lazy(() => import("./pages/StartLandingPage.tsx"));
const TePodiverzumodSharePage = lazy(() => import("./pages/TePodiverzumodSharePage.tsx"));
const ListenerProfilePage = lazy(() => import("./pages/ListenerProfilePage.tsx"));
const CategoriesPage = lazy(() => import("./pages/CategoriesPage.tsx"));
const CategoryDetail = lazy(() => import("./pages/CategoryDetail.tsx"));
const PodcastDetail = lazy(() => import("./pages/PodcastDetail.tsx"));
const EpisodeDetail = lazy(() => import("./pages/EpisodeDetail.tsx"));
const SearchPage = lazy(() => import("./pages/SearchPage.tsx"));
const AuthPage = lazy(() => import("./pages/AuthPage.tsx"));
const AdminPage = lazy(() => import("./pages/AdminPage.tsx"));
const AdminHubPage = lazy(() => import("./pages/AdminHubPage.tsx"));
const AdminDiscoveryPage = lazy(() => import("./pages/AdminDiscoveryPage.tsx"));
const AdminGrowthPage = lazy(() => import("./pages/AdminGrowthPage.tsx"));
const AdminAutopilotPage = lazy(() => import("./pages/AdminAutopilotPage.tsx"));
const AdminQueuePage = lazy(() => import("./pages/AdminQueuePage.tsx"));
const GrowthStatusPage = lazy(() => import("./pages/GrowthStatusPage.tsx"));
const EntityPage = lazy(() => import("./pages/EntityPage.tsx"));
const AdminFeedbackPage = lazy(() => import("./pages/AdminFeedbackPage.tsx"));
const AdminSearchInsightsPage = lazy(() => import("./pages/AdminSearchInsightsPage.tsx"));
const AdminAnalyticsPage = lazy(() => import("./pages/AdminAnalyticsPage.tsx"));
const AdminAiEnrichmentPage = lazy(() => import("./pages/AdminAiEnrichmentPage.tsx"));
const AdminCronStatusPage = lazy(() => import("./pages/AdminCronStatusPage.tsx"));
const AdminPipelineWatchdogPage = lazy(() => import("./pages/AdminPipelineWatchdogPage.tsx"));
const AdminQueueHealthPage = lazy(() => import("./pages/AdminQueueHealthPage.tsx"));
const AdminRedditBotPage = lazy(() => import("./pages/AdminRedditBotPage.tsx"));
const AdminSocialPostsPage = lazy(() => import("./pages/AdminSocialPostsPage.tsx"));
const AdminEditorialPage = lazy(() => import("./pages/AdminEditorialPage.tsx"));
const AdminLivePage = lazy(() => import("./pages/AdminLivePage.tsx"));
const AdminPiBackfillPage = lazy(() => import("./pages/AdminPiBackfillPage.tsx"));
const AdminArchiveBackfillPage = lazy(() => import("./pages/AdminArchiveBackfillPage.tsx"));
const AdminHostsPage = lazy(() => import("./pages/AdminHostsPage.tsx"));
const AdminLanguageGatePage = lazy(() => import("./pages/AdminLanguageGatePage.tsx"));
const AdminHuFormulaShadowPage = lazy(() => import("./pages/AdminHuFormulaShadowPage.tsx"));
const AdminPersonQualityReviewPage = lazy(() => import("./pages/AdminPersonQualityReviewPage.tsx"));
const AdminVectorSearchPage = lazy(() => import("./pages/AdminVectorSearchPage.tsx"));
const AdminSearchBenchmarkPage = lazy(() => import("./pages/AdminSearchBenchmarkPage.tsx"));
const AdminDataCoveragePage = lazy(() => import("./pages/AdminDataCoveragePage.tsx"));
const AdminOutreachPage = lazy(() => import("./pages/AdminOutreachPage.tsx"));
const AdminIntelligenceAuditPage = lazy(() => import("./pages/AdminIntelligenceAuditPage.tsx"));
const PeopleHubPage = lazy(() => import("./pages/PeopleHubPage.tsx"));
const PersonDetailPage = lazy(() => import("./pages/PersonDetailPage.tsx"));
const TopicsHubPage = lazy(() => import("./pages/TopicsHubPage.tsx"));
const TopicDetailPage = lazy(() => import("./pages/TopicDetailPage.tsx"));
const OrganizationsIndexPage = lazy(() => import("./pages/OrganizationsIndexPage.tsx"));
const CompaniesHubPage = lazy(() => import("./pages/CompaniesHubPage.tsx"));
const PodcastReport2026 = lazy(() => import("./pages/PodcastReport2026.tsx"));
const PartiesHubPage = lazy(() => import("./pages/PartiesHubPage.tsx"));
const ToplistaPage = lazy(() => import("./pages/ToplistaPage.tsx"));
const IntelligencePage = lazy(() => import("./pages/IntelligencePage.tsx"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage.tsx"));
const TermsPage = lazy(() => import("./pages/TermsPage.tsx"));
const MoodCollectionPage = lazy(() => import("./pages/MoodCollectionPage.tsx"));
const AboutPage = lazy(() => import("./pages/AboutPage.tsx"));
const MethodologyPage = lazy(() => import("./pages/MethodologyPage.tsx"));
const NewPodcastsPage = lazy(() => import("./pages/NewPodcastsPage.tsx"));
const DailyBriefPage = lazy(() => import("./pages/DailyBriefPage.tsx"));
const HetiHubPage = lazy(() => import("./pages/HetiHubPage.tsx"));
const HetiArticlePage = lazy(() => import("./pages/HetiArticlePage.tsx"));
const HetiLegacyRedirect = lazy(() => import("./pages/HetiLegacyRedirect.tsx"));
const ContactPage = lazy(() => import("./pages/ContactPage.tsx"));
const MoodsPage = lazy(() => import("./pages/MoodsPage.tsx"));
const EnPodiverzumomPage = lazy(() => import("./pages/EnPodiverzumomPage.tsx"));
const PublicProfilePage = lazy(() => import("./pages/PublicProfilePage.tsx"));
const SmartPlayerBar = lazy(() => import("./components/smart-player/SmartPlayerBar").then((m) => ({ default: m.SmartPlayerBar })));

const queryClient = new QueryClient();

function RouteLoading() {
  return (
    <div className="min-h-[40vh] px-4 py-10">
      <div className="mx-auto h-2 w-28 overflow-hidden rounded-full bg-muted">
        <div className="h-full w-1/2 animate-pulse rounded-full bg-primary/70" />
      </div>
    </div>
  );
}

const App = () => (
  <AppErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <SmartPlayerProvider>

        <PageViewTracker />
        <SearchHotkey />
        <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/start" element={<StartLandingPage />} />
          <Route path="/vibe" element={<StartSwipePage />} />
          <Route path="/te-podiverzumod" element={<StartSwipePage />} />
          <Route path="/te-podiverzumod/eredmeny/:slug" element={<TePodiverzumodSharePage />} />
          <Route path="/hallgatoi-profil/:shareId" element={<ListenerProfilePage />} />
          <Route path="/kategoriak" element={<CategoriesPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/kategoria/:slug" element={<CategoryDetail />} />
          <Route path="/category/:slug" element={<CategoryDetail />} />
          <Route path="/podcast/:podcastSlug" element={<PodcastDetail />} />
          <Route path="/podcast/:podcastSlug/:episodeSlug" element={<EpisodeDetail />} />
          {/* Wave 3 long-tail: /podcast/:slug/epizodok/:year — humans get the podcast page */}
          <Route path="/podcast/:podcastSlug/epizodok/:year" element={<PodcastDetail />} />
          <Route path="/kereses" element={<SearchPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/belepes" element={<AuthPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/admin" element={<AdminHubPage />} />
          <Route path="/admin/podcasts" element={<AdminPage />} />
          
          <Route path="/admin/discovery" element={<AdminDiscoveryPage />} />
          <Route path="/admin/growth" element={<AdminGrowthPage />} />
          <Route path="/admin/autopilot" element={<AdminAutopilotPage />} />
          <Route path="/admin/queue" element={<AdminQueuePage />} />
          <Route path="/admin/feedback" element={<AdminFeedbackPage />} />
          <Route path="/admin/search-insights" element={<AdminSearchInsightsPage />} />
          <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
          <Route path="/admin/ai-enrichment" element={<AdminAiEnrichmentPage />} />
          <Route path="/admin/cron-status" element={<AdminCronStatusPage />} />
          <Route path="/admin/pipeline-watchdog" element={<AdminPipelineWatchdogPage />} />
          <Route path="/admin/queue-health" element={<AdminQueueHealthPage />} />
          <Route path="/admin/reddit-bot" element={<AdminRedditBotPage />} />
          <Route path="/admin/social" element={<AdminSocialPostsPage />} />
          <Route path="/admin/editorial" element={<AdminEditorialPage />} />
          <Route path="/admin/live" element={<AdminLivePage />} />
          <Route path="/admin/pi-backfill" element={<AdminPiBackfillPage />} />
          <Route path="/admin/archive-backfill" element={<AdminArchiveBackfillPage />} />
          <Route path="/admin/hosts" element={<AdminHostsPage />} />
          <Route path="/admin/language-gate" element={<AdminLanguageGatePage />} />
          <Route path="/admin/hu-formula-shadow" element={<AdminHuFormulaShadowPage />} />
          <Route path="/admin/person-quality-review" element={<AdminPersonQualityReviewPage />} />
          <Route path="/admin/vector-search" element={<AdminVectorSearchPage />} />
          <Route path="/admin/search-benchmark" element={<AdminSearchBenchmarkPage />} />
          <Route path="/admin/data-coverage" element={<AdminDataCoveragePage />} />
          <Route path="/admin/intelligence-audit" element={<AdminIntelligenceAuditPage />} />
          <Route path="/admin/outreach" element={<AdminOutreachPage />} />
          
          <Route path="/growth-status" element={<GrowthStatusPage />} />
          <Route path="/tema/:slug" element={<RedirectWithSlug to="/temak" />} />
          <Route path="/topic/:slug" element={<RedirectWithSlug to="/temak" />} />
          <Route path="/szemely/:slug" element={<RedirectWithSlug to="/szemelyek" />} />
          <Route path="/person/:slug" element={<RedirectWithSlug to="/szemelyek" />} />
          <Route path="/ceg/:slug" element={<EntityPage kind="company" />} />
          <Route path="/ceg/:slug/temak/:topicSlug" element={<EntityPage kind="company" />} />
          <Route path="/company/:slug" element={<RedirectWithSlug to="/ceg" />} />
          <Route path="/ticker/:slug" element={<EntityPage kind="ticker" />} />
          <Route path="/hozzavalo/:slug" element={<EntityPage kind="ingredient" />} />
          <Route path="/ingredient/:slug" element={<RedirectWithSlug to="/hozzavalo" />} />
          <Route path="/adatvedelem" element={<PrivacyPage />} />
          <Route path="/privacy" element={<Navigate to="/adatvedelem" replace />} />
          <Route path="/feltetelek" element={<TermsPage />} />
          <Route path="/terms" element={<Navigate to="/feltetelek" replace />} />
          <Route path="/hangulatok/:slug" element={<MoodCollectionPage />} />
          <Route path="/moods/:slug" element={<RedirectWithSlug to="/hangulatok" />} />
          <Route path="/hangulat/:slug" element={<RedirectWithSlug to="/hangulatok" />} />
          <Route path="/mood/:slug" element={<RedirectWithSlug to="/hangulatok" />} />
          
          <Route path="/rolunk" element={<AboutPage />} />
          <Route path="/about" element={<Navigate to="/rolunk" replace />} />
          <Route path="/modszertan" element={<MethodologyPage />} />
          <Route path="/methodology" element={<Navigate to="/modszertan" replace />} />
          <Route path="/uj-podcastok" element={<NewPodcastsPage />} />
          <Route path="/uj" element={<Navigate to="/uj-podcastok" replace />} />
          <Route path="/new" element={<Navigate to="/uj-podcastok" replace />} />
          <Route path="/podcastok" element={<Navigate to="/toplista" replace />} />
          <Route path="/napi" element={<DailyBriefPage />} />
          <Route path="/mai-valogatas" element={<Navigate to="/napi" replace />} />
          <Route path="/daily" element={<Navigate to="/napi" replace />} />
          <Route path="/heti" element={<HetiHubPage />} />
          <Route path="/heti/:slug" element={<HetiArticlePage />} />
          {/* Legacy redirects → /heti */}
          <Route path="/heti-valogatas" element={<HetiLegacyRedirect />} />
          <Route path="/heti-valogatas/:weekId" element={<HetiLegacyRedirect />} />
          <Route path="/kapcsolat" element={<ContactPage />} />
          <Route path="/contact" element={<Navigate to="/kapcsolat" replace />} />
          <Route path="/hangulatok" element={<MoodsPage />} />
          <Route path="/moods" element={<Navigate to="/hangulatok" replace />} />

          <Route path="/temak" element={<TopicsHubPage />} />
          <Route path="/temak/:slug" element={<TopicDetailPage />} />
          {/* Wave 3 long-tail: humans get parent topic page; bots get prerendered filtered view */}
          <Route path="/temak/:slug/:year" element={<TopicDetailPage />} />
          <Route path="/szemelyek" element={<PeopleHubPage />} />
          <Route path="/szemelyek/:slug" element={<PersonDetailPage />} />
          <Route path="/szemelyek/:slug/temak/:topicSlug" element={<PersonDetailPage />} />
          <Route path="/szervezetek" element={<OrganizationsIndexPage />} />
          <Route path="/szervezetek/:slug" element={<RedirectWithSlug to="/ceg" />} />
          <Route path="/szervezetek/:slug/temak/:topicSlug" element={<EntityPage kind="company" />} />
          <Route path="/part/:slug" element={<RedirectWithSlug to="/ceg" />} />
          <Route path="/part/:slug/temak/:topicSlug" element={<RedirectWithTwoSlugs to="/ceg" />} />
          <Route path="/entitasok" element={<Navigate to="/szervezetek" replace />} />
          <Route path="/cegek" element={<CompaniesHubPage />} />
          <Route path="/partok" element={<PartiesHubPage />} />
          <Route path="/en-podiverzumom" element={<EnPodiverzumomPage />} />
          <Route path="/p/:username" element={<PublicProfilePage />} />
          <Route path="/jelentes/magyar-podcast-piac-2026" element={<PodcastReport2026 />} />
          <Route path="/intelligence" element={<IntelligencePage />} />
          <Route path="/b2b" element={<Navigate to="/intelligence" replace />} />
          <Route path="/mediafigyeles" element={<Navigate to="/intelligence" replace />} />
          <Route path="/toplista" element={<ToplistaPage />} />
          <Route path="/toplist" element={<Navigate to="/toplista" replace />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        </Suspense>
        <Suspense fallback={null}>
          <SmartPlayerBar />
        </Suspense>
        </SmartPlayerProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </AppErrorBoundary>
);


export default App;
