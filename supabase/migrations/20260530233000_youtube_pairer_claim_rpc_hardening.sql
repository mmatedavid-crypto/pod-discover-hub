-- Harden the adaptive YouTube episode pairer claim path.
-- The edge function can fall back to a non-locking select, but production
-- drains should use this RPC so parallel cron/workers cannot process the same
-- podcast batch.

ALTER TABLE public.podcasts
  ADD COLUMN IF NOT EXISTS youtube_episode_pair_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS youtube_episode_pair_claim_owner text;

CREATE INDEX IF NOT EXISTS podcasts_youtube_episode_pair_due_idx
  ON public.podcasts (
    youtube_last_episode_pair_at ASC NULLS FIRST,
    shadow_rank_tier,
    youtube_episode_pair_claimed_at
  )
  WHERE youtube_channel_id IS NOT NULL
    AND youtube_pairing_status = 'paired'
    AND is_hungarian = true;

CREATE INDEX IF NOT EXISTS podcasts_youtube_pair_claim_idx
  ON public.podcasts (youtube_episode_pair_claimed_at)
  WHERE youtube_channel_id IS NOT NULL
    AND youtube_pairing_status = 'paired';

CREATE OR REPLACE FUNCTION public.claim_youtube_episode_pair_podcasts(
  p_limit integer DEFAULT 10,
  p_tiers text[] DEFAULT ARRAY['S','A','B','C','D','E'],
  p_cutoff timestamptz DEFAULT now() - interval '7 days',
  p_claim_timeout_minutes integer DEFAULT 45
)
RETURNS TABLE (
  id uuid,
  title text,
  youtube_channel_id text,
  shadow_rank_tier text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner text := 'yt-pairer-' || txid_current()::text || '-' || floor(random() * 1000000)::text;
  v_limit integer := GREATEST(1, LEAST(50, COALESCE(p_limit, 10)));
  v_timeout integer := GREATEST(5, LEAST(240, COALESCE(p_claim_timeout_minutes, 45)));
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT p.id
    FROM public.podcasts p
    WHERE p.youtube_pairing_status = 'paired'
      AND p.youtube_channel_id IS NOT NULL
      AND p.is_hungarian = true
      AND (
        p_tiers IS NULL
        OR array_length(p_tiers, 1) IS NULL
        OR p.shadow_rank_tier = ANY(p_tiers)
      )
      AND (
        p.youtube_last_episode_pair_at IS NULL
        OR p.youtube_last_episode_pair_at < COALESCE(p_cutoff, now() - interval '7 days')
      )
      AND (
        p.youtube_episode_pair_claimed_at IS NULL
        OR p.youtube_episode_pair_claimed_at < now() - make_interval(mins => v_timeout)
      )
    ORDER BY p.youtube_last_episode_pair_at ASC NULLS FIRST, p.id
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.podcasts p
  SET youtube_episode_pair_claimed_at = now(),
      youtube_episode_pair_claim_owner = v_owner
  FROM picked
  WHERE p.id = picked.id
  RETURNING p.id, p.title::text, p.youtube_channel_id::text, p.shadow_rank_tier::text;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_youtube_episode_pair_podcasts(integer, text[], timestamptz, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_youtube_episode_pair_podcasts(integer, text[], timestamptz, integer) TO service_role;

COMMENT ON FUNCTION public.claim_youtube_episode_pair_podcasts(integer, text[], timestamptz, integer)
IS 'Atomically claims due YouTube-paired Hungarian podcasts for adaptive episode-video pairing. Uses FOR UPDATE SKIP LOCKED and stale-claim timeout.';

INSERT INTO public.app_settings (key, value, updated_at)
VALUES (
  'youtube_episode_pairer_claim_rpc',
  jsonb_build_object(
    'enabled', true,
    'function', 'claim_youtube_episode_pair_podcasts',
    'policy', 'parallel_safe_skip_locked_v1',
    'configured_at', now()
  ),
  now()
)
ON CONFLICT (key) DO UPDATE
SET value = public.app_settings.value || jsonb_build_object(
    'enabled', true,
    'function', 'claim_youtube_episode_pair_podcasts',
    'policy', 'parallel_safe_skip_locked_v1',
    'configured_at', now()
  ),
  updated_at = now();
