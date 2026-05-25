import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import StartSwipePage from "./pages/StartSwipePage.tsx";
import StartLandingPage from "./pages/StartLandingPage.tsx";
import TePodiverzumodSharePage from "./pages/TePodiverzumodSharePage.tsx";
import NotFound from "./pages/NotFound.tsx";
import CategoriesPage from "./pages/CategoriesPage.tsx";
import CategoryDetail from "./pages/CategoryDetail.tsx";
import PodcastDetail from "./pages/PodcastDetail.tsx";
import EpisodeDetail from "./pages/EpisodeDetail.tsx";
import SearchPage from "./pages/SearchPage.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import AdminPage from "./pages/AdminPage.tsx";
import AdminHubPage from "./pages/AdminHubPage.tsx";
import AdminBootstrapPage from "./pages/AdminBootstrapPage.tsx";
import AdminDiscoveryPage from "./pages/AdminDiscoveryPage.tsx";
import AdminGrowthPage from "./pages/AdminGrowthPage.tsx";
import AdminAutopilotPage from "./pages/AdminAutopilotPage.tsx";
import AdminQueuePage from "./pages/AdminQueuePage.tsx";
import GrowthStatusPage from "./pages/GrowthStatusPage.tsx";
import EntityPage from "./pages/EntityPage.tsx";
import AdminFeedbackPage from "./pages/AdminFeedbackPage.tsx";
import AdminSearchInsightsPage from "./pages/AdminSearchInsightsPage.tsx";
import AdminAnalyticsPage from "./pages/AdminAnalyticsPage.tsx";
import AdminAiEnrichmentPage from "./pages/AdminAiEnrichmentPage.tsx";
import AdminCronStatusPage from "./pages/AdminCronStatusPage.tsx";
import AdminPipelineWatchdogPage from "./pages/AdminPipelineWatchdogPage.tsx";
import AdminQueueHealthPage from "./pages/AdminQueueHealthPage.tsx";
import AdminSocialPostsPage from "./pages/AdminSocialPostsPage.tsx";
import AdminEditorialPage from "./pages/AdminEditorialPage.tsx";
import AdminLivePage from "./pages/AdminLivePage.tsx";
import AdminPiBackfillPage from "./pages/AdminPiBackfillPage.tsx";
import AdminArchiveBackfillPage from "./pages/AdminArchiveBackfillPage.tsx";
import AdminHostsPage from "./pages/AdminHostsPage.tsx";
import AdminLanguageGatePage from "./pages/AdminLanguageGatePage.tsx";
import AdminPersonQualityReviewPage from "./pages/AdminPersonQualityReviewPage.tsx";
import AdminVectorSearchPage from "./pages/AdminVectorSearchPage.tsx";
import AdminSearchBenchmarkPage from "./pages/AdminSearchBenchmarkPage.tsx";
import AdminDataCoveragePage from "./pages/AdminDataCoveragePage.tsx";
import PeopleHubPage from "./pages/PeopleHubPage.tsx";
import PersonDetailPage from "./pages/PersonDetailPage.tsx";
import TopicsHubPage from "./pages/TopicsHubPage.tsx";
import TopicDetailPage from "./pages/TopicDetailPage.tsx";
import OrganizationsIndexPage from "./pages/OrganizationsIndexPage.tsx";
import CompaniesHubPage from "./pages/CompaniesHubPage.tsx";
import PartiesHubPage from "./pages/PartiesHubPage.tsx";

import PageViewTracker from "./components/PageViewTracker.tsx";
import PrivacyPage from "./pages/PrivacyPage.tsx";
import TermsPage from "./pages/TermsPage.tsx";
import MoodCollectionPage from "./pages/MoodCollectionPage.tsx";

import AboutPage from "./pages/AboutPage.tsx";
import MethodologyPage from "./pages/MethodologyPage.tsx";
import NewPodcastsPage from "./pages/NewPodcastsPage.tsx";
import DailyBriefPage from "./pages/DailyBriefPage.tsx";
import HetiValogatasPage from "./pages/HetiValogatasPage.tsx";
import ContactPage from "./pages/ContactPage.tsx";
import MoodsPage from "./pages/MoodsPage.tsx";
import { SearchHotkey } from "./components/SearchHotkey.tsx";
import { SmartPlayerProvider } from "./components/smart-player/SmartPlayerProvider";
import { SmartPlayerBar } from "./components/smart-player/SmartPlayerBar";
import EnPodiverzumomPage from "./pages/EnPodiverzumomPage.tsx";
import PublicProfilePage from "./pages/PublicProfilePage.tsx";
import { AppErrorBoundary } from "./components/AppErrorBoundary";

const queryClient = new QueryClient();

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
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/start" element={<StartLandingPage />} />
          <Route path="/vibe" element={<StartSwipePage />} />
          <Route path="/te-podiverzumod" element={<StartSwipePage />} />
          <Route path="/te-podiverzumod/eredmeny/:slug" element={<TePodiverzumodSharePage />} />
          <Route path="/kategoriak" element={<CategoriesPage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/kategoria/:slug" element={<CategoryDetail />} />
          <Route path="/category/:slug" element={<CategoryDetail />} />
          <Route path="/podcast/:podcastSlug" element={<PodcastDetail />} />
          <Route path="/podcast/:podcastSlug/:episodeSlug" element={<EpisodeDetail />} />
          <Route path="/kereses" element={<SearchPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/belepes" element={<AuthPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/admin" element={<AdminHubPage />} />
          <Route path="/admin/podcasts" element={<AdminPage />} />
          <Route path="/admin-bootstrap" element={<AdminBootstrapPage />} />
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
          <Route path="/admin/social" element={<AdminSocialPostsPage />} />
          <Route path="/admin/editorial" element={<AdminEditorialPage />} />
          <Route path="/admin/live" element={<AdminLivePage />} />
          <Route path="/admin/pi-backfill" element={<AdminPiBackfillPage />} />
          <Route path="/admin/archive-backfill" element={<AdminArchiveBackfillPage />} />
          <Route path="/admin/hosts" element={<AdminHostsPage />} />
          <Route path="/admin/language-gate" element={<AdminLanguageGatePage />} />
          <Route path="/admin/person-quality-review" element={<AdminPersonQualityReviewPage />} />
          <Route path="/admin/vector-search" element={<AdminVectorSearchPage />} />
          <Route path="/admin/search-benchmark" element={<AdminSearchBenchmarkPage />} />
          <Route path="/admin/data-coverage" element={<AdminDataCoveragePage />} />
          
          <Route path="/growth-status" element={<GrowthStatusPage />} />
          <Route path="/tema/:slug" element={<EntityPage kind="topic" />} />
          <Route path="/topic/:slug" element={<EntityPage kind="topic" />} />
          <Route path="/szemely/:slug" element={<RedirectWithSlug to="/szemelyek" />} />
          <Route path="/person/:slug" element={<RedirectWithSlug to="/szemelyek" />} />
          <Route path="/ceg/:slug" element={<EntityPage kind="company" />} />
          <Route path="/company/:slug" element={<EntityPage kind="company" />} />
          <Route path="/ticker/:slug" element={<EntityPage kind="ticker" />} />
          <Route path="/hozzavalo/:slug" element={<EntityPage kind="ingredient" />} />
          <Route path="/ingredient/:slug" element={<EntityPage kind="ingredient" />} />
          <Route path="/adatvedelem" element={<PrivacyPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/feltetelek" element={<TermsPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/hangulatok/:slug" element={<MoodCollectionPage />} />
          <Route path="/moods/:slug" element={<MoodCollectionPage />} />
          <Route path="/hangulat/:slug" element={<MoodCollectionPage />} />
          <Route path="/mood/:slug" element={<MoodCollectionPage />} />
          
          <Route path="/rolunk" element={<AboutPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/modszertan" element={<MethodologyPage />} />
          <Route path="/methodology" element={<MethodologyPage />} />
          <Route path="/uj-podcastok" element={<NewPodcastsPage />} />
          <Route path="/uj" element={<NewPodcastsPage />} />
          <Route path="/new" element={<NewPodcastsPage />} />
          <Route path="/napi" element={<DailyBriefPage />} />
          <Route path="/mai-valogatas" element={<DailyBriefPage />} />
          <Route path="/daily" element={<DailyBriefPage />} />
          <Route path="/heti-valogatas" element={<HetiValogatasPage />} />
          <Route path="/heti-valogatas/:weekId" element={<HetiValogatasPage />} />
          <Route path="/kapcsolat" element={<ContactPage />} />
          <Route path="/contact" element={<ContactPage />} />
          <Route path="/hangulatok" element={<MoodsPage />} />
          <Route path="/moods" element={<MoodsPage />} />
          <Route path="/temak" element={<TopicsHubPage />} />
          <Route path="/temak/:slug" element={<TopicDetailPage />} />
          <Route path="/szemelyek" element={<PeopleHubPage />} />
          <Route path="/szemelyek/:slug" element={<PersonDetailPage />} />
          <Route path="/szervezetek" element={<OrganizationsIndexPage />} />
          <Route path="/entitasok" element={<Navigate to="/szervezetek" replace />} />
          <Route path="/cegek" element={<CompaniesHubPage />} />
          <Route path="/partok" element={<PartiesHubPage />} />
          <Route path="/en-podiverzumom" element={<EnPodiverzumomPage />} />
          <Route path="/p/:username" element={<PublicProfilePage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
        <SmartPlayerBar />
        </SmartPlayerProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </AppErrorBoundary>
);


export default App;
