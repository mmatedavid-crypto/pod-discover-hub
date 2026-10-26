// Podcast similarity embeddings ("Hasonló podcastok"), v2.
// - Every accepted, healthy HU podcast (all rank tiers) gets an embedding.
// - Input: podcast metadata + RSS episode titles + topic labels (_shared/podcast-embedding-content.ts).
// - Due set comes from select_podcast_embed_candidates_v2: missing → outdated version → 14-day re-check.
//   A re-check re-embeds only when the content hash really changed; otherwise it just stamps checked_at.
// - Failures back off (podcast_embedding_failures) and dead-letter after 5 attempts.
// - Cadence is owned by queue-health-controller (controls key embed_podcast_controls); this runner
//   never edits its own cron, so there is a single cron writer.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { embeddingTokenCostUsd } from "../_shared/ai-pricing.ts";
import { embedText } from "../_shared/gateway-embed.ts";
import { runLog } from "../_shared/runner-run-log.ts";
import {
  buildPodcastEmbeddingContent,
  PODCAST_EMBED_CONTENT_VERSION,
  podcastTopTopics,
} from "../_shared/podcast-embedding-content.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const CONTROLS_KEY = "embed_podcast_controls";
const MODEL = "google/gemini-embedding-001";
const TIME_BUDGET_MS = 45_000;
const CONCURRENCY = 4;

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const log = runLog(admin, "embed_podcast");

  try {
    const guard = await checkBackgroundJobsAllowed(admin, "embed-podcast-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });
    const body = await req.json().catch(() => ({}));

    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as Record<string, any>;
    if (ctrl.enabled === false) return json({ ok: true, paused: true, reason: ctrl.auto_paused_reason ?? ctrl.paused_reason ?? null });

    const dailyBudget = Math.min(Number(ctrl.daily_budget_usd ?? 1), 2);
    const batch = Math.max(1, Math.min(120, Number(body.batch) || Number(ctrl.batch) || 60));
    const refreshDays = Math.max(3, Math.min(60, Number(ctrl.refresh_days) || 14));

    const dayKey = new Date().toISOString().slice(0, 10);
    const { data: spendRow } = await admin.from("ai_spend_daily").select("by_kind").eq("day", dayKey).maybeSingle();
    const spentToday = Number(((spendRow?.by_kind as any) || {}).embed_podcast_usd || 0);
    if (spentToday >= dailyBudget) return json({ ok: true, budget_reached: true, spent_today: spentToday });

    const { data: due, error: dueErr } = await admin.rpc("select_podcast_embed_candidates_v2", {
      _limit: batch, _version: PODCAST_EMBED_CONTENT_VERSION, _refresh_days: refreshDays,
    });
    if (dueErr) throw dueErr;
    const dueRows = (due as { id: string; reason: string }[]) || [];
    if (!dueRows.length) return json({ ok: true, due: 0 });

    await log.start({ due: dueRows.length, batch });
    const ids = dueRows.map((r) => r.id);
    const [{ data: inputs, error: inErr }, { data: existing }] = await Promise.all([
      admin.rpc("get_podcast_embedding_inputs_v2", { _ids: ids }),
      admin.from("podcast_embeddings").select("podcast_id, content_hash, content_version, model").in("podcast_id", ids),
    ]);
    if (inErr) throw inErr;
    const prevById = new Map(((existing as any[]) || []).map((e) => [e.podcast_id, e]));
    const inputById = new Map(((inputs as any[]) || []).map((i) => [i.id, i]));

    let embedded = 0, unchanged = 0, errors = 0, spend = 0, tokensTotal = 0;
    const errorSamples: unknown[] = [];
    const queue = [...dueRows];

    const work = async () => {
      while (queue.length) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) return;
        if (spentToday + spend >= dailyBudget) return;
        const row = queue.shift()!;
        const input = inputById.get(row.id);
        if (!input) continue;
        const content = buildPodcastEmbeddingContent(input);
        const topTopics = podcastTopTopics(input);
        const hash = await sha256(`v${PODCAST_EMBED_CONTENT_VERSION}|${MODEL}|${content}`);
        const prev = prevById.get(row.id);
        const { data: grp } = await admin.rpc("recommendation_text_group", {
          p_title: null, p_podcast_title: input.title, p_category: input.category, p_topics: topTopics,
        });
        const now = new Date().toISOString();

        if (prev && prev.content_hash === hash && prev.model === MODEL && prev.content_version >= PODCAST_EMBED_CONTENT_VERSION) {
          await admin.from("podcast_embeddings")
            .update({ checked_at: now, rec_group: grp ?? null, top_topics: topTopics })
            .eq("podcast_id", row.id);
          unchanged++;
          continue;
        }
        try {
          const vec = await embedText(content, { model: MODEL, taskType: "SEMANTIC_SIMILARITY" });
          if (!vec) throw new Error("no_embedding");
          const tokens = Math.ceil(content.length / 4);
          tokensTotal += tokens;
          spend += embeddingTokenCostUsd(MODEL, tokens);
          const { error: upErr } = await admin.from("podcast_embeddings").upsert({
            podcast_id: row.id, model: MODEL, embedding: `[${vec.join(",")}]`, content_hash: hash,
            content_version: PODCAST_EMBED_CONTENT_VERSION, rec_group: grp ?? null, top_topics: topTopics,
            checked_at: now, updated_at: now,
          }, { onConflict: "podcast_id" });
          if (upErr) throw upErr;
          await admin.from("podcast_embedding_failures").delete().eq("podcast_id", row.id);
          embedded++;
        } catch (e) {
          errors++;
          const msg = String((e as Error)?.message || e).slice(0, 300);
          if (errorSamples.length < 5) errorSamples.push({ id: row.id, error: msg });
          const { data: f } = await admin.from("podcast_embedding_failures").select("attempts").eq("podcast_id", row.id).maybeSingle();
          const attempts = Number(f?.attempts || 0) + 1;
          await admin.from("podcast_embedding_failures").upsert({
            podcast_id: row.id, attempts, last_error: msg,
            next_attempt_at: new Date(Date.now() + Math.min(24, 2 ** attempts) * 3600_000).toISOString(),
            updated_at: now,
          }, { onConflict: "podcast_id" });
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, work));

    if (spend > 0) {
      // Re-read today's row right before writing so a concurrent writer's counters survive.
      const { data: fresh } = await admin.from("ai_spend_daily").select("*").eq("day", dayKey).maybeSingle();
      const byKind = ((fresh?.by_kind as any) || {});
      await admin.from("ai_spend_daily").upsert({
        day: dayKey,
        spend_usd: Number(fresh?.spend_usd || 0) + spend,
        calls: Number(fresh?.calls || 0) + embedded,
        by_kind: {
          ...byKind,
          embed_podcast_usd: Number(byKind.embed_podcast_usd || 0) + spend,
          embed_podcast_count: Number(byKind.embed_podcast_count || 0) + embedded,
        },
        updated_at: new Date().toISOString(),
      });
    }

    const result = {
      due: dueRows.length, embedded, unchanged, errors, spend_usd: Number(spend.toFixed(5)), tokens: tokensTotal,
      runtime_ms: Date.now() - startedAt, error_samples: errorSamples,
    };
    await admin.from("app_settings").upsert({
      key: "embed_progress",
      value: { ...result, model: MODEL, content_version: PODCAST_EMBED_CONTENT_VERSION, last_run_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });
    await log.finish(errors && !embedded && !unchanged ? "error" : "ok", result);
    return json({ ok: true, ...result });
  } catch (e) {
    const msg = String((e as Error)?.message || e);
    await log.finish("error", {}, msg);
    return json({ ok: false, error: msg }, 500);
  }
});
