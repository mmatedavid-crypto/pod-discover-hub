// Embeds S/A/B/C tier episodes using Gemini text-embedding-004 (768d).
// Mirrors embed-podcast-runner: hash-cached, daily $ budget, adaptive cron.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const PRICE_IN_PER_1K = 0.000025;

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildContent(e: any, model: string): string {
  const arr = (a: any) => (Array.isArray(a) ? a.slice(0, 10).join(", ") : "");
  const parts = [
    `MODEL: ${model}`,
    `PODCAST: ${e.podcast_display_title || e.podcast_title || ""}`,
    `CATEGORY: ${e.podcast_category || ""}`,
    `EPISODE: ${e.display_title || e.title || ""}`,
  ];
  if (e.ai_summary) parts.push(`AI_SUMMARY: ${String(e.ai_summary).slice(0, 600)}`);
  if (e.seo_description) parts.push(`SEO: ${String(e.seo_description).slice(0, 400)}`);
  if (e.description) parts.push(`DESCRIPTION: ${String(e.description).slice(0, 1600)}`);
  const topics = arr(e.topics); if (topics) parts.push(`TOPICS: ${topics}`);
  const people = arr(e.people); if (people) parts.push(`PEOPLE: ${people}`);
  const companies = arr(e.companies); if (companies) parts.push(`COMPANIES: ${companies}`);
  const tickers = arr(e.tickers); if (tickers) parts.push(`TICKERS: ${tickers}`);
  const ingredients = arr(e.ingredients); if (ingredients) parts.push(`INGREDIENTS: ${ingredients}`);
  return parts.join("\n");
}

async function embed(model: string, text: string): Promise<{ vec: number[]; tokens: number }> {
  const googleModel = model.replace(/^google\//, "");
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("missing_gemini_api_key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${googleModel}:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: `models/${googleModel}`,
      content: { parts: [{ text }] },
      taskType: "SEMANTIC_SIMILARITY",
      outputDimensionality: 768,
    }),
  });
  if (res.status === 429) throw new Error("rate_limited");
  if (!res.ok) throw new Error(`gemini_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const vec = j.embedding?.values as number[] | undefined;
  if (!vec || vec.length !== 768) throw new Error(`bad_embedding`);
  return { vec, tokens: Math.ceil(text.length / 4) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 110_000;

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "embed-episode-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });
    const body = await req.json().catch(() => ({}));

    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "embed_episode_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false) return json({ ok: true, paused: true });
    const model = String(ctrl.model || "google/text-embedding-004");
    const dailyBudget = Number(ctrl.daily_budget_usd ?? 1.0);
    const batch = Math.max(1, Math.min(200, Number(body.batch) || Number(ctrl.batch_size) || 50));
    const concurrency = Math.max(1, Math.min(16, Number(body.concurrency) || Number(ctrl.concurrency) || 6));
    const TIME_RESERVE_MS = 8_000; // leave headroom for stats + cron RPC

    const dayKey = new Date().toISOString().slice(0, 10);
    const { data: spendRow } = await admin.from("ai_spend_daily").select("*").eq("day", dayKey).maybeSingle();
    const byKind = (spendRow?.by_kind as any) || {};
    let embedSpend = Number(byKind.embed_episode_usd || 0);
    let totalSpend = Number(spendRow?.spend_usd || 0);
    let calls = Number(spendRow?.calls || 0);
    if (embedSpend >= dailyBudget) return json({ ok: true, budget_reached: true, embed_spend: embedSpend });

    const { data: candRows, error: candErr } = await admin.rpc("select_embed_episode_candidates", {
      _model: model, _limit: batch,
    });
    if (candErr) throw candErr;
    const candidates: any[] = (candRows as any[]) || [];

    let embedded = 0, errors = 0;
    const errorSamples: any[] = [];
    let stop = false;
    let i = 0;

    const runOne = async (e: any) => {
      if (stop) return;
      if (Date.now() - startedAt > TIME_BUDGET_MS) { stop = true; return; }
      if (embedSpend >= dailyBudget) { stop = true; return; }
      try {
        const content = buildContent(e, model);
        const hash = await sha256(content);
        const { vec, tokens } = await embed(model, content);
        const cost = (tokens / 1000) * PRICE_IN_PER_1K;
        const vecStr = `[${vec.join(",")}]`;
        const { error: upErr } = await admin.from("episode_embeddings").upsert({
          episode_id: e.id, podcast_id: e.podcast_id,
          model, embedding: vecStr, content_hash: hash,
          updated_at: new Date().toISOString(),
        }, { onConflict: "episode_id" });
        if (upErr) throw upErr;
        embedded++; embedSpend += cost; totalSpend += cost; calls++;
      } catch (err: any) {
        errors++;
        const msg = String(err?.message || err);
        if (msg === "rate_limited") stop = true;
        if (errorSamples.length < 5) errorSamples.push({ id: e.id, error: msg });
      }
    };

    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= candidates.length || stop) return;
        await runOne(candidates[idx]);
      }
    });
    await Promise.all(workers);

    await admin.from("ai_spend_daily").upsert({
      day: dayKey, spend_usd: totalSpend, calls,
      by_kind: {
        ...byKind,
        embed_episode_usd: embedSpend,
        embed_episode_count: Number(byKind.embed_episode_count || 0) + embedded,
      },
      updated_at: new Date().toISOString(),
    });

    const { data: stats } = await admin.rpc("embed_episode_candidate_stats", { _model: model });
    const s = (stats as any) || {};
    const pending = Number(s.missing_embedding || 0);
    const durationMs = Date.now() - startedAt;

    // Adaptive cadence
    let recommended: string;
    if (pending > 2000) recommended = "* * * * *";
    else if (pending >= 200) recommended = "*/2 * * * *";
    else if (pending > 0) recommended = "*/5 * * * *";
    else recommended = "*/30 * * * *";
    if (errors > embedded || durationMs > 100_000) {
      const stepDown: Record<string, string> = {
        "* * * * *": "*/2 * * * *",
        "*/2 * * * *": "*/5 * * * *",
        "*/5 * * * *": "*/15 * * * *",
        "*/15 * * * *": "*/30 * * * *",
      };
      recommended = stepDown[recommended] || recommended;
    }
    try { await admin.rpc("set_embed_episode_schedule" as any, { _schedule: recommended }); } catch { /* ignore */ }

    const progress = {
      last_run_at: new Date().toISOString(),
      duration_ms: durationMs,
      embedded_last_run: embedded,
      errors_last_run: errors,
      error_samples: errorSamples,
      pending,
      eligible_total: Number(s.eligible_total || 0),
      already_embedded: Number(s.already_embedded || 0),
      embed_spend_usd_today: embedSpend,
      cron_schedule: recommended,
      model, batch_size: batch, concurrency,
    };
    await admin.from("app_settings").upsert({
      key: "embed_episode_progress", value: progress as any, updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    if (embedSpend >= dailyBudget) {
      const newCtrl = { ...ctrl, enabled: false, auto_paused_reason: "daily_budget_reached", auto_paused_at: new Date().toISOString() };
      await admin.from("app_settings").upsert({ key: "embed_episode_controls", value: newCtrl, updated_at: new Date().toISOString() });
    }

    return json({ ok: true, embedded, errors, pending, embed_spend_usd: embedSpend, schedule: recommended, durationMs });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
