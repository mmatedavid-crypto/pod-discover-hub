// Multi-chunk episode embedder. Uses promoted episode_clean_text only,
// prefers timestamped transcript segments when their hash matches the clean text,
// falls back to char windows, prepends stable episode context, embeds each chunk,
// and upserts into episode_chunks. Adaptive cron via set_embed_episode_chunks_schedule.
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

type TimedSegment = {
  idx: number;
  start: number | null;
  end: number | null;
  text: string;
  word_count: number;
  char_start: number;
  char_end: number;
};

type ChunkSlice = {
  content: string;
  char_start: number;
  char_end: number;
  timestamp_start_seconds: number | null;
  timestamp_end_seconds: number | null;
  segment_start_idx: number | null;
  segment_end_idx: number | null;
  source_transcript_model: string | null;
  chunking_method: "segment_timestamp_v2" | "char_window_v1";
};

function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : v != null ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

function segmentTime(s: any): { start: number | null; end: number | null } {
  const start = num(s?.start ?? s?.start_seconds ?? s?.startTime ?? s?.offset);
  const explicitEnd = num(s?.end ?? s?.end_seconds ?? s?.endTime);
  const duration = num(s?.duration ?? s?.dur);
  const scale = start != null && start > 10_000 ? 1000 : 1;
  const scaledStart = start == null ? null : start / scale;
  if (explicitEnd != null) return { start: scaledStart, end: explicitEnd / (explicitEnd > 10_000 ? 1000 : 1) };
  if (scaledStart != null && duration != null) {
    const scaledDuration = duration / (duration > 10_000 ? 1000 : 1);
    return { start: scaledStart, end: scaledStart + scaledDuration };
  }
  return { start: scaledStart, end: null };
}

function wordCount(text: string): number {
  return (text.match(/\S+/g) || []).length;
}

function normalizeForAlign(text: string): string {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTimedSegments(raw: unknown, cleanedText: string): TimedSegment[] {
  if (!Array.isArray(raw)) return [];
  const cleanedNorm = normalizeForAlign(cleanedText);
  if (cleanedNorm.length < 80) return [];
  let cursor = 0;
  let charCursor = 0;
  let aligned = 0;
  const out: TimedSegment[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = raw[i] as any;
    const text = String(row?.text ?? row?.transcript ?? row?.content ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    const wc = wordCount(text);
    if (wc === 0) continue;
    const norm = normalizeForAlign(text);
    if (norm.length < 4) continue;
    const found = cleanedNorm.indexOf(norm, cursor);
    if (found >= 0) {
      cursor = found + norm.length;
      aligned++;
    } else {
      const loose = cleanedNorm.indexOf(norm);
      if (loose === -1) continue;
      aligned++;
    }
    const { start, end } = segmentTime(row);
    const charStart = charCursor;
    charCursor += text.length + 1;
    out.push({
      idx: i,
      start,
      end,
      text,
      word_count: wc,
      char_start: charStart,
      char_end: Math.max(charStart, charCursor - 1),
    });
  }
  const timed = out.filter((s) => s.start != null).length;
  return timed >= 3 && aligned >= 3 ? out : [];
}

function buildTimedChunk(
  segments: TimedSegment[],
  transcriptModel: string | null,
): ChunkSlice {
  const content = segments.map((s) => s.text).join(" ").replace(/\s+/g, " ").trim();
  const timed = segments.filter((s) => s.start != null || s.end != null);
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    content,
    char_start: first?.char_start ?? 0,
    char_end: last?.char_end ?? 0,
    timestamp_start_seconds: timed.length ? Math.round(Number(timed[0].start ?? timed[0].end ?? 0)) : null,
    timestamp_end_seconds: timed.length ? Math.round(Number((timed[timed.length - 1].end ?? timed[timed.length - 1].start) ?? 0)) : null,
    segment_start_idx: first?.idx ?? null,
    segment_end_idx: last?.idx ?? null,
    source_transcript_model: transcriptModel,
    chunking_method: "segment_timestamp_v2",
  };
}

function suffixOverlap(segments: TimedSegment[], overlapWords: number): TimedSegment[] {
  const out: TimedSegment[] = [];
  let words = 0;
  for (let i = segments.length - 1; i >= 0; i--) {
    out.unshift(segments[i]);
    words += segments[i].word_count;
    if (words >= overlapWords) break;
  }
  return out;
}

function chunkTimedSegments(raw: unknown, cleanedText: string, transcriptModel: string | null): ChunkSlice[] {
  const segments = parseTimedSegments(raw, cleanedText);
  if (segments.length < 3) return [];
  const minWords = 150;
  const maxWords = 250;
  const overlapWords = 50;
  const slices: ChunkSlice[] = [];
  let current: TimedSegment[] = [];
  let words = 0;
  let hasNewContentSinceClose = false;

  const closeCurrent = () => {
    if (current.length === 0 || !hasNewContentSinceClose) return;
    slices.push(buildTimedChunk(current, transcriptModel));
    current = suffixOverlap(current, overlapWords);
    words = current.reduce((sum, s) => sum + s.word_count, 0);
    hasNewContentSinceClose = false;
  };

  for (const seg of segments) {
    const prev = current[current.length - 1];
    const gap = prev?.end != null && seg.start != null ? seg.start - prev.end : 0;
    if (current.length > 0 && words >= minWords && gap >= 3) closeCurrent();
    current.push(seg);
    words += seg.word_count;
    hasNewContentSinceClose = true;
    if (words >= maxWords) closeCurrent();
  }

  if (current.length > 0 && hasNewContentSinceClose) {
    const lastWords = current.reduce((sum, s) => sum + s.word_count, 0);
    if (lastWords >= 40 || slices.length === 0) slices.push(buildTimedChunk(current, transcriptModel));
  }

  return slices
    .filter((s) => s.content.length >= 80)
    .slice(0, 120);
}

function buildChunkSlices(e: any, chunkChars: number, chunkOverlap: number): ChunkSlice[] {
  const cleanedText = String(e.cleaned_text || "").trim();
  const timed = chunkTimedSegments(e.transcript_segments, cleanedText, e.transcript_model ? String(e.transcript_model) : null);
  if (timed.length > 0) return timed;
  return chunkText(cleanedText, chunkChars, chunkOverlap).map((s) => ({
    content: s.content,
    char_start: s.char_start,
    char_end: s.char_end,
    timestamp_start_seconds: null,
    timestamp_end_seconds: null,
    segment_start_idx: null,
    segment_end_idx: null,
    source_transcript_model: null,
    chunking_method: "char_window_v1",
  }));
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
          if (cleanedText.length < 80 || !cleanedMethod.startsWith("deterministic_v4")) {
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
            ? buildChunkSlices(e, chunkChars, chunkOverlap)
            : [];
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
              timestamp_start_seconds: s.timestamp_start_seconds,
              timestamp_end_seconds: s.timestamp_end_seconds,
              segment_start_idx: s.segment_start_idx,
              segment_end_idx: s.segment_end_idx,
              source_transcript_model: s.source_transcript_model,
              chunking_method: s.chunking_method,
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
      chunking_policy: "timestamp_aware_v2_segments_when_available_else_char_window_v1",
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
