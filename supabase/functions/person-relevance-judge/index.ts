// Person-episode relevance AI judge.
// Validates whether an episode truly belongs to a person's page.
// HU-output JSON tool call; writes relevance_status + ai_* fields on person_episode_mentions.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const TIME_BUDGET_MS = 110_000;
const RESERVE_MS = 8_000;
const MODEL = "google/gemini-2.5-flash";
const DAILY_BUDGET_USD = 2.0;

interface PendingRow {
  id: string;
  person_id: string;
  episode_id: string;
  mention_type: string;
  confidence: number;
  person_name: string;
  person_aliases: string[];
  disambiguation_label: string | null;
  disambiguation_context: string | null;
  ep_title: string;
  ep_summary: string | null;
  ep_ai_summary: string | null;
  pod_title: string;
  pod_description: string | null;
}

const TOOL = {
  name: "judge_person_episode_relevance",
  description: "Decide whether an episode truly belongs to this person's page. Always answer in Hungarian.",
  parameters: {
    type: "object",
    properties: {
      is_relevant: { type: "boolean" },
      relevance_score: { type: "number", minimum: 0, maximum: 1 },
      recommended_mention_type: { type: "string", enum: ["host", "guest", "subject", "mentioned", "none"] },
      identity_match: { type: "string", enum: ["same_person", "different_person_same_name", "substring_false_positive", "uncertain"] },
      reason: { type: "string", description: "Rövid magyar indoklás (max 200 karakter)." },
      evidence_phrases: { type: "array", items: { type: "string" }, maxItems: 5 },
      should_show_publicly: { type: "boolean" },
      is_false_positive: { type: "boolean" },
      false_positive_reason: { type: ["string", "null"] },
    },
    required: ["is_relevant", "relevance_score", "recommended_mention_type", "identity_match", "reason", "evidence_phrases", "should_show_publicly", "is_false_positive"],
  },
};

function buildPrompt(r: PendingRow): string {
  const aliasLine = r.person_aliases && r.person_aliases.length ? `Aliasok: ${r.person_aliases.slice(0, 8).join(", ")}` : "";
  const disambig = r.disambiguation_label ? `Megkülönböztetés: ${r.disambiguation_label}${r.disambiguation_context ? ` (${r.disambiguation_context})` : ""}` : "";
  return `Te magyar nyelvű podcast-relevancia bíró vagy. Döntsd el, hogy az alábbi epizód valóban a megnevezett személyhez kapcsolódik-e.

SZIGORÚ SZABÁLYOK:
- Csak teljes névegyezést vagy explicit alias-egyezést fogadj el (szóhatárral).
- NE fogadj el csak vezetéknév- vagy résszó-egyezést.
- Ha más, azonos nevű emberről van szó, identity_match = "different_person_same_name".
- Ha a név egy szóba van ágyazva (pl. "Pólus" egy "többpólusú" szóban), identity_match = "substring_false_positive".
- Csak akkor relevant=true, ha a személy host, vendég, központi téma vagy érdemi említés.
- Ha bizonytalan vagy, should_show_publicly = false.
- A reason mező és minden szöveges válasz MAGYARUL.

SZEMÉLY: ${r.person_name}
${aliasLine}
${disambig}

PODCAST: ${r.pod_title}
PODCAST LEÍRÁS: ${(r.pod_description || "").slice(0, 400)}

EPIZÓD CÍM: ${r.ep_title}
EPIZÓD ÖSSZEFOGLALÓ: ${(r.ep_ai_summary || r.ep_summary || "").slice(0, 1200)}

Jelenlegi szabályalapú besorolás: mention_type=${r.mention_type}, confidence=${r.confidence}.

Hívd meg a judge_person_episode_relevance tool-t.`;
}

async function callAI(prompt: string): Promise<{ result: any; cost: number } | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: "function", function: TOOL }],
      tool_choice: { type: "function", function: { name: TOOL.name } },
    }),
  });
  if (!r.ok) {
    if (r.status === 429 || r.status === 402) throw new Error(`rate_limit:${r.status}`);
    return null;
  }
  const j = await r.json();
  const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return null;
  let parsed: any;
  try { parsed = JSON.parse(args); } catch { return null; }
  const usage = j.usage || {};
  // crude cost estimate: $0.075/M input + $0.30/M output
  const cost = ((usage.prompt_tokens || 0) * 0.075 + (usage.completion_tokens || 0) * 0.30) / 1_000_000;
  return { result: parsed, cost };
}

async function logSpend(supabase: any, cost: number) {
  const day = new Date().toISOString().slice(0, 10);
  try {
    const { error } = await supabase.rpc("upsert_ai_spend", { p_day: day, p_kind: "person_relevance", p_cost: cost, p_calls: 1 });
    if (!error) return;
  } catch { /* fall through */ }
  // fallback: manual upsert
  try {
    const { data } = await supabase.from("ai_spend_daily").select("*").eq("day", day).maybeSingle();
    const cur = data || { day, spend_usd: 0, calls: 0, by_kind: {} };
    const by = cur.by_kind || {};
    by.person_relevance = (by.person_relevance || 0) + cost;
    await supabase.from("ai_spend_daily").upsert({
      day,
      spend_usd: Number(cur.spend_usd || 0) + cost,
      calls: (cur.calls || 0) + 1,
      by_kind: by,
    });
  } catch { /* ignore */ }
}

async function getSpendToday(supabase: any): Promise<number> {
  const day = new Date().toISOString().slice(0, 10);
  const { data } = await supabase.from("ai_spend_daily").select("by_kind").eq("day", day).maybeSingle();
  return Number((data?.by_kind as any)?.person_relevance || 0);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let body: any = {};
  try { body = req.method === "POST" ? await req.json() : {}; } catch {}
  const batchLimit = Math.min(Math.max(Number(body.batch_limit) || 30, 1), 200);
  const targetPersonIds: string[] | null = Array.isArray(body.person_ids) && body.person_ids.length ? body.person_ids : null;

  const startedAt = Date.now();
  let processed = 0, accepted = 0, rejected = 0, needs_review = 0, errors = 0;
  let spendToday = await getSpendToday(supabase);

  while (Date.now() - startedAt < TIME_BUDGET_MS - RESERVE_MS) {
    if (spendToday >= DAILY_BUDGET_USD) break;

    // claim a batch of pending mentions on HU-approved podcasts.
    // Filter podcast directly via mentions.podcast_id (PostgREST cannot reliably
    // filter on two-level nested embeds like episodes.podcasts.is_hungarian).
    let q = supabase
      .from("person_episode_mentions")
      .select("id, person_id, episode_id, mention_type, confidence, people!inner(name, disambiguation_label, disambiguation_context, ai_review_status, activation_status), podcasts!person_episode_mentions_podcast_id_fkey!inner(title, description, is_hungarian, language_decision), episodes!inner(title, summary, ai_summary)")
      .eq("relevance_status", "pending")
      .eq("podcasts.is_hungarian", true)
      .eq("podcasts.language_decision", "accept_hungarian")
      .order("confidence", { ascending: false })
      .limit(batchLimit);
    if (targetPersonIds) q = q.in("person_id", targetPersonIds);
    const { data: rows, error } = await q;
    if (error || !rows || rows.length === 0) break;

    // fetch aliases in one shot
    const personIds = [...new Set(rows.map((r: any) => r.person_id))];
    const { data: aliasRows } = await supabase.from("person_aliases").select("person_id, alias").in("person_id", personIds);
    const aliasMap = new Map<string, string[]>();
    (aliasRows || []).forEach((a: any) => {
      const list = aliasMap.get(a.person_id) || [];
      list.push(a.alias);
      aliasMap.set(a.person_id, list);
    });

    for (const m of rows as any[]) {
      if (Date.now() - startedAt > TIME_BUDGET_MS - RESERVE_MS) break;
      if (spendToday >= DAILY_BUDGET_USD) break;

      const pending: PendingRow = {
        id: m.id,
        person_id: m.person_id,
        episode_id: m.episode_id,
        mention_type: m.mention_type,
        confidence: Number(m.confidence || 0),
        person_name: m.people.name,
        person_aliases: aliasMap.get(m.person_id) || [],
        disambiguation_label: m.people.disambiguation_label,
        disambiguation_context: m.people.disambiguation_context,
        ep_title: m.episodes.title,
        ep_summary: m.episodes.summary,
        ep_ai_summary: m.episodes.ai_summary,
        pod_title: m.podcasts.title,
        pod_description: m.podcasts.description,
      };

      try {
        const out = await callAI(buildPrompt(pending));
        if (!out) { errors++; continue; }
        spendToday += out.cost;
        await logSpend(supabase, out.cost);
        const r = out.result;
        let status: string;
        if (r.is_false_positive || r.identity_match === "substring_false_positive" || r.identity_match === "different_person_same_name") status = "rejected";
        else if (r.identity_match === "uncertain" || !r.should_show_publicly) status = "needs_review";
        else if (r.is_relevant && r.relevance_score >= 0.6) status = "accepted";
        else status = "rejected";

        if (status === "accepted") accepted++;
        else if (status === "rejected") rejected++;
        else needs_review++;

        await supabase.from("person_episode_mentions").update({
          relevance_status: status,
          final_relevance_score: r.relevance_score,
          validation_source: "ai",
          ai_identity_match: r.identity_match,
          ai_reason: r.reason,
          ai_evidence_phrases: r.evidence_phrases || [],
          ai_judged_at: new Date().toISOString(),
          ai_model: MODEL,
          mention_type: status === "accepted" && r.recommended_mention_type !== "none" ? r.recommended_mention_type : m.mention_type,
        }).eq("id", m.id);
        processed++;
      } catch (e) {
        errors++;
        if (String(e).includes("rate_limit")) { spendToday = DAILY_BUDGET_USD; break; }
      }
    }
  }

  // recompute hub
  try { await supabase.rpc("refresh_people_hub_score"); } catch { /* ignore */ }

  return new Response(JSON.stringify({
    ok: true,
    processed, accepted, rejected, needs_review, errors,
    spend_today_usd: spendToday,
    elapsed_ms: Date.now() - startedAt,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
