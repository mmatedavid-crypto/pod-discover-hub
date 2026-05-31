import type { EpisodeLite } from "@/components/EpisodeCard";

function podcastKey(ep: EpisodeLite): string {
  return ep.podcast_id || ep.podcasts?.slug || ep.podcasts?.title || "_";
}

function categoryKey(ep: EpisodeLite): string {
  return ep.podcasts?.category || "_";
}

export function auditHomepageRail(name: string, items: EpisodeLite[]) {
  if (typeof window === "undefined" || !items.length) return;

  const warnings: string[] = [];
  const podcastCounts = new Map<string, number>();
  const categoryCounts = new Map<string, number>();

  items.forEach((ep, index) => {
    const pod = podcastKey(ep);
    const cat = categoryKey(ep);
    podcastCounts.set(pod, (podcastCounts.get(pod) || 0) + 1);
    categoryCounts.set(cat, (categoryCounts.get(cat) || 0) + 1);

    if (index > 0 && podcastKey(items[index - 1]) === pod) {
      warnings.push(`adjacent_same_podcast:${pod}`);
    }
  });

  const maxPodcast = Math.max(...podcastCounts.values());
  const maxCategory = Math.max(...categoryCounts.values());
  if (maxPodcast > 2) warnings.push(`podcast_overrepresented:${maxPodcast}`);
  if (items.length >= 6 && maxCategory / items.length > 0.5) warnings.push(`category_overrepresented:${maxCategory}/${items.length}`);

  if (warnings.length) {
    console.warn("[homepage-quality]", name, warnings, {
      podcasts: Object.fromEntries(podcastCounts),
      categories: Object.fromEntries(categoryCounts),
    });
  }
}
