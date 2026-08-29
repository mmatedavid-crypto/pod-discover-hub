import { ReactNode, useEffect, useState } from "react";
import {
  analyticsEnabled,
  bindHumanInteractionTracking,
  getApiHost,
  getProjectToken,
  registerClient,
} from "@/lib/analytics";

/**
 * Boots the PostHog product-analytics layer (phase 1).
 *
 * Additive only: the existing Supabase `page_events` / `search_events` /
 * `player_events` instrumentation is untouched. Renders children unchanged and
 * never throws — if PostHog cannot load, the app behaves exactly as before.
 */
export default function AnalyticsProvider({ children }: { children: ReactNode }) {
  const [Provider, setProvider] = useState<null | {
    Component: React.ComponentType<{ client: unknown; children: ReactNode }>;
    client: unknown;
  }>(null);

  useEffect(() => {
    if (!analyticsEnabled()) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ default: posthog }, reactMod] = await Promise.all([
          import("posthog-js"),
          import("@posthog/react"),
        ]);
        if (cancelled) return;
        posthog.init(getProjectToken(), {
          api_host: getApiHost(),
          // Current SDK defaults: correct SPA history-based $pageview handling.
          defaults: "2026-05-30",
          // Phase 1: diagnostics only, no replay, no anonymous person profiles.
          disable_session_recording: true,
          person_profiles: "identified_only",
        });
        registerClient(posthog);
        bindHumanInteractionTracking();
        setProvider({
          Component: reactMod.PostHogProvider as never,
          client: posthog,
        });
      } catch {
        /* analytics must fail silently */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!Provider) return <>{children}</>;
  const { Component, client } = Provider;
  return <Component client={client}>{children}</Component>;
}
