import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TIME_BUDGET_MS = 110_000;
const RESERVE_MS = 5_000;
const BATCH = 1500;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const startedAt = Date.now();
  const url = Deno.env.get('SUPABASE_URL')!;
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(url, key);

  let totalUpdated = 0;
  let iterations = 0;
  let lastBatch = -1;

  while (Date.now() - startedAt < TIME_BUDGET_MS - RESERVE_MS) {
    const { data, error } = await supabase.rpc('refresh_episodes_search_text_batch', { _limit: BATCH });
    if (error) {
      return new Response(JSON.stringify({ ok: false, error: error.message, totalUpdated, iterations }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const result = data as { updated: number; done: boolean; cursor: string | null };
    lastBatch = result?.updated ?? 0;
    totalUpdated += lastBatch;
    iterations += 1;
    if (result?.done) break;
  }

  return new Response(JSON.stringify({
    ok: true,
    totalUpdated,
    iterations,
    lastBatch,
    elapsedMs: Date.now() - startedAt,
    done: lastBatch === 0,
  }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
});
