export interface EpisodeExclusion {
  podcast_id: string;
  guid: string | null;
  asset_id: string | null;
  old_slug: string | null;
}

export function episodeIsExcluded(rules: EpisodeExclusion[], podcastId: string, item: {
  guid?: string | null; slug?: string | null; link?: string | null; episode_url?: string | null;
  audio_url?: string | null; youtube_video_id?: string | null; youtube_url?: string | null;
}) {
  return rules.some(rule => {
    if (rule.podcast_id !== podcastId) return false;
    if (rule.guid && item.guid === rule.guid) return true;
    if (rule.old_slug && item.slug === rule.old_slug) return true;
    if (!rule.asset_id) return false;
    if (item.youtube_video_id === rule.asset_id) return true;
    return [item.link, item.episode_url, item.audio_url, item.youtube_url].some(value => {
      if (!value) return false;
      let url: URL;
      try { url = new URL(value); } catch { return false; }
      if (url.searchParams.get("v") === rule.asset_id) return true;
      return url.pathname.split("/").some(part => part === rule.asset_id || part.startsWith(`${rule.asset_id}.`));
    });
  });
}