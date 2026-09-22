// Rows returned by the `topic_episodes` / `person_episodes` database functions.
// They read a slim projection of the episodes table (episode_cards), so list
// pages stay inside the visitor statement timeout even under pipeline load.
// This maps such a row back to the shape the EpisodeCard components expect.

export type EpisodeCardRow = {
  id: string;
  title: string | null;
  display_title: string | null;
  slug: string | null;
  image_url: string | null;
  published_at: string | null;
  ai_summary: string | null;
  audio_url: string | null;
  people: string[] | null;
  mentioned: string[] | null;
  topics: string[] | null;
  companies: string[] | null;
  tickers: string[] | null;
  podcast_id: string | null;
  podcast_slug: string | null;
  podcast_title: string | null;
  podcast_display_title: string | null;
  podcast_image_url: string | null;
  podcast_category: string | null;
  podcast_rank: number | null;
  podcast_rank_label: string | null;
  podcast_rss_status: string | null;
  podcast_featured: boolean | null;
};

export function mapEpisodeCardRow<T extends EpisodeCardRow>(row: T): any {
  return {
    id: row.id,
    title: row.title,
    display_title: row.display_title,
    slug: row.slug,
    image_url: row.image_url,
    published_at: row.published_at,
    ai_summary: row.ai_summary,
    summary: row.ai_summary,
    audio_url: row.audio_url,
    people: row.people || [],
    mentioned: row.mentioned || [],
    topics: row.topics || [],
    companies: row.companies || [],
    tickers: row.tickers || [],
    podcast_id: row.podcast_id,
    podcasts: row.podcast_slug
      ? {
          slug: row.podcast_slug,
          title: row.podcast_title,
          display_title: row.podcast_display_title,
          image_url: row.podcast_image_url,
          category: row.podcast_category,
          podiverzum_rank: row.podcast_rank,
          rank_label: row.podcast_rank_label,
          rss_status: row.podcast_rss_status,
          featured: row.podcast_featured,
        }
      : null,
  };
}
