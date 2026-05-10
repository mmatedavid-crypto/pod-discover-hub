// Drains ai_enrichment_jobs (kind = seo_podcast | seo_episode).
// - Respects pause flag and daily $ budget cap.
// - Caches by input_hash (already enforced via unique index at enqueue time).
// - Up to 3 retries (max_attempts).
// - Writes seo_title/seo_description (and ai_summary for episodes).
// - Never overwrites title or description.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { SYSTEM_PROMPT, PODCAST_SEO_TOOL, EPISODE_SEO_TOOL, podcastUserPrompt, episodeUserPrompt } from "../_shared/seo-prompt.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

// Rough Gemini Flash pricing for budget gauge ($/1k tokens).
const PRICE_IN_PER_1K = 0.000075;
const PRICE_OUT_PER_1K = 0.0003;

async function callAI(model: string, messages: any[], tools: any[], toolName: string) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools, tool_choice: { type: "function", function: { name: toolName } } }),
  });
  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("budget_exhausted_provider");
  if (!res.ok) throw new Error(`ai_${res.status}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 110_000;

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const __guard = await checkBackgroundJobsAllowed(admin, "seo-enrich-runner");
    if (__guard.blocked) return new Response(JSON.stringify({ ok: true, skipped: true, reason: __guard.reason }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    const body = await req.json().catch(() => ({}));
    const batch = Math.max(1, Math.min(100, Number(body.batch) || 60));
    const concurrency = Math.max(1, Math.min(16, Number(body.concurrency) || 12));

    // Reap stale processing locks before claiming. Best-effort.
    let reaped_stale_locks = 0;
    try {
      const { data: r } = await admin.rpc("reap_ai_stale_locks", { _older_than_minutes: 5 });
      reaped_stale_locks = Number(r) || 0;
    } catch { /* noop */ }

    // Controls
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "ai_seo_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false) return json({ ok: true, paused: true });
    const dailyBudget = Number(ctrl.daily_budget_usd ?? 1);
    const model = String(ctrl.model || "google/gemini-2.5-flash");
    const maxAttempts = Number(ctrl.max_attempts || 3);

    // Today's spend
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const dayKey = today.toISOString().slice(0, 10);
    const { data: spendRow } = await admin.from("ai_spend_daily").select("*").eq("day", dayKey).maybeSingle();
    let spend = Number(spendRow?.spend_usd || 0);
    let calls = Number(spendRow?.calls || 0);
    if (spend >= dailyBudget) return json({ ok: true, budget_reached: true, spend });

    let processed = 0, succeeded = 0, failed = 0, rate_limited = 0;
    let stop = false;
    let total_claimed = 0;
    let drain_loops = 0;
    // Time we reserve at the end of the budget for spend upsert + adaptive cron RPC
    const TAIL_RESERVE_MS = 5_000;

    const runJob = async (job: any) => {
      if (stop) return;
      if (Date.now() - startedAt > TIME_BUDGET_MS) { stop = true; return; }
      if (spend >= dailyBudget) {
        await admin.from("ai_enrichment_jobs").update({ status: "pending", locked_until: null }).eq("id", job.id);
        return;
      }
      processed++;
      try {
        const isPodcast = job.kind === "seo_podcast";
        let prompt = job.result?.prompt as string | undefined;
        if (!prompt) {
          if (isPodcast) {
            const { data: p } = await admin.from("podcasts").select("title,display_title,description,category,language").eq("id", job.target_id).maybeSingle();
            if (!p) throw new Error("target_missing");
            prompt = podcastUserPrompt(p as any);
          } else {
            const { data: e } = await admin.from("episodes").select("title,display_title,description,podcasts!inner(title,display_title,language)").eq("id", job.target_id).maybeSingle();
            if (!e) throw new Error("target_missing");
            const podName = ((e as any).podcasts?.display_title) || ((e as any).podcasts?.title) || "";
            const podLanguage = ((e as any).podcasts?.language) || null;
            prompt = episodeUserPrompt(e as any, podName, podLanguage);
          }
        }
        const tool = isPodcast ? PODCAST_SEO_TOOL : EPISODE_SEO_TOOL;
        const toolName = isPodcast ? "podcast_seo" : "episode_seo";
        const ai = await callAI(model, [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: prompt },
        ], [tool], toolName);
        const usage = ai.usage || {};
        const inTok = Number(usage.prompt_tokens || 0);
        const outTok = Number(usage.completion_tokens || 0);
        const cost = (inTok / 1000) * PRICE_IN_PER_1K + (outTok / 1000) * PRICE_OUT_PER_1K;

        const args = ai.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        const parsed = args ? JSON.parse(args) : null;
        if (!parsed) throw new Error("no_tool_call");

        const trim = (s: string, max: number) => {
          s = s.replace(/\s+/g, " ").trim();
          if (s.length <= max) return s;
          const cut = s.slice(0, max);
          const sp = cut.lastIndexOf(" ");
          return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[,;:\-–—\s]+$/, "") + "…";
        };
        if (isPodcast) {
          const seo_title = trim(String(parsed.seo_title || ""), 65);
          const seo_description = trim(String(parsed.seo_description || ""), 160);
          await admin.from("podcasts").update({
            seo_title, seo_description,
            ai_enriched_at: new Date().toISOString(),
          }).eq("id", job.target_id);
        } else {
          const seo_title = trim(String(parsed.seo_title || ""), 70);
          const seo_description = trim(String(parsed.seo_description || ""), 160);
          const ai_summary = trim(String(parsed.ai_summary || ""), 280);
          await admin.from("episodes").update({
            seo_title, seo_description, ai_summary,
            ai_enriched_at: new Date().toISOString(),
          }).eq("id", job.target_id);
        }

        await admin.from("ai_enrichment_jobs").update({
          status: "done",
          completed_at: new Date().toISOString(),
          model, cost_usd: cost, input_tokens: inTok, output_tokens: outTok,
          result: { ...job.result, parsed },
          last_error: null,
        }).eq("id", job.id);

        succeeded++;
        spend += cost; calls++;
      } catch (err: any) {
        failed++;
        const msg = err?.message || "error";
        if (msg === "rate_limited" || msg === "budget_exhausted_provider") { rate_limited++; stop = true; }
        const giveUp = (job.attempts || 0) >= maxAttempts;
        await admin.from("ai_enrichment_jobs").update({
          status: giveUp ? "failed" : "pending",
          locked_until: null,
          last_error: msg,
        }).eq("id", job.id);
      }
    };

    // Parallel pool: process `concurrency` jobs at a time (Gemini calls are I/O bound).
    let i = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= jobs.length || stop) return;
        await runJob(jobs[idx]);
      }
    });
    await Promise.all(workers);

    // Update daily spend
    await admin.from("ai_spend_daily").upsert({
      day: dayKey, spend_usd: spend, calls,
      by_kind: { ...(spendRow?.by_kind || {}) },
      updated_at: new Date().toISOString(),
    });

    // Auto-pause if budget reached
    if (spend >= dailyBudget) {
      const newCtrl = { ...ctrl, enabled: false, auto_paused_reason: "daily_budget_reached", auto_paused_at: new Date().toISOString() };
      await admin.from("app_settings").upsert({ key: "ai_seo_controls", value: newCtrl, updated_at: new Date().toISOString() });
    }

    // Adaptive cron: tune schedule from current pending backlog so we don't burn empty ticks.
    // pending>500 → */2, 100..500 → */5, 1..99 → */10, 0 → */30. Back off on rate-limit.
    let next_schedule: string | null = null;
    try {
      const { count: pending } = await admin.from("ai_enrichment_jobs").select("id", { count: "exact", head: true }).eq("status", "pending");
      const p = Number(pending || 0);
      if (rate_limited > 0) next_schedule = "*/30 * * * *";
      else if (p > 500) next_schedule = "* * * * *";
      else if (p >= 100) next_schedule = "*/2 * * * *";
      else if (p >= 1) next_schedule = "*/10 * * * *";
      else next_schedule = "*/30 * * * *";
      try { await admin.rpc("set_seo_enrich_runner_schedule" as any, { _schedule: next_schedule }); } catch { /* ignore */ }
    } catch { /* ignore */ }

    return json({ ok: true, claimed: jobs.length, processed, succeeded, failed, rate_limited, concurrency, spend_usd: spend, reaped_stale_locks, next_schedule });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
