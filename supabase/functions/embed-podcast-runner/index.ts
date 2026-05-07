// Embeds S/A/B podcasts using Lovable AI Gateway (google/text-embedding-004, 768d).
// - Skips bad health states.
// - Caches by content_hash (skips when unchanged).
// - Daily $ budget cap, retries via attempts counter in app_settings.
// - Writes progress to app_settings.embed_progress.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const BAD_HEALTH = new Set([
  "rss_url_not_found",
  "needs_manual_rss_review",
  "confirmed_dead",
  "quarantined_spam",
]);

// google/text-embedding-004 ~ $0.000025 per 1k input tokens (effectively free at our scale)
const PRICE_IN_PER_1K = 0.000025;

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildContent(p: any, model: string): string {
  const comp = (p.shadow_rank_components as any) || {};
  const topics = Array.isArray(comp.topics) ? comp.topics.slice(0, 12).join(", ") : "";
  const entities = Array.isArray(comp.entities) ? comp.entities.slice(0, 12).join(", ") : "";
  const parts = [
    `MODEL: ${model}`,
    `TITLE: ${p.display_title || p.title || ""}`,
    `CATEGORY: ${p.category || ""}`,
    `RANK: ${p.rank_label || ""}`,
    `SUMMARY: ${("").slice(0, 600)}`,
    `SEO: ${(p.seo_description || "").slice(0, 400)}`,
    `DESCRIPTION: ${(p.description || "").slice(0, 1600)}`,
  ];
  if (topics) parts.push(`TOPICS: ${topics}`);
  if (entities) parts.push(`ENTITIES: ${entities}`);
  return parts.join("\n");
}

async function embed(model: string, text: string): Promise<{ vec: number[]; tokens: number }> {
  // Gemini direct API. We always request 768-dim to match our pgvector column.
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
  if (!vec || !vec.length) throw new Error("no_embedding");
  if (vec.length !== 768) throw new Error(`bad_dim_${vec.length}`);
  const tokens = Math.ceil(text.length / 4);
  return { vec, tokens };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 50_000;

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));

    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "embed_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false) return json({ ok: true, paused: true });

    const model = String(ctrl.model || "google/text-embedding-004");
    const dailyBudget = Number(ctrl.daily_budget_usd ?? 0.5);
    const tiers: string[] = Array.isArray(ctrl.tiers) ? ctrl.tiers : ["S", "A", "B"];
    const batch = Math.max(1, Math.min(100, Number(body.batch) || Number(ctrl.batch_size) || 25));

    // Today's spend — embed runner tracks its OWN budget via by_kind.embed_podcast_usd
    const dayKey = new Date().toISOString().slice(0, 10);
    const { data: spendRow } = await admin.from("ai_spend_daily").select("*").eq("day", dayKey).maybeSingle();
    const byKind = (spendRow?.by_kind as any) || {};
    let embedSpend = Number(byKind.embed_podcast_usd || 0);
    let totalSpend = Number(spendRow?.spend_usd || 0);
    let calls = Number(spendRow?.calls || 0);
    if (embedSpend >= dailyBudget) return json({ ok: true, budget_reached: true, embed_spend: embedSpend });

    // Candidate selection — done-marker-before-LIMIT.
    // Use SQL helper that LEFT JOINs podcast_embeddings (model match) and excludes
    // already-embedded + bad-health rows BEFORE ORDER BY/LIMIT. This guarantees we
    // always select up to `batch` un-embedded eligible rows whenever any exist.
    const { data: freshRows, error: candErr } = await admin.rpc("select_embed_candidates", {
      _model: model,
      _tiers: tiers,
      _limit: batch,
    });
    if (candErr) throw candErr;
    let candidates: any[] = (freshRows as any[]) || [];

    // Optional stale-hash refresh: only when no fresh missing candidates remain,
    // re-check existing rows for content_hash drift. Capped to `batch`.
    const haveHash = new Map<string, { content_hash: string; model: string }>();
    let staleHashSelected = 0;
    if (candidates.length === 0) {
      // Pull a small sample of existing embeddings ordered by oldest updated_at.
      const { data: existing } = await admin
        .from("podcast_embeddings")
        .select("podcast_id, content_hash, model, updated_at")
        .eq("model", model)
        .order("updated_at", { ascending: true })
        .limit(batch * 4);
      const ids = (existing || []).map((e: any) => e.podcast_id);
      (existing || []).forEach((e: any) =>
        haveHash.set(e.podcast_id, { content_hash: e.content_hash, model: e.model })
      );
      if (ids.length > 0) {
        const { data: pods } = await admin
          .from("podcasts")
          .select("id,title,display_title,description,seo_description,category,rank_label,shadow_rank_components")
          .in("id", ids)
          .in("rank_label", tiers);
        const filtered = (pods || []).filter((p: any) => {
          const hs = (p.shadow_rank_components as any)?.health_state;
          return !hs || !BAD_HEALTH.has(hs);
        });
        candidates = filtered.slice(0, batch);
        staleHashSelected = candidates.length;
      }
    }

    let embedded = 0, cacheHits = 0, errors = 0, processed = 0;
    const errorSamples: any[] = [];

    for (const p of candidates) {
      if (processed >= batch) break;
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      if (embedSpend >= dailyBudget) break;
      const content = buildContent(p, model);
      const hash = await sha256(content);
      const prev = haveHash.get(p.id);
      if (prev && prev.content_hash === hash && prev.model === model) {
        cacheHits++;
        continue;
      }
      processed++;
      try {
        const { vec, tokens } = await embed(model, content);
        const cost = (tokens / 1000) * PRICE_IN_PER_1K;
        const vecStr = `[${vec.join(",")}]`;
        const { error: upErr } = await admin.from("podcast_embeddings").upsert({
          podcast_id: p.id,
          model,
          embedding: vecStr,
          content_hash: hash,
          updated_at: new Date().toISOString(),
        }, { onConflict: "podcast_id" });
        if (upErr) throw upErr;
        embedded++;
        embedSpend += cost;
        totalSpend += cost;
        calls++;
      } catch (e: any) {
        errors++;
        if (errorSamples.length < 5) errorSamples.push({ id: p.id, title: p.display_title || p.title, error: String(e?.message || e) });
      }
    }

    await admin.from("ai_spend_daily").upsert({
      day: dayKey, spend_usd: totalSpend, calls,
      by_kind: {
        ...byKind,
        embed_podcast_usd: embedSpend,
        embed_podcast_count: Number(byKind.embed_podcast_count || 0) + embedded,
      },
      updated_at: new Date().toISOString(),
    });

    const { count: totalCandidates } = await admin
      .from("podcasts").select("id", { count: "exact", head: true })
      .in("rank_label", tiers);
    const { count: embeddedTotal } = await admin
      .from("podcast_embeddings").select("podcast_id", { count: "exact", head: true })
      .eq("model", model);
    const pending = Math.max(0, (totalCandidates || 0) - (embeddedTotal || 0));
    const durationMs = Date.now() - startedAt;
    const ratePerMin = embedded > 0 ? embedded / Math.max(1, durationMs / 60_000) : 0;
    const etaMinutes = ratePerMin > 0 ? Math.round(pending / ratePerMin) : null;

    // Adaptive cadence policy
    let recommendedSchedule: string;
    if (pending > 500) recommendedSchedule = "* * * * *";
    else if (pending >= 100) recommendedSchedule = "*/2 * * * *";
    else if (pending > 0) recommendedSchedule = "*/5 * * * *";
    else recommendedSchedule = "*/15 * * * *";

    // Guardrails: back off if runs are slow or errored
    if (durationMs > 40_000 || errors > 0) {
      const stepDown: Record<string, string> = {
        "* * * * *": "*/2 * * * *",
        "*/2 * * * *": "*/5 * * * *",
        "*/5 * * * *": "*/15 * * * *",
      };
      recommendedSchedule = stepDown[recommendedSchedule] || recommendedSchedule;
    }

    // Rolling avg duration + current schedule from previous progress
    const { data: prevProg } = await admin.from("app_settings").select("value").eq("key", "embed_progress").maybeSingle();
    const prev = (prevProg?.value as any) || {};
    const prevAvg = Number(prev.avg_duration_ms || prev.duration_ms || durationMs);
    const avgDurationMs = Math.round(prevAvg * 0.7 + durationMs * 0.3);
    const currentSchedule = String(prev.cron_schedule || "* * * * *");
    const cronIntervalMin = currentSchedule === "* * * * *" ? 1
      : currentSchedule === "*/2 * * * *" ? 2
      : currentSchedule === "*/5 * * * *" ? 5
      : currentSchedule === "*/15 * * * *" ? 15
      : currentSchedule === "*/30 * * * *" ? 30 : 1;
    const effectivePerHour = embedded > 0 ? Math.round((embedded / cronIntervalMin) * 60) : 0;

    // Apply schedule change if recommendation differs from current
    let scheduleApplied = currentSchedule;
    if (recommendedSchedule !== currentSchedule) {
      const { error: schedErr } = await admin.rpc("set_embed_schedule", { _schedule: recommendedSchedule });
      if (!schedErr) scheduleApplied = recommendedSchedule;
    }

    const progress = {
      last_run_at: new Date().toISOString(),
      duration_ms: durationMs,
      avg_duration_ms: avgDurationMs,
      total_sab_candidates: totalCandidates || 0,
      embedded_total: embeddedTotal || 0,
      pending,
      embedded_last_run: embedded,
      cache_hits_last_run: cacheHits,
      errors_last_run: errors,
      error_samples: errorSamples,
      embed_spend_usd_today: embedSpend,
      eta_minutes: etaMinutes,
      effective_per_hour: effectivePerHour,
      cron_schedule: scheduleApplied,
      recommended_schedule: recommendedSchedule,
      model,
    };
    await admin.from("app_settings").upsert({
      key: "embed_progress", value: progress as any, updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    if (embedSpend >= dailyBudget) {
      const newCtrl = { ...ctrl, enabled: false, auto_paused_reason: "daily_budget_reached", auto_paused_at: new Date().toISOString() };
      await admin.from("app_settings").upsert({ key: "embed_controls", value: newCtrl, updated_at: new Date().toISOString() });
    }

    return json({ ok: true, embedded, cache_hits: cacheHits, errors, pending, embed_spend_usd: embedSpend, progress });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
