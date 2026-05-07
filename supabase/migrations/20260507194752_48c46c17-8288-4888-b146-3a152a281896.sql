
-- Primary key on podcast_id (one embedding per podcast per active model)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'podcast_embeddings_pkey'
  ) THEN
    ALTER TABLE public.podcast_embeddings
      ADD CONSTRAINT podcast_embeddings_pkey PRIMARY KEY (podcast_id);
  END IF;
END $$;

-- ANN index for cosine similarity (ivfflat is broadly supported)
CREATE INDEX IF NOT EXISTS podcast_embeddings_embedding_cos_idx
  ON public.podcast_embeddings
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Helper index for the embed runner candidate query
CREATE INDEX IF NOT EXISTS podcasts_rank_label_updated_at_idx
  ON public.podcasts (rank_label, updated_at)
  WHERE rank_label IN ('S','A','B');
