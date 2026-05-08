CREATE INDEX IF NOT EXISTS idx_episodes_podcast_rank_pub
ON public.episodes (podcast_id, episode_rank DESC, published_at DESC);