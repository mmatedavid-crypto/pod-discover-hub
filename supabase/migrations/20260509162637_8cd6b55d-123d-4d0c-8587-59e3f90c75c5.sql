CREATE INDEX IF NOT EXISTS idx_episodes_topics_gin ON public.episodes USING GIN (topics);
CREATE INDEX IF NOT EXISTS idx_episodes_people_gin ON public.episodes USING GIN (people);
CREATE INDEX IF NOT EXISTS idx_episodes_companies_gin ON public.episodes USING GIN (companies);
CREATE INDEX IF NOT EXISTS idx_episodes_tickers_gin ON public.episodes USING GIN (tickers);
CREATE INDEX IF NOT EXISTS idx_episodes_ingredients_gin ON public.episodes USING GIN (ingredients);