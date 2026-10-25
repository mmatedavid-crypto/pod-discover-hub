// Advisory Astra review of clean-text queue rows that wait for a human decision
// (owner 2026-10-25: "send them to Astra first"). Astra only RECOMMENDS:
// nothing here writes episode text or changes queue status. Any later text
// change still goes through the existing reviewed apply paths (backup + CAS).
// Cost: atomic reservation against owner caps before every paid call
// (reserve_/settle_clean_text_astra_review_v1), plus the shared AI budget,
// credit breaker and visitor-first priority gate.
import { planRssRepair } from "../_shared/clean-text-rss-repair.ts";
import { htmlToPlain } from "../_shared/clean-text-validation.ts";
import { recordAiCall, creditBreakerOpen, tripCreditBreaker } from "../_shared/lovable-ai.ts";
import { checkBudget } from "../_shared/google-gemini-direct.ts";
import { checkProcessingPriority } from "../_shared/processing-priority.ts";
import { LEGACY_YTDESC_METHOD } from "../_shared/clean-text-legacy-ytdesc.ts";
import { ASTRA_REVIEW_PROMPT_VERSION, ASTRA_REVIEW_SCHEMA, ASTRA_REVIEW_SYSTEM, astraReviewCostUsd, normalizeAstraItem, reviewConcerns } from "../_shared/clean-text-astra-review.ts";

declare const Deno: any;
const JOB = "clean_text_astra_review";
const PER_CALL = 6;
const MAX_IDS = 12;
const MAX_OUT = 4000;
const CUT = { rss: 2500, current: 2000, proposed: 2000 };

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Item = { episode_id: string; repair_kind: string; queue_status: string; input: any; input_hash: string; had_proposal: boolean };

async function buildItems(admin: any, deps: any, ids: string[], method: string): Promise<Item[]> {
  const { data: q, error: qErr } = await admin.from("clean_text_repair_queue").select("episode_id,repair_kind,status,last_reasons").in("episode_id", ids);
  if (qErr) throw qErr;
  const rows = ((q || []) as any[]).filter((r) => r.status === "needs_review" || r.status === "quarantine");
  if (!rows.length) return [];
  const rid = rows.map((r) => String(r.episode_id));
  const [{ data: eps, error: eErr }, { data: ct, error: cErr }, { data: targets, error: tErr }] = await Promise.all([
    admin.from("episodes").select("id,title,description,podcasts(title)").in("id", rid),
    admin.from("episode_clean_text").select("episode_id,cleaned_text,cleaner_method").in("episode_id", rid),
    admin.rpc("clean_text_repair_queue_targets_v1", { p_episode_ids: rid }),
  ]);
  if (eErr) throw eErr; if (cErr) throw cErr; if (tErr) throw tErr;
  const epById = new Map(((eps || []) as any[]).map((e) => [String(e.id), e]));
  const ctById = new Map(((ct || []) as any[]).map((c) => [String(c.episode_id), c]));
  const tById = new Map(((targets || []) as any[]).map((t) => [String(t.episode_id), t]));

  // Proposed text: what the existing deterministic planner would write.
  const proposed = new Map<string, string>();
  const legacyIds = rows.filter((r) => r.repair_kind === "legacy_ytdesc"
    || String(ctById.get(String(r.episode_id))?.cleaner_method || "").startsWith(LEGACY_YTDESC_METHOD)).map((r) => String(r.episode_id));
  if (legacyIds.length) {
    const { plans } = await deps.planResolve(admin, deps, legacyIds, method);
    for (const p of plans) { const t = String((p.item as any)?.cleaned_text || "").trim(); if (t) proposed.set(p.episode_id, t); }
  }
  for (const r of rows) {
    const id = String(r.episode_id);
    if (legacyIds.includes(id)) continue;
    const t = tById.get(id);
    if (!t) continue;
    const plan = await planRssRepair(t, { method });
    const txt = String((plan.item as any)?.cleaned_text || "").trim();
    if (txt) proposed.set(id, txt);
  }

  const out: Item[] = [];
  for (const r of rows) {
    const id = String(r.episode_id);
    const e = epById.get(id);
    if (!e) continue;
    const input = {
      id,
      podcast: String(e.podcasts?.title || "").slice(0, 120),
      cim: String(e.title || "").slice(0, 200),
      rss: htmlToPlain(String(e.description || "")).slice(0, CUT.rss),
      current: String(ctById.get(id)?.cleaned_text || "").slice(0, CUT.current),
      proposed: (proposed.get(id) || "").slice(0, CUT.proposed),
      concerns: reviewConcerns(r.last_reasons || []),
    };
    out.push({ episode_id: id, repair_kind: String(r.repair_kind), queue_status: String(r.status), input, had_proposal: !!input.proposed,
      input_hash: (await sha256Hex(JSON.stringify([input.rss, input.current, input.proposed, input.concerns]))).slice(0, 32) });
  }
  return out;
}

async function callAstra(model: string, items: Item[]) {
  const KEY = Deno.env.get("LOVABLE_API_KEY") || "";
  const t0 = Date.now();
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Lovable-API-Key": KEY, "X-Lovable-AIG-SDK": "fetch" },
    body: JSON.stringify({
      model, stream: true, store: false, reasoning: { effort: "low" }, max_output_tokens: MAX_OUT,
      instructions: ASTRA_REVIEW_SYSTEM, input: JSON.stringify(items.map((i) => i.input)),
      text: { format: { type: "json_schema", name: "clean_text_review", strict: true, schema: ASTRA_REVIEW_SCHEMA } },
    }),
  });
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    await recordAiCall({ job_type: JOB, model_used: model, status: "error", error_message: `${res.status} ${txt.slice(0, 300)}`, prompt_version: ASTRA_REVIEW_PROMPT_VERSION, latency_ms: Date.now() - t0 }).catch(() => {});
    return { ok: false as const, status: res.status, error: `gateway_${res.status}`, inTok: 0, outTok: 0, items: [] as any[] };
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", text = "", usage: any = null, incomplete = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const p = line.slice(5).trim();
      if (!p || p === "[DONE]") continue;
      try {
        const ev = JSON.parse(p);
        if (ev.type === "response.output_text.delta") text += ev.delta || "";
        if (ev.type === "response.completed") usage = ev.response?.usage;
        if (ev.type === "response.incomplete") { incomplete = true; usage = ev.response?.usage; }
      } catch { /* partial line */ }
    }
  }
  const inTok = Number(usage?.input_tokens || 0), outTok = Number(usage?.output_tokens || 0);
  await recordAiCall({ job_type: JOB, model_used: model, input_tokens: inTok, output_tokens: outTok,
    estimated_cost_usd: astraReviewCostUsd(inTok, outTok), prompt_version: ASTRA_REVIEW_PROMPT_VERSION,
    latency_ms: Date.now() - t0, meta: { batch: items.length } }).catch(() => {});
  if (incomplete) return { ok: false as const, status: 200, error: "incomplete_output", inTok, outTok, items: [] as any[] };
  try {
    return { ok: true as const, status: 200, error: null, inTok, outTok, items: (JSON.parse(text || "{}").items || []) as any[] };
  } catch {
    return { ok: false as const, status: 200, error: "invalid_json", inTok, outTok, items: [] as any[] };
  }
}

export async function astraReview(admin: any, deps: any, rawIds: string[], method: string) {
  const ids = rawIds.slice(0, MAX_IDS);
  const { data: ctl } = await admin.from("app_settings").select("value").eq("key", "clean_text_astra_review_controls").maybeSingle();
  const c = ctl?.value || {};
  if (c.enabled !== true) return { ok: false, error: "astra_review_disabled" };
  if (await creditBreakerOpen()) return { ok: false, error: "credit_breaker_open" };
  const priority = await checkProcessingPriority(admin, JOB);
  if (priority) return { ok: true, skipped: priority };
  const budget = await checkBudget(JOB);
  if (!budget.allowed) return { ok: true, skipped: budget.reason };
  const model = String(c.model || "openai/gpt-6-astra");

  const items = await buildItems(admin, deps, ids, method);
  const chunks: Item[][] = [];
  for (let i = 0; i < items.length; i += PER_CALL) chunks.push(items.slice(i, i + PER_CALL));
  const outcomes: Record<string, number> = {};
  let spent = 0, stop: string | null = null, skippedExisting = 0;
  await Promise.all(chunks.map(async (chunk) => {
    const estIn = Math.ceil((ASTRA_REVIEW_SYSTEM.length + JSON.stringify(chunk.map((i) => i.input)).length) / 3) + 200;
    const reserve = Number(astraReviewCostUsd(estIn, MAX_OUT).toFixed(6));
    const { data: rv, error: rvErr } = await admin.rpc("reserve_clean_text_astra_review_v1", {
      p_model: model, p_prompt_version: ASTRA_REVIEW_PROMPT_VERSION, p_reserve_usd: reserve,
      p_items: chunk.map((i) => ({ episode_id: i.episode_id, input_hash: i.input_hash, repair_kind: i.repair_kind, queue_status: i.queue_status, had_proposal: i.had_proposal })),
    });
    if (rvErr) { stop = `reserve:${rvErr.message}`; return; }
    if (!rv?.ok) { stop = `refused:${rv?.reason}`; return; }
    skippedExisting += Number(rv.skipped_existing || 0);
    if (!rv.call_id) return;
    const keep = new Set<string>((rv.reserved || []).map(String));
    const todo = chunk.filter((i) => keep.has(i.episode_id));
    const r = await callAstra(model, todo);
    const usd = astraReviewCostUsd(r.inTok, r.outTok);
    spent += usd;
    if (r.status === 402) { await tripCreditBreaker(JOB); stop = "credit_exhausted"; }
    const byId = new Map(r.items.map((x: any) => [String(x?.id), x]));
    const settled = r.ok ? todo.map((i) => normalizeAstraItem(byId.get(i.episode_id), i.had_proposal, i.episode_id)).filter(Boolean) : [];
    for (const s of settled as any[]) outcomes[s.recommendation] = (outcomes[s.recommendation] || 0) + 1;
    if (!r.ok) outcomes[`error:${r.error}`] = (outcomes[`error:${r.error}`] || 0) + todo.length;
    await admin.rpc("settle_clean_text_astra_review_v1", {
      p_call_id: rv.call_id, p_status: r.ok ? "completed" : "failed", p_actual_usd: Number(usd.toFixed(6)),
      p_input_tokens: r.inTok, p_output_tokens: r.outTok, p_error: r.error, p_items: settled,
    });
  }));
  return { ok: true, model, rows: items.length, skipped_existing: skippedExisting, outcomes, actual_usd: Number(spent.toFixed(4)), stop };
}
