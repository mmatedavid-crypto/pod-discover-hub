// Google Indexing API eligibility (pure, unit-tested).
// The API is only for JobPosting / BroadcastEvent pages. Podiverzum publishes
// neither, so no URL is ever eligible; every request is a no-op.
export const INDEXING_API_SUPPORTED_TYPES = ["JobPosting", "BroadcastEvent"] as const;

export function indexingApiDecision(urls: string[]): { submit: string[]; unsupported: number; reason: string } {
  return { submit: [], unsupported: urls.length, reason: "indexing_api_supports_only_jobposting_broadcastevent" };
}
