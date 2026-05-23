-- Shareable result snapshots for "A Te Podiverzumod"
-- Privacy-safe: stores only the public result face (archetype + tagline + description + tags).
-- No user_id, no answers, no confidence score, no embeddings.

CREATE TABLE IF NOT EXISTS public.te_podiverzumod_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_id text NOT NULL UNIQUE,
  result_type text NOT NULL,            -- archetype id, e.g. "strategic_curious"
  result_title text NOT NULL,           -- e.g. "A Stratégiai Kíváncsi"
  result_subtitle text,                 -- short tagline / element line
  result_description text NOT NULL,     -- 1 short paragraph
  tags text[] NOT NULL DEFAULT '{}',    -- 3-5 public tags
  aura_colors text[] NOT NULL DEFAULT '{}', -- optional: visual tint hexes
  source_session_id text,               -- internal only, never returned to clients
  view_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz
);

CREATE INDEX IF NOT EXISTS te_podiverzumod_shares_created_at_idx
  ON public.te_podiverzumod_shares (created_at DESC);

ALTER TABLE public.te_podiverzumod_shares ENABLE ROW LEVEL SECURITY;

-- Public READ: anyone can read a share by share_id, but NOT the internal source_session_id column.
-- Easiest: allow SELECT on the table but only expose a safe view.
CREATE OR REPLACE VIEW public.te_podiverzumod_shares_public
WITH (security_invoker = true)
AS
SELECT
  share_id,
  result_type,
  result_title,
  result_subtitle,
  result_description,
  tags,
  aura_colors,
  created_at,
  expires_at
FROM public.te_podiverzumod_shares
WHERE expires_at IS NULL OR expires_at > now();

GRANT SELECT ON public.te_podiverzumod_shares_public TO anon, authenticated;

-- Block direct table access from clients (edge function uses service role).
REVOKE ALL ON public.te_podiverzumod_shares FROM anon, authenticated;

-- Tight RLS: explicit deny for client roles (defense in depth — the REVOKE above already blocks).
CREATE POLICY "no direct client access"
ON public.te_podiverzumod_shares
FOR ALL
TO anon, authenticated
USING (false)
WITH CHECK (false);

-- The view itself reads from the base table; we need a SELECT policy that allows
-- reads through the security_invoker view for non-expired rows.
CREATE POLICY "public can read non-expired shares via view"
ON public.te_podiverzumod_shares
FOR SELECT
TO anon, authenticated
USING (expires_at IS NULL OR expires_at > now());

-- Reset: re-grant only what's needed
GRANT SELECT (share_id, result_type, result_title, result_subtitle, result_description, tags, aura_colors, created_at, expires_at)
  ON public.te_podiverzumod_shares TO anon, authenticated;
