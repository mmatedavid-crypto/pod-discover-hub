CREATE INDEX IF NOT EXISTS episodes_podcast_guid_idx
ON public.episodes (podcast_id, guid)
WHERE guid IS NOT NULL;