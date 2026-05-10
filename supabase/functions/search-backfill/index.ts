// Search v2 backfill — touches rows so the BEFORE UPDATE trigger fills search_text.
// Call repeatedly; exits after TIME_BUDGET or when nothing left.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIME_BUDGET_MS = 110_000;
const BATCH = 5000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const start = Date.now();
  const results: Record<string, number> = { episodes: 0, podcasts: 0, batches: 0 };

  // Backfill podcasts first (tiny)
  while (Date.now() - start < TIME_BUDGET_MS) {
    const { data, error } = await sb.rpc("search_backfill_batch", { _table: "podcasts", _batch: 1000 });
    if (error) return json({ error: error.message, results }, 500);
    const n = (data as number) ?? 0;
    results.podcasts += n;
    results.batches++;
    if (n === 0) break;
  }

  // Then episodes
  while (Date.now() - start < TIME_BUDGET_MS) {
    const { data, error } = await sb.rpc("search_backfill_batch", { _table: "episodes", _batch: BATCH });
    if (error) return json({ error: error.message, results }, 500);
    const n = (data as number) ?? 0;
    results.episodes += n;
    results.batches++;
    if (n === 0) break;
  }

  return json({ ok: true, ms: Date.now() - start, results });
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}
