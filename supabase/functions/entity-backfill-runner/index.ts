// Backfills entities (people/companies/tickers/topics) on episodes that already
// have ai_summary but ai_entities_version = 0. Cheap, focused, separate from SEO.
//
// Drain-loop pattern: claim a batch directly from `episodes`, process with
// concurrency, repeat until time/budget runs out or no rows remain.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { filterHosts } from "../_shared/seo-prompt.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const PRICE_IN_PER_1K = 0.000075;
const PRICE_OUT_PER_1K = 0.0003;

const ENTITY_TOOL = {
  type: "function",
  function: {
    name: "extract_entities",
    description:
      "Extract structured entities from a podcast episode based ONLY on title + description. Do NOT invent entities.\n\nCRITICAL: distinguish between people who SPEAK in the episode (`people`: guests, interviewees) and people only TALKED ABOUT (`mentioned`: politicians, public figures referenced in discussion). Politicians like Orbán Viktor or Magyar Péter default to `mentioned` UNLESS the metadata clearly states they are guests / interviewees / speakers.\n\nNEVER include the show's own host names (provided in the user message) in either `people` or `mentioned`.",
    parameters: {
      type: "object",
      properties: {
        people: { type: "array", items: { type: "string" }, description: "Up to 6 named people who SPEAK in the episode (guests, interviewees). NOT hosts. NOT people only mentioned. Original-language full names." },
        mentioned: { type: "array", items: { type: "string" }, description: "Up to 6 named people TALKED ABOUT but NOT PRESENT in the episode. Politicians, public figures default here." },
        companies: { type: "array", items: { type: "string" }, description: "Up to 6 named organizations or companies." },
        tickers: { type: "array", items: { type: "string" }, description: "Up to 6 stock ticker symbols (uppercase like AAPL, OTP)." },
        topics: { type: "array", items: { type: "string" }, description: "Up to 6 short topic tags (1-3 words, lowercase, source language)." },
      },
      required: ["people", "mentioned", "companies", "tickers", "topics"],
      additionalProperties: false,
    },
  },
};

const SYSTEM = "You extract structured entities from podcast episode metadata. You ONLY include entities literally present in the input. Distinguish `people` (speakers) from `mentioned` (talked about but absent). Never include show hosts in either list. If unsure, return empty arrays. No invention.";

async function callAI(model: string, messages: any[]) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools: [ENTITY_TOOL], tool_choice: { type: "function", function: { name: "extract_entities" } } }),
  });
  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("budget_exhausted_provider");
  if (!res.ok) throw new Error(`ai_${res.status}`);
  return res.json();
}

const cleanArr = (a: any, max = 6): string[] => {
  if (!Array.isArray(a)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of a) {
    const s = String(v || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k); out.push(s);
    if (out.length >= max) break;
  }
  return out;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const TIME_BUDGET_MS = 110_000;
  const TAIL_RESERVE_MS = 5_000;

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "entity-backfill-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const batch = Math.max(1, Math.min(200, Number(body.batch) || 100));
    const concurrency = Math.max(1, Math.min(20, Number(body.concurrency) || 12));

    // Controls (separate budget from main SEO runner)
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "entity_backfill_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false) return json({ ok: true, paused: true });
    const dailyBudget = Number(ctrl.daily_budget_usd ?? 5);
    const model = String(ctrl.model || "google/gemini-3.1-flash-lite-preview");

    // Today's spend (shared ai_spend_daily table; we record under by_kind.entity_backfill)
    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const dayKey = today.toISOString().slice(0, 10);
    const { data: spendRow } = await admin.from("ai_spend_daily").select("*").eq("day", dayKey).maybeSingle();
    const byKind = (spendRow?.by_kind || {}) as any;
    let mySpend = Number(byKind.entity_backfill || 0);
    let totalSpend = Number(spendRow?.spend_usd || 0);
    let calls = Number(spendRow?.calls || 0);
    if (mySpend >= dailyBudget) return json({ ok: true, budget_reached: true, spend: mySpend });

    let processed = 0, succeeded = 0, failed = 0, rate_limited = 0;
    let stop = false;
    let total_seen = 0;
    let drain_loops = 0;

    const runOne = async (ep: any) => {
      if (stop) return;
      if (Date.now() - startedAt > TIME_BUDGET_MS - TAIL_RESERVE_MS) { stop = true; return; }
      if (mySpend >= dailyBudget) { stop = true; return; }
      processed++;
      try {
        const desc = String(ep.description || ep.ai_summary || "").replace(/\s+/g, " ").trim().slice(0, 2500);
        const podName = ep.podcasts?.display_title || ep.podcasts?.title || "";
        const userPrompt = `Show: ${podName}\nEpisode: ${ep.display_title || ep.title}\nDescription: ${desc || "(none)"}\n\nExtract entities.`;
        const ai = await callAI(model, [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt },
        ]);
        const usage = ai.usage || {};
        const inTok = Number(usage.prompt_tokens || 0);
        const outTok = Number(usage.completion_tokens || 0);
        const cost = (inTok / 1000) * PRICE_IN_PER_1K + (outTok / 1000) * PRICE_OUT_PER_1K;
        const args = ai.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
        const parsed = args ? JSON.parse(args) : null;
        if (!parsed) throw new Error("no_tool_call");

        const people = cleanArr(parsed.people);
        const companies = cleanArr(parsed.companies);
        const tickers = cleanArr(parsed.tickers).map((t) => t.replace(/[^a-zA-Z0-9.]+/g, "").toUpperCase()).filter(Boolean);
        const topics = cleanArr(parsed.topics).map((t) => t.toLowerCase());

        await admin.from("episodes").update({
          people, companies, tickers, topics,
          ai_entities_version: 1,
        }).eq("id", ep.id);

        succeeded++;
        mySpend += cost; totalSpend += cost; calls++;
      } catch (err: any) {
        failed++;
        const msg = err?.message || "error";
        if (msg === "rate_limited" || msg === "budget_exhausted_provider") { rate_limited++; stop = true; }
        // Mark as v=0 still (no change) so it gets retried on next run.
      }
    };

    while (!stop) {
      if (Date.now() - startedAt > TIME_BUDGET_MS - TAIL_RESERVE_MS) break;
      if (mySpend >= dailyBudget) break;

      const { data: rows, error } = await admin
        .from("episodes")
        .select("id, title, display_title, description, ai_summary, podcast_id, podcasts!inner(title, display_title, language)")
        .not("ai_summary", "is", null)
        .eq("ai_entities_version", 0)
        .ilike("podcasts.language", "hu%")
        .limit(batch);
      if (error) throw error;
      const list = (rows || []) as any[];
      if (!list.length) break;
      total_seen += list.length;
      drain_loops++;

      let i = 0;
      const workers = Array.from({ length: concurrency }, async () => {
        while (true) {
          const idx = i++;
          if (idx >= list.length || stop) return;
          if (Date.now() - startedAt > TIME_BUDGET_MS - TAIL_RESERVE_MS) { stop = true; return; }
          await runOne(list[idx]);
        }
      });
      await Promise.all(workers);
    }

    // Update spend
    await admin.from("ai_spend_daily").upsert({
      day: dayKey,
      spend_usd: totalSpend,
      calls,
      by_kind: { ...byKind, entity_backfill: mySpend },
      updated_at: new Date().toISOString(),
    });

    if (mySpend >= dailyBudget) {
      const newCtrl = { ...ctrl, enabled: false, auto_paused_reason: "daily_budget_reached", auto_paused_at: new Date().toISOString() };
      await admin.from("app_settings").upsert({ key: "entity_backfill_controls", value: newCtrl, updated_at: new Date().toISOString() });
    }

    return json({ ok: true, drain_loops, total_seen, processed, succeeded, failed, rate_limited, spend_usd: mySpend, total_spend_usd: totalSpend, elapsed_ms: Date.now() - startedAt });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
