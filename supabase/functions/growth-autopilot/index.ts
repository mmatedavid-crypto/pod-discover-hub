// Growth Autopilot orchestrator.
// One "tick" — safe to call from cron (every 10 min) or manually.
// State stored in app_settings.key='growth_autopilot' (jsonb).
//   { state: 'stopped'|'running'|'paused',
//     source: 'auto'|'recent'|'topics'|'search_demand',
//     batch: 50, topics: string[],
//     consecutive_errors: 0, auto_stop_at_errors: 5,
//     last_tick_at, last_action, last_result, last_error,
//     rotation_idx: 0 }
//
// Per tick:
// 1. Read state. If not 'running', return no-op.
// 2. If unprocessed staging > 0 → call pi-dump-process foundation batch.
// 3. Else → discover from chosen source (or rotate if 'auto'):
//    auto: recent → topics → search_demand → recent ...
// 4. Record result; auto-stop on too many consecutive errors.
//
// Body (optional): { trigger?: 'cron'|'manual' }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_STATE = {
  state: "stopped",
  source: "auto",
  batch: 50,
  topics: ["productivity", "formula 1", "longevity", "ai healthcare", "startups", "personal finance", "history", "science"],
  consecutive_errors: 0,
  auto_stop_at_errors: 5,
  rotation_idx: 0,
  last_tick_at: null as string | null,
  last_action: null as string | null,
  last_result: null as any,
  last_error: null as string | null,
  stopped_reason: null as string | null,
};

async function callFunction(path: string, body: any) {
  const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/${path}`;
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${key}`, "apikey": key },
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let data: any = null;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text.slice(0, 300)}`);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const trigger = body.trigger || "cron";

    // Load state
    const { data: row } = await supabase.from("app_settings").select("value").eq("key", "growth_autopilot").maybeSingle();
    const state: typeof DEFAULT_STATE = { ...DEFAULT_STATE, ...(row?.value || {}) };

    if (state.state !== "running") {
      return new Response(JSON.stringify({ ok: true, skipped: true, state: state.state, trigger }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check unprocessed staging count
    const { count: unprocessed } = await supabase
      .from("pi_feed_staging").select("id", { count: "exact", head: true }).eq("processed", false);

    let action = "";
    let result: any = null;
    let error: string | null = null;

    try {
      if ((unprocessed ?? 0) > 0) {
        action = "process";
        const batch = Math.max(10, Math.min(100, Number(state.batch) || 10));
        result = await callFunction("pi-dump-process", { foundation: true, batch });
      } else {
        // Decide source
        let src = state.source;
        if (src === "auto") {
          const order = ["recent", "topics", "search_demand"];
          src = order[(state.rotation_idx ?? 0) % order.length];
          state.rotation_idx = ((state.rotation_idx ?? 0) + 1) % order.length;
        }
        action = `discover:${src}`;
        if (src === "recent") {
          result = await callFunction("pi-recent-ingest", { max: 500, lang: "en", since_days: 2 });
        } else if (src === "topics") {
          const topics = (state.topics || []).slice(0, 8);
          if (!topics.length) throw new Error("no topics configured");
          result = await callFunction("pi-topic-ingest", { terms: topics, max: 25, lang: "en" });
        } else if (src === "search_demand") {
          // Last 7d top searches with low/zero results, frequency ≥2
          const since = new Date(Date.now() - 7 * 86400000).toISOString();
          const { data: ev } = await supabase
            .from("search_events").select("query, result_count")
            .gte("created_at", since).lte("result_count", 2).limit(2000);
          const freq: Record<string, number> = {};
          (ev || []).forEach((r: any) => {
            const q = String(r.query || "").trim().toLowerCase();
            if (q.length >= 3 && q.length <= 60) freq[q] = (freq[q] || 0) + 1;
          });
          const terms = Object.entries(freq)
            .filter(([, n]) => n >= 2)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 8).map(([q]) => q);
          if (!terms.length) {
            // Fallback to topics so the tick is productive
            const topics = (state.topics || []).slice(0, 8);
            result = await callFunction("pi-topic-ingest", { terms: topics, max: 25, lang: "en" });
            action = "discover:search_demand→topics(fallback)";
          } else {
            result = await callFunction("pi-topic-ingest", { terms, max: 25, lang: "en" });
          }
        } else {
          throw new Error(`unknown source: ${src}`);
        }
      }
      state.consecutive_errors = 0;
      state.last_error = null;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
      state.last_error = error;

      // Detect worker resource limit / timeout — auto-throttle batch instead of fatal stop.
      const lower = error.toLowerCase();
      const isResourceLimit =
        lower.includes("worker_resource_limit") ||
        lower.includes("resource limit") ||
        / 546(\b|:)/.test(error) ||
        lower.includes("status 546") ||
        lower.includes("timeout") ||
        lower.includes("timed out");

      let throttled = false;
      if (isResourceLimit) {
        const cur = Number(state.batch) || 10;
        let next = cur;
        if (cur > 20) next = 20;
        else if (cur > 10) next = 10;
        else next = 10;
        if (next !== cur) {
          state.batch = next;
          throttled = true;
        }
        state.last_action = `auto-throttled: resource limit (batch=${state.batch})`;
        if (throttled) {
          // Don't count as a fatal error if we successfully reduced the batch.
          state.consecutive_errors = 0;
        } else {
          // Already at floor — count it; stop only after repeated errors.
          state.consecutive_errors = (state.consecutive_errors || 0) + 1;
        }
      } else {
        state.consecutive_errors = (state.consecutive_errors || 0) + 1;
      }

      if (state.consecutive_errors >= (state.auto_stop_at_errors || 5)) {
        state.state = "stopped";
        state.stopped_reason = `auto-stop: ${state.consecutive_errors} consecutive errors`;
      }
    }

    state.last_tick_at = new Date().toISOString();
    if (!state.last_action || !state.last_action.startsWith("auto-throttled")) {
      state.last_action = action;
    }
    state.last_result = result;

    await supabase.from("app_settings").upsert({
      key: "growth_autopilot",
      value: state as any,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return new Response(JSON.stringify({
      ok: !error, trigger, action, unprocessed: unprocessed ?? 0, result, error,
      state: state.state, consecutive_errors: state.consecutive_errors,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
