-- Frozen before any generation: 40 matched pairs (treatment vs. unchanged control).
WITH cg AS (
  SELECT split_part(path,'/',4) es,
         count(DISTINCT session_id) FILTER (WHERE referrer ILIKE '%chatgpt%' OR utm_source ILIKE '%chatgpt%') cg,
         count(DISTINCT session_id) allx
  FROM page_events
  WHERE created_at >= '2026-09-04' AND created_at < '2026-10-02' AND coalesce(is_bot,false)=false AND path LIKE '/podcast/%/%'
  GROUP BY 1
), pool AS (
  SELECT DISTINCT ON (e.id) e.id, e.published_at, coalesce(c.cg,0) cg, coalesce(c.allx,0) allx,
    CASE WHEN p.category IN ('Self-Improvement','Relationships','Psychology & Relationships','Kids & Family','Health, Fitness & Longevity') THEN 'wellbeing'
         WHEN p.category IN ('Business & Finance','Finance') THEN 'money_work' ELSE 'society' END grp,
    (t.model LIKE 'rss%' OR abs(coalesce(t.duration_seconds,0)-coalesce(e.duration_seconds,-99))<=5) aligned
  FROM episode_transcripts t JOIN episodes e ON e.id=t.episode_id JOIN podcasts p ON p.id=e.podcast_id
  LEFT JOIN cg c ON c.es=e.slug
  WHERE t.status='ok' AND p.language_decision='accept_hungarian' AND length(t.transcript) > 8000
    AND p.category IN ('Self-Improvement','Relationships','Psychology & Relationships','Kids & Family','Health, Fitness & Longevity','Business & Finance','Finance','Society & Culture')
    AND e.audio_url IS NOT NULL
  ORDER BY e.id, length(t.transcript) DESC
), strat AS (
  SELECT *, grp || '|' || CASE WHEN cg>=3 THEN 'cg3p' WHEN cg>=1 THEN 'cg1_2' ELSE 'cg0' END
         || '|' || CASE WHEN published_at > now()-interval '1 year' THEN 'lt1y' ELSE 'ge1y' END stratum
  FROM pool
), ranked AS (
  SELECT *, row_number() OVER (PARTITION BY stratum ORDER BY cg DESC, aligned DESC, allx DESC, published_at DESC, id) rn FROM strat
), paired AS (
  SELECT *, (rn+1)/2 pair_no, count(*) OVER (PARTITION BY stratum, (rn+1)/2) pair_size,
         sum(cg) OVER (PARTITION BY stratum, (rn+1)/2) pair_cg,
         sum(aligned::int) OVER (PARTITION BY stratum, (rn+1)/2) pair_aligned
  FROM ranked
), top_pairs AS (
  SELECT stratum, pair_no, dense_rank() OVER (ORDER BY pair_cg DESC, pair_aligned DESC, stratum, pair_no) pr
  FROM (SELECT DISTINCT stratum, pair_no, pair_cg, pair_aligned FROM paired WHERE pair_size=2) x
)
INSERT INTO public.episode_answer_pilot(episode_id, pilot_group, pair_id, stratum, baseline_chatgpt_sessions, baseline_all_sessions)
SELECT p.id,
  CASE WHEN ((('x'||substr(md5(p.stratum||p.pair_no),1,1))::bit(4)::int % 2 = 0) = (p.rn % 2 = 1)) THEN 'treatment' ELSE 'control' END,
  tp.pr, p.stratum, p.cg, p.allx
FROM paired p JOIN top_pairs tp ON tp.stratum=p.stratum AND tp.pair_no=p.pair_no
WHERE tp.pr <= 40;