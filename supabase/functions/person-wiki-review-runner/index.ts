// person-wiki-review-runner
// For people with wikipedia_match_status='needs_review' (confidence 0.4–0.65):
// GPT-5 (medium reasoning) decides verified vs no_match using the wiki candidate
// evidence + episode context. Updates wikipedia_match_status + wiki_match_reason.
// No bio writing here — that is handled by person-bio-generator afterwards.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { chatTokenCostUsd } from "../_shared/ai-pricing.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const MODEL = "openai/gpt-5";

const DECISION_TOOL = {
  type: "function",
  function: {
    name: "submit_wiki_decision",
    description: "Decide if the Wikipedia/Wikidata candidate refers to the same real person who appears in the podcast episodes.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        decision: { type: "string", enum: ["verified", "no_match", "uncertain"] },
        confidence: { type: "number", description: "0..1" },
        rationale_hu: { type: "string" },
        evidence_signals: { type: "array", items: { type: "string" } },
      },
      required: ["decision", "confidence", "rationale_hu", "evidence_signals"],
    },
  },
};

async function callAI(system: string, user: string) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      reasoning: { effort: "medium" },
      messages: [{ role: "system", content: system }, { role: "user", content: user }],
      tools: [DECISION_TOOL],
      tool_choice: { type: "function", function: { name: "submit_wiki_decision" } },
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return { ok: false, error: `ai_${r.status}:${t.slice(0, 200)}`, cost: 0 };
  }
  const j = await r.json();
  const msg = j?.choices?.[0]?.message || {};
  const toolCall = msg.tool_calls?.[0];
  const inTok = j?.usage?.prompt_tokens || 0;
  const outTok = (j?.usage?.completion_tokens || 0) + (j?.usage?.completion_tokens_details?.reasoning_tokens || 0);
  const cost = chatTokenCostUsd(MODEL, Number(inTok), Number(outTok));
  if (!toolCall) return { ok: false, error: "no_tool_call", cost };
  try {
    const args = JSON.parse(toolCall.function?.arguments || "{}");
    return { ok: true, args, cost };
  } catch (e: any) {
    return { ok: false, error: `parse:${e?.message || e}`, cost };
  }
}

async function processPerson(admin: any, p: any) {
  const ev = p.wikipedia_match_evidence || {};
  const qid = ev.qid || p.wikidata_id;
  if (!qid) {
    await admin.from("people").update({
      wikipedia_match_status: "no_match",
      wiki_match_reason: "no_wikidata_candidate",
      wiki_match_run_at: new Date().toISOString(),
    }).eq("id", p.id);
    return { id: p.id, decision: "no_match", reason: "no_candidate" };
  }

  // Get a few episode titles as context
  const { data: mentions } = await admin
    .from("person_episode_mentions")
    .select("mention_type, episodes!inner(title, podcasts!inner(title, is_hungarian, language_decision))")
    .eq("person_id", p.id)
    .eq("episodes.podcasts.is_hungarian", true)
    .eq("episodes.podcasts.language_decision", "accept_hungarian")
    .limit(15);
  const epContext = (mentions || []).map((m: any, i: number) =>
    `${i + 1}. [${m.mention_type}] ${m.episodes?.podcasts?.title || ""} — ${m.episodes?.title || ""}`).join("\n");

  const sys = `Magyar névegyeztetést végzel. Egy podcast-katalógusban talált név (és az epizódok kontextusa) alapján kell eldöntened, hogy a megadott Wikidata/Wikipedia jelölt UGYANARRA a személyre vonatkozik-e.
Szabályok:
- Csak akkor "verified", ha:
  - a név egyezik vagy egyértelmű variánsa (ékezet, sorrend, becenév),
  - ÉS a Wikidata leírás (foglalkozás, korszak, ország) összhangban van az epizódok témakörével,
  - ÉS nincs ellentmondás (pl. Wikidata személy meghalt 1900-ban, de mai podcastokban szerepel hostként).
- "no_match", ha a Wikidata-jelölt nyilvánvalóan más személy (más szakma, korszak, ország, ismert ütközés).
- "uncertain", ha a bizonyíték kétértelmű — legyél szigorú, inkább uncertain mint hibás verified.
- A confidence 0..1, 0.8+ csak ha biztos vagy.
- A submit_wiki_decision eszközzel válaszolj.`;
  const user = `SZEMÉLY a podcast-katalógusban: ${p.name}
Egyéb nevek: ${(p.aliases || []).join(", ") || "—"}

WIKIDATA/WIKIPEDIA JELÖLT:
- Q-ID: ${qid}
- Wikidata címkék: ${(ev.labels || []).join(" / ") || "—"}
- Wikidata leírás: ${ev.description || "—"}
- Wikipedia URL: ${p.wikipedia_url || "—"}
- Wikipedia leírás: ${p.wikipedia_description || "—"}
- Wikipedia kivonat (max 700 char): ${(p.wikipedia_extract || "").slice(0, 700) || "—"}
- Eredeti match signalok: ${(ev.signals || []).join(", ") || "—"}
- Eredeti match konfidencia: ${p.wikipedia_match_confidence}

EPIZÓD KONTEXTUS (max 15):
${epContext || "(nincs)"}

Döntsd el: ugyanaz a személy?`;
  const res = await callAI(sys, user);
  if (!res.ok) {
    return { id: p.id, error: res.error, cost: res.cost };
  }
  const a = res.args!;
  let newStatus = p.wikipedia_match_status;
  if (a.decision === "verified" && a.confidence >= 0.7) newStatus = "verified";
  else if (a.decision === "no_match") newStatus = "no_match";
  else newStatus = "needs_review"; // uncertain stays
  const update: any = {
    wikipedia_match_status: newStatus,
    wiki_match_reason: `gpt5_review:${a.decision}:${a.confidence.toFixed(2)}:${a.rationale_hu.slice(0, 200)}`,
    wiki_match_run_at: new Date().toISOString(),
  };
  if (newStatus === "verified") {
    update.wikipedia_match_confidence = Math.max(Number(p.wikipedia_match_confidence || 0), a.confidence);
  } else if (newStatus === "no_match") {
    // Clear wiki fields so bio generator falls back to evidence-only path.
    update.wikipedia_url = null;
    update.wikipedia_title = null;
    update.wikipedia_description = null;
    update.wikipedia_extract = null;
    update.wikidata_id = null;
  }
  await admin.from("people").update(update).eq("id", p.id);

  // Audit row
  await admin.from("ai_call_audit").insert({
    job_type: "person_wiki_review",
    model_used: MODEL,
    provider: "lovable_ai",
    target_id: p.id,
    target_type: "person",
    status: "ok",
    confidence: Number(a.confidence || 0),
    estimated_cost_usd: res.cost,
    meta: { decision: a.decision, new_status: newStatus, signals: a.evidence_signals, rationale: a.rationale_hu, qid },
  });

  return { id: p.id, decision: a.decision, new_status: newStatus, cost: res.cost };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Number(body.limit || 20), 100);
    const budget = Number(body.daily_budget_usd || 5);
    const today = new Date().toISOString().slice(0, 10);
    const { data: spend } = await admin.from("ai_spend_daily").select("by_kind").eq("day", today).maybeSingle();
    const spentToday = Number(((spend?.by_kind as any) || {}).person_wiki_review || 0);
    if (spentToday >= budget && !body.ignore_budget) {
      return new Response(JSON.stringify({ paused: "budget_reached", spent_today: spentToday, budget }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: people } = await admin
      .from("people")
      .select("id, name, aliases, wikipedia_url, wikipedia_title, wikipedia_description, wikipedia_extract, wikipedia_match_status, wikipedia_match_confidence, wikipedia_match_evidence, wikidata_id, gated_episode_count")
      .eq("wikipedia_match_status", "needs_review")
      .eq("is_public", true)
      .order("gated_episode_count", { ascending: false })
      .limit(limit);

    const results: any[] = [];
    let totalCost = 0;
    for (const p of (people || [])) {
      const r = await processPerson(admin, p);
      results.push(r);
      totalCost += Number(r.cost || 0);
      await new Promise((res) => setTimeout(res, 150));
    }

    // Spend log
    try {
      const { data: spend2 } = await admin.from("ai_spend_daily").select("*").eq("day", today).maybeSingle();
      const byKind = (spend2?.by_kind as any) || {};
      byKind.person_wiki_review = Number(byKind.person_wiki_review || 0) + totalCost;
      await admin.from("ai_spend_daily").upsert({
        day: today,
        spend_usd: Number(spend2?.spend_usd || 0) + totalCost,
        calls: Number(spend2?.calls || 0) + results.length,
        by_kind: byKind,
        updated_at: new Date().toISOString(),
      });
    } catch { /* ignore */ }

    return new Response(JSON.stringify({ processed: results.length, total_cost_usd: totalCost, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: String(e?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
