// embed-episode-runner v2 — restores episode search vectors (episode_embeddings).
// The old runner was paused on 2026-05-21 and deleted on 2026-06-15 while search_episodes_hybrid
// still read these vectors, so every new episode since then lacked its semantic search channel.
// Candidates: accepted Hungarian episodes (all tiers) with verified deterministic_v4 clean text and
// no vector, newest first; unembeddable/failing rows back off in episode_embedding_skips.
// Starts only from the scheduler (per-job token), the service role, or a signed-in admin.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { embeddingTokenCostUsd } from "../_shared/ai-pricing.ts";
import { embedText } from "../_shared/gateway-embed.ts";
import { runLog } from "../_shared/runner-run-log.ts";
import {
  buildEpisodeEmbeddingContent, embeddingSkipReason, EPISODE_EMBED_MODEL, EPISODE_EMBED_VERSION, nextAttemptDelayMs,
} from "../_shared/episode-embedding-content.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });
const JOB = "embed-episode-runner";
const CONTROLS_KEY = "embed_episode_controls";
const TIME_BUDGET_MS = 100_000;

function sameToken(a: string, b: string) {
  if (a.length < 32 || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

async function authorized(admin: any, req: Request) {
  const given = req.headers.get("x-internal-token") || "";
  if (given) {
    const { data } = await admin.from("internal_job_tokens").select("token").eq("job", JOB).maybeSingle();
    if (sameToken(String(data?.token || ""), given)) return true;
  }
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  if (jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: u } = await admin.auth.getUser(jwt).catch(() => ({ data: null as any }));
  if (!u?.user?.id) return false;
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!role;
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function readControls(admin: any) {
  const { data } = await admin.from("app_settings").select("value").eq("key", CONTROLS_KEY).maybeSingle();
  return (data?.value || {}) as Record<string, any>;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await authorized(admin, req))) return json({ error: "forbidden" }, 403);
  const guard = await checkBackgroundJobsAllowed(admin, JOB);
  if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

  const body = await req.json().catch(() => ({} as any));
  // Read-only probe (admin/service): re-embed given episodes and compare with their stored vector.
  if (Array.isArray(body?.probe_episode_ids) && body.probe_episode_ids.length) {
    const ids = body.probe_episode_ids.slice(0, 5).map(String);
    const { data: rows } = await admin.from("episodes").select("id,podcast_id,title,display_title,seo_description,ai_summary,topics,people,companies,tickers,ingredients,podcasts!inner(title,display_title,category)").in("id", ids);
    const { data: cts } = await admin.from("episode_clean_text").select("episode_id,cleaned_text,cleaner_method").in("episode_id", ids).like("cleaner_method", "deterministic_v4%");
    const { data: stored } = await admin.from("episode_embeddings").select("episode_id,embedding,content_hash,updated_at").in("episode_id", ids);
    const out: any[] = [];
    for (const r of rows || []) {
      const ct = (cts || []).find((c: any) => c.episode_id === r.id);
      const input = { ...r, podcast_title: (r as any).podcasts?.title, podcast_display_title: (r as any).podcasts?.display_title,
        podcast_category: (r as any).podcasts?.category, clean_text: String(ct?.cleaned_text || "").slice(0, 1600) };
      const content = buildEpisodeEmbeddingContent(input);
      const st = (stored || []).find((x: any) => x.episode_id === r.id);
      const old = st ? (typeof st.embedding === "string" ? JSON.parse(st.embedding) : st.embedding) as number[] : null;
      const cos = (a: number[], b: number[]) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb); };
      const viaGateway = await embedText(content, { model: EPISODE_EMBED_MODEL });
      out.push({ id: r.id, stored_at: st?.updated_at, same_content: st ? st.content_hash === await sha256(content) : null,
        cos_gateway_vs_stored: old && viaGateway ? Number(cos(old, viaGateway).toFixed(4)) : null });
    }
    return json({ ok: true, probe: out });
  }
  const ctrl = await readControls(admin);
  if (ctrl.enabled !== true) return json({ ok: true, paused: true, reason: "disabled_by_controls" });
  const model = String(ctrl.model || EPISODE_EMBED_MODEL);
  const dailyBudget = Math.max(0, Number(ctrl.daily_budget_usd ?? 2));
  const batch = Math.max(1, Math.min(200, Number(ctrl.batch_size) || 100));
  const concurrency = Math.max(1, Math.min(16, Number(ctrl.concurrency) || 8));
  // The first run hit the edge CPU limit after ~1,500 vectors; stay well below it.
  const reembedBefore = typeof ctrl.reembed_before === "string" && !Number.isNaN(Date.parse(ctrl.reembed_before)) ? ctrl.reembed_before : null;
  const maxPerRun = Math.max(50, Math.min(1000, Number(ctrl.max_per_run) || 600));

  const day = new Date().toISOString().slice(0, 10);
  const { data: spendRow } = await admin.from("ai_spend_daily").select("by_kind").eq("day", day).maybeSingle();
  const spentBefore = Number((spendRow?.by_kind as any)?.embed_episode ?? 0) || 0;
  if (spentBefore >= dailyBudget) return json({ ok: true, paused: true, reason: "daily_budget_reached", spent_today: spentBefore });

  const log = runLog(admin, JOB);
  await log.start({ model, version: EPISODE_EMBED_VERSION, daily_budget_usd: dailyBudget });
  let embedded = 0, skipped = 0, errors = 0, calls = 0, cost = 0, passes = 0, reembedPasses = 0;
  const errorSamples: string[] = [];
  const skipRows: any[] = [];

  try {
    const { data: prevSkips } = await admin.from("episode_embedding_skips").select("episode_id,attempts").lte("next_attempt_at", new Date().toISOString()).limit(2000);
    const prevAttempts = new Map<string, number>((prevSkips || []).map((r: any) => [r.episode_id, Number(r.attempts) || 0]));
    const markSkip = (id: string, reason: string) => {
      const attempts = (prevAttempts.get(id) || 0) + 1;
      skipRows.push({ episode_id: id, reason, attempts, next_attempt_at: new Date(Date.now() + nextAttemptDelayMs(reason, attempts)).toISOString(), updated_at: new Date().toISOString() });
    };

    let stop = false;
    let recordedCost = 0, recordedCalls = 0;
    // Spend is booked after every pass, so a worker killed by the platform cannot bypass the cap.
    const bookSpend = async () => {
      const c = cost - recordedCost, n = calls - recordedCalls;
      if (c <= 0 && n <= 0) return;
      await admin.rpc("add_ai_spend", { p_day: day, p_kind: "embed_episode", p_amount: c, p_calls: n });
      recordedCost = cost; recordedCalls = calls;
    };
    while (!stop && embedded + skipped + errors < maxPerRun && Date.now() - startedAt < TIME_BUDGET_MS - 15_000 && spentBefore + cost < dailyBudget) {
      let { data: rows, error } = await admin.rpc("select_embed_episode_candidates_v2", { _limit: batch });
      if (error) throw new Error("candidates: " + error.message);
      // Missing vectors first; then, only if the owner set reembed_before, refresh older vectors
      // into the current (gateway) vector space, newest episodes first.
      if (!(rows || []).length && reembedBefore) {
        ({ data: rows, error } = await admin.rpc("select_reembed_episode_candidates_v1", { _before: reembedBefore, _limit: batch }));
        if (error) throw new Error("reembed candidates: " + error.message);
        if ((rows || []).length) reembedPasses++;
      }
      const cands = (rows || []) as any[];
      if (!cands.length) break;
      passes++;
      let i = 0;
      const worker = async () => {
        while (!stop) {
          const e = cands[i++];
          if (!e) return;
          if (Date.now() - startedAt > TIME_BUDGET_MS - 8_000 || spentBefore + cost >= dailyBudget) { stop = true; return; }
          const skip = embeddingSkipReason(e);
          if (skip) { skipped++; markSkip(e.id, skip); continue; }
          const content = buildEpisodeEmbeddingContent(e, model);
          calls++;
          const vec = await embedText(content, { model, taskType: "SEMANTIC_SIMILARITY" });
          if (!vec) { errors++; markSkip(e.id, "embed_failed"); if (errorSamples.length < 3) errorSamples.push(`${e.id}:embed_failed`); continue; }
          cost += embeddingTokenCostUsd(model, Math.ceil(content.length / 4));
          pending.push({ episode_id: e.id, podcast_id: e.podcast_id, model, embedding: `[${vec.join(",")}]`,
            content_hash: await sha256(content), updated_at: new Date().toISOString() });
        }
      };
      const pending: any[] = [];
      await Promise.all(Array.from({ length: concurrency }, worker));
      // One write per pass instead of one per episode keeps CPU per run low.
      if (pending.length) {
        const { error: upErr } = await admin.from("episode_embeddings").upsert(pending, { onConflict: "episode_id" });
        if (upErr) { errors += pending.length; for (const r of pending) markSkip(r.episode_id, "write_failed"); if (errorSamples.length < 3) errorSamples.push(`write:${upErr.message.slice(0, 80)}`); }
        else embedded += pending.length;
      }
      await bookSpend();
      // Too many failures in a row means the provider is down: stop instead of burning the run.
      if (errors > 20 && errors > embedded) break;
      if (cands.length < batch) break;
    }

    for (let k = 0; k < skipRows.length; k += 500) {
      await admin.from("episode_embedding_skips").upsert(skipRows.slice(k, k + 500), { onConflict: "episode_id" });
    }
    await bookSpend();

    const summary = { ok: true, embedded, skipped, errors, passes, reembed_passes: reembedPasses, cost_usd: Number(cost.toFixed(5)), spent_today: Number((spentBefore + cost).toFixed(4)),
      daily_budget_usd: dailyBudget, error_samples: errorSamples, runtime_ms: Date.now() - startedAt };
    // Re-read controls right before writing so a pause set during this run is kept.
    const latest = await readControls(admin);
    await admin.from("app_settings").upsert({ key: CONTROLS_KEY, value: { ...latest, last_run: { at: new Date().toISOString(), ...summary } }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    await log.finish("ok", summary);
    return json(summary);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await log.finish("error", { embedded, skipped, errors, cost_usd: cost }, msg).catch(() => {});
    return json({ ok: false, error: msg, embedded }, 500);
  }
});
