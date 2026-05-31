// Multi-chunk episode embedder. Uses promoted episode_clean_text only,
// then chunks the cleaned text into 2500-char windows (250 overlap),
// prepends a stable prefix (title + ai_summary + entities), embeds each chunk,
// upserts into episode_chunks. Adaptive cron via set_embed_episode_chunks_schedule.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { chunkText } from "../_shared/episode-text-cleaner.ts";
import { embeddingTokenCostUsd } from "../_shared/ai-pricing.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function buildPrefix(e: any): string {
  const arr = (a: any) => (Array.isArray(a) ? a.slice(0, 8).join(", ") : "");
  const parts: string[] = [];
  parts.push(`PODCAST: ${e.podcast_display_title || e.podcast_title || ""}`);
  parts.push(`EPISODE: ${e.display_title || e.title || ""}`);
  if (e.ai_summary) parts.push(`SUMMARY: ${String(e.ai_summary).slice(0, 1500)}`);
  const topics = arr(e.topics); if (topics) parts.push(`TOPICS: ${topics}`);
  const people = arr(e.people); if (people) parts.push(`PEOPLE: ${people}`);
  const companies = arr(e.companies); if (companies) parts.push(`COMPANIES: ${companies}`);
  const tickers = arr(e.tickers); if (tickers) parts.push(`TICKERS: ${tickers}`);
  return parts.join("\n");
}

function usefulPrefixText(e: any): string {
  const arr = (a: any) => (Array.isArray(a) ? a.slice(0, 8).join(" ") : "");
  return [
    e.ai_summary,
    arr(e.topics),
    arr(e.people),
    arr(e.companies),
    arr(e.tickers),
  ].map((value) => String(value || "")).join(" ");
}

function validateEmbeddingInput(text: string): string | null {
  const stripped = text
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/@[A-Za-z0-9_.-]+/g, " ")
    .replace(/\b(undefined|null|\[object Object\])\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) return "embedding_input_empty";
  if (stripped.length < 80) return "embedding_input_too_short";
  return null;
}

async function embed(model: string, text: string): Promise<{ vec: number[]; tokens: number }> {
  const googleModel = model.replace(/^google\//, "");
  // Prefer paid Tier-1 key for drain throughput; fall back to default/free key.
  const apiKey = Deno.env.get("GEMINI_API_KEY_TIER1")
    || Deno.env.get("GEMINI_API_KEY")
    || Deno.env.get("GEMINI_API_KEY_FREE");
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
  if (!vec || vec.length !== 768) throw new Error("bad_embedding");
  return { vec, tokens: Math.ceil(text.length / 4) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  // CPU-budget on edge runtime is tight when each chunk = 768 floats + sha256.
  // Keep wall time short so we exit cleanly and write progress before CPU exceeds.
  const TIME_BUDGET_MS = 22_000;
  const TIME_RESERVE_MS = 5_000;

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "embed-episode-chunks-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });
    const body = await req.json().catch(() => ({}));

    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "embed_episode_chunks_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false) {
      try { await admin.rpc("set_embed_episode_chunks_schedule" as any, { _schedule: "*/30" }); } catch { }
      return json({ ok: true, paused: true });
    }
    const model = String(ctrl.model || "google/gemini-embedding-001");
    const dailyBudget = Number(ctrl.daily_budget_usd ?? 3.0);
    const chunkChars = Math.max(1000, Math.min(6000, Number(ctrl.chunk_chars || 2500)));
    const chunkOverlap = Math.max(0, Math.min(1000, Number(ctrl.chunk_overlap || 250)));
    const batch = Math.max(1, Math.min(100, Number(body.batch) || Number(ctrl.batch_size) || 30));
    const concurrency = Math.max(1, Math.min(16, Number(body.concurrency) || Number(ctrl.concurrency) || 6));

    const dayKey = new Date().toISOString().slice(0, 10);
    const { data: spendRow } = await admin.from("ai_spend_daily").select("by_kind").eq("day", dayKey).maybeSingle();
    const byKind = (spendRow?.by_kind as any) || {};
    let embedSpend = Number(byKind.embed_episode_chunks_usd || 0);
    let embedSpendIncrement = 0;
    let runCalls = 0;
    if (embedSpend >= dailyBudget) {
      try { await admin.rpc("set_embed_episode_chunks_schedule" as any, { _schedule: "*/30" }); } catch { }
      return json({ ok: true, budget_reached: true, embed_spend: embedSpend });
    }

    let episodesProcessed = 0, chunksWritten = 0, skipped = 0, errors = 0;
    const errorSamples: any[] = [];
    let stop = false, drainPasses = 0;

    while (!stop) {
      if (Date.now() - startedAt > TIME_BUDGET_MS - TIME_RESERVE_MS) break;
      if (embedSpend >= dailyBudget) break;

      const { data: candRows, error: candErr } = await admin.rpc("select_embed_chunks_candidates", {
        _model: model, _limit: batch,
      });
      if (candErr) throw candErr;
      const candidates: any[] = (candRows as any[]) || [];
      if (candidates.length === 0) break;
      drainPasses++;

      let i = 0;
      const runOne = async (e: any) => {
        if (stop) return;
        if (Date.now() - startedAt > TIME_BUDGET_MS - TIME_RESERVE_MS) { stop = true; return; }
        if (embedSpend >= dailyBudget) { stop = true; return; }
        try {
          const cleanedText = String(e.cleaned_text || "").trim();
          const cleanedMethod = String(e.cleaner_method || "missing_clean_text");
          if (cleanedText.length < 80 || cleanedMethod !== "deterministic_v4") {
            skipped++;
            if (errorSamples.length < 5) errorSamples.push({ id: e.id, skipped: "requires_promoted_deterministic_v4_clean_text", cleaned_method: cleanedMethod });
            return;
          }

          const prefix = buildPrefix(e);
          const skipReason = validateEmbeddingInput(`${usefulPrefixText(e)} ${cleanedText}`);
          if (skipReason) {
            skipped++;
            if (errorSamples.length < 5) errorSamples.push({ id: e.id, skipped: skipReason, cleaned_method: cleanedMethod });
            return;
          }
          const slices = cleanedText.length > 0
            ? chunkText(cleanedText, chunkChars, chunkOverlap)
            : [{ content: "", char_start: 0, char_end: 0 }];
          const chunkCount = slices.length;

          const rows: any[] = [];
          for (let idx = 0; idx < slices.length; idx++) {
            if (stop) return;
            if (embedSpend >= dailyBudget) { stop = true; return; }
            const s = slices[idx];
            const content = s.content
              ? `${prefix}\nCONTENT:\n${s.content}`
              : prefix;
            const hash = await sha256(`${model}|${idx}/${chunkCount}|${content}`);
            const { vec, tokens } = await embed(model, content);
            const cost = embeddingTokenCostUsd(model, tokens);
            embedSpend += cost; embedSpendIncrement += cost; runCalls++;
            rows.push({
              episode_id: e.id,
              podcast_id: e.podcast_id,
              chunk_idx: idx,
              chunk_count: chunkCount,
              content,
              content_hash: hash,
              char_start: s.char_start,
              char_end: s.char_end,
              model,
              embedding: `[${vec.join(",")}]`,
              updated_at: new Date().toISOString(),
            });
          }

          if (rows.length === 0) return;

          const { error: upErr } = await admin.from("episode_chunks").upsert(rows, { onConflict: "episode_id,chunk_idx" });
          if (upErr) throw upErr;
          await admin.from("episode_chunks")
            .delete()
            .eq("episode_id", e.id)
            .eq("model", model)
            .gte("chunk_idx", chunkCount);

          episodesProcessed++;
          chunksWritten += rows.length;
          void cleanedMethod;
        } catch (err: any) {
          errors++;
          if (errorSamples.length < 5) errorSamples.push({ id: e.id, error: String(err?.message || err) });
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
      if (candidates.length < batch) break;
    }

    // Atomic per-key merge — does NOT clobber other runners' by_kind entries.
    if (embedSpendIncrement > 0 || chunksWritten > 0) {
      await admin.rpc("merge_ai_spend", {
        p_day: dayKey,
        p_delta: {
          embed_episode_chunks_usd: embedSpendIncrement,
          embed_episode_chunks_count: chunksWritten,
        } as any,
        p_total_amount: embedSpendIncrement,
        p_calls: runCalls,
      } as any);
    }

    const { data: stats } = await admin.rpc("embed_chunks_candidate_stats", { _model: model });
    const s = (stats as any) || {};
    const pending = Number(s.missing || 0);

    // RPC expects minute-part only (e.g., "*", "*/2", "*/15", "*/30", "0 * * * *")
    let recommended: string;
    if (pending > 2000) recommended = "*";
    else if (pending >= 200) recommended = "*/2";
    else if (pending > 0) recommended = "*/15";
    else recommended = "*/30";
    if (errors > episodesProcessed && episodesProcessed > 0) {
      const stepDown: Record<string, string> = { "*": "*/2", "*/2": "*/15", "*/15": "*/30" };
      recommended = stepDown[recommended] || recommended;
    }
    try { await admin.rpc("set_embed_episode_chunks_schedule" as any, { _schedule: recommended }); } catch { }

    const progress = {
      last_run_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      episodes_last_run: episodesProcessed,
      chunks_last_run: chunksWritten,
      skipped_last_run: skipped,
      errors_last_run: errors,
      error_samples: errorSamples,
      pending_missing: pending,
      eligible_total: Number(s.eligible_total || 0),
      already_chunked: Number(s.already_chunked || 0),
      total_chunks: Number(s.total_chunks || 0),
      waiting_for_clean_text: Number(s.waiting_for_clean_text || 0),
      embed_spend_usd_today: embedSpend,
      cron_schedule: recommended,
      model, chunk_chars: chunkChars, chunk_overlap: chunkOverlap,
      batch_size: batch, concurrency, drain_passes: drainPasses,
      source_policy: "best_source_then_deterministic_v4_clean_text_then_embedding",
    };
    await admin.from("app_settings").upsert({
      key: "embed_episode_chunks_progress",
      value: progress as any,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    if (embedSpend >= dailyBudget) {
      const newCtrl = { ...ctrl, enabled: false, auto_paused_reason: "daily_budget_reached", auto_paused_at: new Date().toISOString() };
      await admin.from("app_settings").upsert({ key: "embed_episode_chunks_controls", value: newCtrl, updated_at: new Date().toISOString() });
    }

    return json({ ok: true, episodes: episodesProcessed, chunks: chunksWritten, skipped, errors, pending, waiting_for_clean_text: Number(s.waiting_for_clean_text || 0), embed_spend_usd: embedSpend, schedule: recommended });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
