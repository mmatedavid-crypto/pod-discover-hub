import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { snapshotUtmFromUrl, trackLandingEvent } from "@/lib/landingEvents";

/**
 * /start now redirects straight into the swipe experience.
 * Facebook traffic wants to swipe immediately — no explainer, no CTA gate.
 * We still snapshot UTM + fire LandingViewed so attribution & funnel events survive.
 */
export default function StartLandingPage() {
  const { search } = useLocation();
  useEffect(() => {
    snapshotUtmFromUrl();
    trackLandingEvent("LandingViewed");
    trackLandingEvent("RegistrationOffered", { stage: "auto_redirect" });
  }, []);
  return <Navigate to={`/te-podiverzumod${search}`} replace />;
}
