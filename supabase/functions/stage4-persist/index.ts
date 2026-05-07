// Stage 4 persistence: bulk-update gate results, quality results, and shadow ranks.
// Body: { gate?: GateRow[], quality?: QualRow[], shadow?: ShadowRow[] }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const counters = { gate: 0, quality: 0, shadow: 0, errors: [] as string[] };

    if (Array.isArray(body.gate)) {
      for (const g of body.gate) {
        const { error } = await supabase.from("pi_feed_staging").update({
          ai_decision: g.decision,
          ai_quality_score: g.quality,
          ai_spam_score: g.spam,
          ai_active_signal: g.active,
          ai_likely_category: g.category,
          ai_detected_language: g.language,
          ai_confidence: g.confidence,
          ai_reasons: g.reasons,
          ai_input_hash: g.h,
          ai_model: "google/gemini-2.5-flash-lite",
          ai_gated_at: new Date().toISOString(),
        }).eq("id", g.id);
        if (error) counters.errors.push(`gate ${g.id}: ${error.message}`);
        else counters.gate++;
      }
    }

    if (Array.isArray(body.quality)) {
      for (const q of body.quality) {
        const { error } = await supabase.from("podcasts").update({
          ai_quality_score: q.quality,
          ai_spam_score: q.spam,
          ai_quality_reason: { reasons: q.reasons },
          ai_quality_input_hash: q.h,
          ai_quality_model: "google/gemini-2.5-flash-lite",
          ai_quality_updated_at: new Date().toISOString(),
        }).eq("id", q.id);
        if (error) counters.errors.push(`qual ${q.id}: ${error.message}`);
        else counters.quality++;
      }
    }

    if (Array.isArray(body.shadow)) {
      for (const s of body.shadow) {
        const { error } = await supabase.from("podcasts").update({
          shadow_rank: s.shadow_rank,
          shadow_rank_tier: s.tier,
          shadow_rank_components: s.components,
          crawl_priority: s.crawl_priority,
          shadow_computed_at: new Date().toISOString(),
        }).eq("id", s.id);
        if (error) counters.errors.push(`shadow ${s.id}: ${error.message}`);
        else counters.shadow++;
      }
    }

    return new Response(JSON.stringify({ ok: true, ...counters, errors: counters.errors.slice(0, 5) }),
      { headers: { ...cors, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
