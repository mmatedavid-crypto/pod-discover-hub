// Judges episode↔topic relevance for rows in episode_topic_relevance_reviews where status='needs_review'.
// Cached: skips rows already processed (different source_hash). Daily-budget guarded.
//
// Body: { topic_slug?, topic_id?, batch?, concurrency? }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { chatTokenCostUsd } from "../_shared/ai-pricing.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TIME_BUDGET_MS = 50_000;

const JUDGE_TOOL = {
  type: "function",
  function: {
    name: "judge_topic_relevance",
    description: "Decide whether a podcast episode is genuinely about the given topic, based on episode-level evidence (title + description + ai_summary). Reject decisions based only on podcast title or broad podcast category.",
    parameters: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["accepted", "rejected", "needs_review"] },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        reason_hu: { type: "string", description: "Rövid magyar nyelvű indoklás (max 200 karakter)." },
        suggested_topics: { type: "array", items: { type: "string" }, description: "Alternatív, jobban illő téma slugok, ha van." },
        is_false_positive: { type: "boolean" },
        false_positive_reason: { type: ["string", "null"] },
      },
      required: ["status", "confidence", "reason_hu", "suggested_topics", "is_false_positive"],
      additionalProperties: false,
    },
  },
};

const SYSTEM = `Te egy magyar podcast tartalom-besoroló asszisztens vagy. Eldöntöd, hogy egy konkrét epizód VALÓBAN a megadott témáról szól-e, vagy csak a podcast általános kategóriája/címe miatt került oda.

SZIGORÚ szabályok:
- ÉPIZÓD-szintű bizonyítékot követelj meg (cím, leírás, ai_summary).
- NE fogadj el egy epizódot pusztán azért, mert a podcast címe vagy globális kategóriája egyezik.
- Negatív kulcsszavakat vedd komolyan: ha jelen vannak és nincs valódi pozitív bizonyíték, status='rejected'.
- Ha bizonytalan vagy: status='needs_review'.
- Az indoklás MAGYAR nyelvű, max 200 karakter.
- Soha ne találj ki tényt.`;

async function callAI(model: string, messages: any[]) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools: [JUDGE_TOOL], tool_choice: { type: "function", function: { name: "judge_topic_relevance" } } }),
  });
  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("budget_exhausted_provider");
  if (!res.ok) throw new Error(`ai_${res.status}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const t0 = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const guard = await checkBackgroundJobsAllowed(admin, "topic-judge-runner");
  if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

  const body = await req.json().catch(() => ({}));
  const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "episode_topic_judge_controls").maybeSingle();
  const ctrl = (ctrlRow?.value || {}) as any;
  if (ctrl.enabled === false) return json({ ok: true, paused: true });
  const dailyBudget = Number(ctrl.daily_budget_usd ?? 3);
  const model = String(body.model || ctrl.model || "google/gemini-2.5-flash-lite");
  const batch = Math.max(1, Math.min(120, Number(body.batch) || ctrl.batch_size || 40));
  const concurrency = Math.max(1, Math.min(8, Number(body.concurrency) || ctrl.concurrency || 4));
  const prioritySlugs: string[] = ctrl.priority_topics || [];

  const today = new Date(); today.setUTCHours(0, 0, 0, 0);
  const dayKey = today.toISOString().slice(0, 10);
  const { data: spendRow } = await admin.from("ai_spend_daily").select("*").eq("day", dayKey).maybeSingle();
  const byKind = (spendRow?.by_kind || {}) as any;
  let mySpend = Number(byKind.topic_judge || 0);
  let totalSpend = Number(spendRow?.spend_usd || 0);
  let calls = Number(spendRow?.calls || 0);
  if (mySpend >= dailyBudget) return json({ ok: true, budget_reached: true, spend: mySpend });

  // Resolve priority topic IDs
  let priorityTopicIds: string[] = [];
  if (body.topic_id) priorityTopicIds = [body.topic_id];
  else if (body.topic_slug) {
    const { data } = await admin.from("topics").select("id").eq("slug", body.topic_slug).maybeSingle();
    if (data?.id) priorityTopicIds = [data.id];
  } else if (prioritySlugs.length) {
    const { data } = await admin.from("topics").select("id").in("slug", prioritySlugs);
    priorityTopicIds = (data || []).map((r: any) => r.id);
  }

  let processed = 0, accepted = 0, rejected = 0, needs_review = 0, failed = 0;
  let stop = false;
  let drain_loops = 0, total_seen = 0;

  const runOne = async (row: any) => {
    if (stop) return;
    if (Date.now() - t0 > TIME_BUDGET_MS - 5_000) { stop = true; return; }
    if (mySpend >= dailyBudget) { stop = true; return; }
    processed++;
    try {
      const ep = row.episodes;
      const pod = ep?.podcasts;
      const topic = row.topics;
      if (!ep || !topic) throw new Error("missing_join");

      const positive = (topic.positive_hints || []).join(", ");
      const negative = (topic.negative_hints || []).join(", ");
      const desc = String(ep.ai_summary || ep.description || "").replace(/\s+/g, " ").trim().slice(0, 2200);
      const userPrompt = `TÉMA: ${topic.name}
Leírás: ${topic.description || topic.intro_text || "—"}
Pozitív hint-ek: ${positive || "—"}
Negatív hint-ek: ${negative || "—"}

EPIZÓD:
Podcast: ${pod?.display_title || pod?.title || "—"} (podcast kategória: ${pod?.category || "—"})
Cím: ${ep.display_title || ep.title}
Leírás/AI összefoglaló: ${desc || "(nincs)"}
Candidate-forrás: ${row.candidate_source}
Jelenlegi térképbeli állapot: ${row.candidate_source === "current_map" ? "már mapped" : "új jelölt"}

Döntsd el, hogy az EPIZÓD-szintű tartalom valóban a TÉMÁROL szól-e.`;

      const ai = await callAI(model, [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ]);
      const usage = ai.usage || {};
      const inTok = Number(usage.prompt_tokens || 0);
      const outTok = Number(usage.completion_tokens || 0) + Number(usage.completion_tokens_details?.reasoning_tokens || 0);
      const cost = chatTokenCostUsd(model, inTok, outTok);
      const args = ai.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!args) throw new Error("no_tool_call");
      const parsed = typeof args === "string" ? JSON.parse(args) : args;

      const status = ["accepted", "rejected", "needs_review"].includes(parsed.status) ? parsed.status : "needs_review";
      // Resolve suggested topic slugs → ids (best-effort)
      let suggested_topic_ids: string[] = [];
      if (Array.isArray(parsed.suggested_topics) && parsed.suggested_topics.length) {
        const { data } = await admin.from("topics").select("id").in("slug", parsed.suggested_topics.slice(0, 5));
        suggested_topic_ids = (data || []).map((r: any) => r.id);
      }

      await admin.from("episode_topic_relevance_reviews").update({
        status,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        reason_hu: String(parsed.reason_hu || "").slice(0, 400),
        suggested_topic_ids,
        reviewed_by: "ai",
        model_version: model,
        reviewed_at: new Date().toISOString(),
      }).eq("id", row.id);

      if (status === "accepted") accepted++;
      else if (status === "rejected") rejected++;
      else needs_review++;
      mySpend += cost; totalSpend += cost; calls++;
    } catch (e: any) {
      failed++;
      const msg = e?.message || "error";
      if (msg === "rate_limited" || msg === "budget_exhausted_provider") stop = true;
    }
  };

  while (!stop) {
    if (Date.now() - t0 > TIME_BUDGET_MS - 5_000) break;
    if (mySpend >= dailyBudget) break;

    let q = admin.from("episode_topic_relevance_reviews")
      .select("id, candidate_source, topic_id, topics!inner(id, name, slug, description, intro_text, positive_hints, negative_hints), episodes!inner(id, title, display_title, description, ai_summary, podcast_id, podcasts!inner(title, display_title, category, is_hungarian, language_decision))")
      .eq("status", "needs_review")
      .eq("reviewed_by", "rule")
      .eq("episodes.podcasts.is_hungarian", true)
      .eq("episodes.podcasts.language_decision", "accept_hungarian");
    if (priorityTopicIds.length) q = q.in("topic_id", priorityTopicIds);
    const { data: rows, error } = await q.order("created_at", { ascending: true }).limit(batch);
    if (error) { failed++; break; }
    const list = (rows || []) as any[];
    if (!list.length) break;
    total_seen += list.length; drain_loops++;

    let i = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= list.length || stop) return;
        if (Date.now() - t0 > TIME_BUDGET_MS - 5_000) { stop = true; return; }
        await runOne(list[idx]);
      }
    });
    await Promise.all(workers);
  }

  await admin.from("ai_spend_daily").upsert({
    day: dayKey,
    spend_usd: totalSpend,
    calls,
    by_kind: { ...byKind, topic_judge: mySpend },
    updated_at: new Date().toISOString(),
  });

  if (mySpend >= dailyBudget) {
    await admin.from("app_settings").upsert({
      key: "episode_topic_judge_controls",
      value: { ...ctrl, enabled: false, auto_paused_reason: "daily_budget_reached", auto_paused_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });
  }

  return json({ ok: true, drain_loops, total_seen, processed, accepted, rejected, needs_review, failed, spend_usd: mySpend, elapsed_ms: Date.now() - t0 });
});
