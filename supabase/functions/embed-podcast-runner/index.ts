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
    `SUMMARY: ${(p.ai_summary || "").slice(0, 600)}`,
    `SEO: ${(p.seo_description || "").slice(0, 400)}`,
    `DESCRIPTION: ${(p.description || "").slice(0, 1600)}`,
  ];
  if (topics) parts.push(`TOPICS: ${topics}`);
  if (entities) parts.push(`ENTITIES: ${entities}`);
  return parts.join("\n");
}

async function embed(model: string, text: string): Promise<{ vec: number[]; tokens: number }> {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: text }),
  });
  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("budget_exhausted_provider");
  if (!res.ok) throw new Error(`ai_${res.status}: ${(await res.text()).slice(0, 180)}`);
  const j = await res.json();
  const vec = j.data?.[0]?.embedding as number[] | undefined;
  if (!vec || !vec.length) throw new Error("no_embedding");
  const tokens = Number(j.usage?.prompt_tokens || j.usage?.total_tokens || 0);
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

    // Candidates: S/A/B, not in bad health, not yet embedded with current model OR stale content_hash
    // Fetch a generous superset; we'll filter by hash in-process.
    const { data: candidatesRaw, error: candErr } = await admin
      .from("podcasts")
      .select("id,title,display_title,description,ai_summary,seo_description,category,rank_label,shadow_rank_components")
      .in("rank_label", tiers)
      .order("rank_label", { ascending: true }) // S < A < B alphabetically -> S first
      .order("podiverzum_rank", { ascending: false })
      .limit(batch * 6);
    if (candErr) throw candErr;

    const candidates = (candidatesRaw || []).filter((p: any) => {
      const hs = (p.shadow_rank_components as any)?.health_state;
      return !hs || !BAD_HEALTH.has(hs);
    });

    // Pull existing hashes for this slice
    const ids = candidates.map((p: any) => p.id);
    const { data: existing } = await admin
      .from("podcast_embeddings")
      .select("podcast_id, content_hash, model")
      .in("podcast_id", ids);
    const haveHash = new Map<string, { content_hash: string; model: string }>();
    (existing || []).forEach((e: any) => haveHash.set(e.podcast_id, { content_hash: e.content_hash, model: e.model }));

    let embedded = 0, cacheHits = 0, errors = 0, processed = 0;
    const errorSamples: any[] = [];

    for (const p of candidates) {
      if (processed >= batch) break;
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      if (spend >= dailyBudget) break;
      const content = buildContent(p, model);
      const hash = await sha256(content);
      const prev = haveHash.get(p.id);
      if (prev && prev.content_hash === hash && prev.model === model) {
        cacheHits++;
        continue; // already up to date
      }
      processed++;
      try {
        const { vec, tokens } = await embed(model, content);
        const cost = (tokens / 1000) * PRICE_IN_PER_1K;
        // pgvector accepts string form "[0.1,0.2,...]"
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
        spend += cost;
        calls++;
      } catch (e: any) {
        errors++;
        if (errorSamples.length < 5) errorSamples.push({ id: p.id, title: p.display_title || p.title, error: String(e?.message || e) });
      }
    }

    // Spend log
    await admin.from("ai_spend_daily").upsert({
      day: dayKey, spend_usd: spend, calls,
      by_kind: { ...(spendRow?.by_kind || {}), embed_podcast: Number((spendRow?.by_kind as any)?.embed_podcast || 0) + embedded },
      updated_at: new Date().toISOString(),
    });

    // Progress: count totals across S/A/B
    const { count: totalCandidates } = await admin
      .from("podcasts").select("id", { count: "exact", head: true })
      .in("rank_label", tiers);
    const { count: embeddedTotal } = await admin
      .from("podcast_embeddings").select("podcast_id", { count: "exact", head: true })
      .eq("model", model);
    const pending = Math.max(0, (totalCandidates || 0) - (embeddedTotal || 0));
    const ratePerMin = embedded > 0 ? embedded / Math.max(1, (Date.now() - startedAt) / 60_000) : 0;
    const etaMinutes = ratePerMin > 0 ? Math.round(pending / ratePerMin) : null;

    const progress = {
      last_run_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      total_sab_candidates: totalCandidates || 0,
      embedded_total: embeddedTotal || 0,
      pending,
      embedded_last_run: embedded,
      cache_hits_last_run: cacheHits,
      errors_last_run: errors,
      error_samples: errorSamples,
      spend_usd_today: spend,
      eta_minutes: etaMinutes,
      model,
    };
    await admin.from("app_settings").upsert({
      key: "embed_progress", value: progress as any, updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    if (spend >= dailyBudget) {
      const newCtrl = { ...ctrl, enabled: false, auto_paused_reason: "daily_budget_reached", auto_paused_at: new Date().toISOString() };
      await admin.from("app_settings").upsert({ key: "embed_controls", value: newCtrl, updated_at: new Date().toISOString() });
    }

    return json({ ok: true, embedded, cache_hits: cacheHits, errors, pending, spend_usd: spend, progress });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
