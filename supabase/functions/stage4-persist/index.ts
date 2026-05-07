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

    if (Array.isArray(body.health)) {
      for (const h of body.health) {
        const patch: any = {};
        if (h.rss_status) patch.rss_status = h.rss_status;
        if (typeof h.consecutive_failure_count === "number") patch.consecutive_failure_count = h.consecutive_failure_count;
        if (h.clear_error) patch.last_fetch_error = null;
        if (h.touch_fetched) patch.last_fetched_at = new Date().toISOString();
        // merge health_state into shadow_rank_components
        const { data: cur } = await supabase.from("podcasts").select("shadow_rank_components").eq("id", h.id).maybeSingle();
        const comp = (cur?.shadow_rank_components as any) || {};
        comp.health_state = h.health_state;
        comp.recheck_code = h.code ?? null;
        comp.rechecked_at = new Date().toISOString();
        patch.shadow_rank_components = comp;
        const { error } = await supabase.from("podcasts").update(patch).eq("id", h.id);
        if (error) (counters as any).errors.push(`health ${h.id}: ${error.message}`);
        else (counters as any).gate++;
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
