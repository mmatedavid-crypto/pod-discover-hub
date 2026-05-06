import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import CategoriesPage from "./pages/CategoriesPage.tsx";
import CategoryDetail from "./pages/CategoryDetail.tsx";
import PodcastDetail from "./pages/PodcastDetail.tsx";
import EpisodeDetail from "./pages/EpisodeDetail.tsx";
import SearchPage from "./pages/SearchPage.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import AdminPage from "./pages/AdminPage.tsx";
import AdminBootstrapPage from "./pages/AdminBootstrapPage.tsx";
import AdminDiscoveryPage from "./pages/AdminDiscoveryPage.tsx";
import AdminGrowthPage from "./pages/AdminGrowthPage.tsx";
import AdminQueuePage from "./pages/AdminQueuePage.tsx";
import GrowthStatusPage from "./pages/GrowthStatusPage.tsx";
import EntityPage from "./pages/EntityPage.tsx";
import AdminFeedbackPage from "./pages/AdminFeedbackPage.tsx";
import AdminSearchInsightsPage from "./pages/AdminSearchInsightsPage.tsx";
import AdminAnalyticsPage from "./pages/AdminAnalyticsPage.tsx";
import PageViewTracker from "./components/PageViewTracker.tsx";
import PrivacyPage from "./pages/PrivacyPage.tsx";
import TermsPage from "./pages/TermsPage.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <PageViewTracker />
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="/category/:slug" element={<CategoryDetail />} />
          <Route path="/podcast/:podcastSlug" element={<PodcastDetail />} />
          <Route path="/podcast/:podcastSlug/:episodeSlug" element={<EpisodeDetail />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/admin" element={<AdminPage />} />
          <Route path="/admin-bootstrap" element={<AdminBootstrapPage />} />
          <Route path="/admin/discovery" element={<AdminDiscoveryPage />} />
          <Route path="/admin/growth" element={<AdminGrowthPage />} />
          <Route path="/admin/queue" element={<AdminQueuePage />} />
          <Route path="/admin/feedback" element={<AdminFeedbackPage />} />
          <Route path="/admin/search-insights" element={<AdminSearchInsightsPage />} />
          <Route path="/admin/analytics" element={<AdminAnalyticsPage />} />
          <Route path="/growth-status" element={<GrowthStatusPage />} />
          <Route path="/topic/:slug" element={<EntityPage kind="topic" />} />
          <Route path="/person/:slug" element={<EntityPage kind="person" />} />
          <Route path="/company/:slug" element={<EntityPage kind="company" />} />
          <Route path="/ticker/:slug" element={<EntityPage kind="ticker" />} />
          <Route path="/ingredient/:slug" element={<EntityPage kind="ingredient" />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
