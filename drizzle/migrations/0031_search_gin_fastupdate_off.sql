-- Keep full-text search fast: GIN "fastupdate" pending lists grew to thousands
-- of pages between vacuums, so every search scanned them sequentially
-- (3s+ instead of 0.1s). fastupdate=off keeps the indexes always merged.
ALTER INDEX public.idx_episodes_search_tsv SET (fastupdate = off);
ALTER INDEX public.idx_podcasts_search_tsv SET (fastupdate = off);
ALTER INDEX public.idx_episodes_search_text_trgm SET (fastupdate = off);
ALTER INDEX public.idx_podcasts_normalized_title_trgm SET (fastupdate = off);
ALTER INDEX public.idx_podcasts_title_trgm SET (fastupdate = off);

SELECT gin_clean_pending_list('public.idx_episodes_search_tsv'::regclass);
SELECT gin_clean_pending_list('public.idx_podcasts_search_tsv'::regclass);
SELECT gin_clean_pending_list('public.idx_episodes_search_text_trgm'::regclass);
