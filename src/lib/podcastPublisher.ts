import { supabase } from "@/integrations/supabase/client";

export type PublisherRef = { id: string; slug: string; name: string };
export type PublishedPodcast = { id: string; slug: string; title: string; display_title: string | null; image_url: string | null };

const ACCEPTED = ["accepted", "manual_accepted"];

/** The organization that publishes a podcast (Telex, 444, Rádió 1…), only when its page is public. */
export async function fetchPodcastPublisher(podcastId: string): Promise<PublisherRef | null> {
  const { data } = await (supabase as any)
    .from("podcast_publishers")
    .select("strength, organizations!inner(id, slug, name, is_public)")
    .eq("podcast_id", podcastId)
    .in("status", ACCEPTED)
    .order("strength", { ascending: false })
    .limit(1);
  const org = data?.[0]?.organizations;
  return org?.slug && org.is_public ? { id: org.id, slug: org.slug, name: org.name } : null;
}

/** A publisher's own Hungarian shows, best-ranked first. */
export async function fetchPublishedPodcasts(organizationId: string): Promise<PublishedPodcast[]> {
  const { data } = await (supabase as any)
    .from("podcast_publishers")
    .select("podcasts!inner(id, slug, title, display_title, image_url, language_decision, podiverzum_rank)")
    .eq("organization_id", organizationId)
    .in("status", ACCEPTED)
    .limit(200);
  return ((data || []) as any[])
    .map((r) => r.podcasts)
    .filter((p) => p?.slug && p.language_decision === "accept_hungarian")
    .sort((a, b) => Number(b.podiverzum_rank || 0) - Number(a.podiverzum_rank || 0))
    .map(({ id, slug, title, display_title, image_url }) => ({ id, slug, title, display_title, image_url }));
}
