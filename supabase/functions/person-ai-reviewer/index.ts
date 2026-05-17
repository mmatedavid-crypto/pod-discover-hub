// person-ai-reviewer
// Reviews extracted people for quality, recommends activation action, applies only
// safe automatic downgrades. Uses Lovable AI Gateway (google/gemini-2.5-flash).
// HU-only: all evidence is collected from podcasts.is_hungarian=true AND
// language_decision='accept_hungarian'.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY")!;
const MODEL = "google/gemini-2.5-flash";
const DAILY_BUDGET_USD = 2;
const MAX_ATTEMPTS = 3;

const ALLOWED_FLAGS = new Set([
  "weak_one_off","ambiguous_name","possible_duplicate","not_a_person","bad_slug",
  "bio_too_confident","mention_type_suspicious","thin_page","good_indexable_candidate",
  "needs_accent_fix","likely_topic_not_person","likely_organization_not_person",
  "only_first_name","only_mentioned_weakly","verified_public_figure","strong_host",
  "strong_guest_or_subject",
]);
const ALLOWED_ACTIONS = new Set([
  "keep_indexable","keep_public_noindex","hide","merge","needs_review","reject",
]);
const ALLOWED_NAME_QUALITY = new Set(["good","needs_accent_fix","ambiguous","not_person","fragment"]);

const REVIEW_TOOL = {
  type: "function",
  function: {
    name: "submit_person_review",
    description: "Return a strict quality review of the person.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        is_real_person: { type: "boolean" },
        canonical_name: { type: "string" },
        name_quality: { type: "string", enum: [...ALLOWED_NAME_QUALITY] },
        recommended_action: { type: "string", enum: [...ALLOWED_ACTIONS] },
        recommended_is_public: { type: "boolean" },
        recommended_is_indexable: { type: "boolean" },
        duplicate_candidate: {
          type: "object",
          additionalProperties: false,
          properties: {
            is_duplicate: { type: "boolean" },
            duplicate_of_name: { type: ["string","null"] },
            duplicate_of_person_id: { type: ["string","null"] },
            reason: { type: "string" },
          },
          required: ["is_duplicate","duplicate_of_name","duplicate_of_person_id","reason"],
        },
        flags: { type: "array", items: { type: "string", enum: [...ALLOWED_FLAGS] } },
        confidence: { type: "number" },
        review_score: { type: "number" },
        summary: { type: "string" },
      },
      required: [
        "is_real_person","canonical_name","name_quality","recommended_action",
        "recommended_is_public","recommended_is_indexable","duplicate_candidate",
        "flags","confidence","review_score","summary",
      ],
    },
  },
};

const SYSTEM_PROMPT = `Magyar podcast-katalógus személy entitásait minősíted SEO és felhasználói minőség szempontjából.
Feladat: döntsd el, hogy egy kinyert "person" valódi személy-e, érdemes-e publikus / indexálható oldalt csinálni neki.

Szigorú szabályok:
- Csak a megadott bizonyíték alapján dolgozz, soha ne találj ki tényt.
- Ha a név nem egy ember teljes/elismert neve (pl. brand, műsorcím, kategória, topik, csak keresztnév), akkor not_person / fragment / likely_topic_not_person / likely_organization_not_person.
- Ha duplikátum gyanús (ékezetes/ékezet nélküli, sorrend, becenév) → merge javaslat + duplicate_candidate.
- Ne minősíts indexálhatónak gyenge, egy-két említésű, vagy bizonytalan entitást.
- keep_indexable csak akkor, ha tényleg valódi személy + elég bizonyíték (több epizód, több podcast, vagy verified Wikipedia).
- keep_public_noindex: valódi személy, de túl vékony tartalom indexálásra.
- hide: gyenge, félrevezető, vagy bizonytalan.
- reject: egyértelműen nem személy.
- needs_review: bizonytalan eset.
- A summary mező rövid magyar nyelvű indoklás.
- Csak az engedélyezett flag és action értékeket használd.`;

interface PersonRow {
  id: string;
  name: string;
  slug: string;
  normalized_name: string;
  is_public: boolean;
  is_indexable: boolean;
  activation_status: string;
  activation_reason: string | null;
  episode_count: number;
  podcast_count: number;
  distinct_podcast_count: number;
  strong_mention_count: number;
  host_count: number;
  guest_count: number;
  subject_count: number;
  mentioned_count: number;
  latest_episode_at: string | null;
  wikipedia_match_status: string | null;
  wikipedia_match_confidence: number | null;
  ai_bio: string | null;
  overview_text: string | null;
  manual_approved: boolean;
  ai_review_status: string;
}

async function dailySpend(admin: any): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin.from("ai_spend_daily").select("by_kind").eq("day", today).maybeSingle();
  return Number(((data?.by_kind as any) || {}).person_ai_review || 0);
}

async function bumpSpend(admin: any, cost: number) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin.from("ai_spend_daily").select("by_kind, spend_usd, calls").eq("day", today).maybeSingle();
  const byKind: any = (data?.by_kind as any) || {};
  byKind.person_ai_review = Number(byKind.person_ai_review || 0) + cost;
  await admin.from("ai_spend_daily").upsert({
    day: today,
    by_kind: byKind,
    spend_usd: Number(data?.spend_usd || 0) + cost,
    calls: Number(data?.calls || 0) + 1,
    updated_at: new Date().toISOString(),
  });
}

async function callAI(payload: any): Promise<{ args: any; cost: number; error?: string }> {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${LOVABLE_API_KEY}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify(payload) },
      ],
      tools: [REVIEW_TOOL],
      tool_choice: { type: "function", function: { name: "submit_person_review" } },
      temperature: 0.1,
    }),
  });
  if (!r.ok) return { args: null, cost: 0, error: `ai_${r.status}` };
  const j = await r.json();
  const call = j?.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return { args: null, cost: 0, error: "no_tool_call" };
  let parsed: any = null;
  try { parsed = JSON.parse(call.function.arguments); } catch { return { args: null, cost: 0, error: "parse_fail" }; }
  const inTok = j?.usage?.prompt_tokens || 0;
  const outTok = j?.usage?.completion_tokens || 0;
  const cost = (inTok / 1e6) * 0.075 + (outTok / 1e6) * 0.3;
  return { args: parsed, cost };
}

function sanitize(args: any): any {
  if (!args || typeof args !== "object") return null;
  if (typeof args.recommended_action !== "string" || !ALLOWED_ACTIONS.has(args.recommended_action)) {
    args.recommended_action = "needs_review";
  }
  if (typeof args.name_quality !== "string" || !ALLOWED_NAME_QUALITY.has(args.name_quality)) {
    args.name_quality = "ambiguous";
  }
  args.flags = Array.isArray(args.flags) ? args.flags.filter((f: any) => typeof f === "string" && ALLOWED_FLAGS.has(f)) : [];
  args.confidence = Math.max(0, Math.min(1, Number(args.confidence) || 0));
  args.review_score = Math.max(0, Math.min(1, Number(args.review_score) || 0));
  args.summary = String(args.summary || "").slice(0, 800);
  args.canonical_name = String(args.canonical_name || "").slice(0, 200);
  if (!args.duplicate_candidate || typeof args.duplicate_candidate !== "object") {
    args.duplicate_candidate = { is_duplicate: false, duplicate_of_name: null, duplicate_of_person_id: null, reason: "" };
  }
  return args;
}

async function collectEvidence(admin: any, person: PersonRow) {
  const [aliasesQ, mentionsQ, podMapQ, dupQ] = await Promise.all([
    admin.from("person_aliases").select("alias").eq("person_id", person.id).limit(15),
    admin.from("person_episode_mentions")
      .select("mention_type, confidence, evidence, episodes!inner(title, description, podcasts!inner(title, is_hungarian, language_decision))")
      .eq("person_id", person.id)
      .eq("episodes.podcasts.is_hungarian", true)
      .eq("episodes.podcasts.language_decision", "accept_hungarian")
      .limit(20),
    admin.from("person_podcast_map")
      .select("role, episode_count, podcasts!inner(title, is_hungarian, language_decision)")
      .eq("person_id", person.id)
      .eq("podcasts.is_hungarian", true)
      .eq("podcasts.language_decision", "accept_hungarian")
      .limit(15),
    admin.from("people")
      .select("id, name, slug, episode_count")
      .eq("normalized_name", person.normalized_name)
      .neq("id", person.id)
      .limit(5),
  ]);
  return {
    name: person.name,
    slug: person.slug,
    normalized_name: person.normalized_name,
    aliases: (aliasesQ.data || []).map((a: any) => a.alias),
    current_is_public: person.is_public,
    current_is_indexable: person.is_indexable,
    activation_status: person.activation_status,
    activation_reason: person.activation_reason,
    episode_count: person.episode_count,
    podcast_count: person.podcast_count,
    distinct_podcast_count: person.distinct_podcast_count,
    strong_mention_count: person.strong_mention_count,
    host_count: person.host_count,
    guest_count: person.guest_count,
    subject_count: person.subject_count,
    mentioned_count: person.mentioned_count,
    latest_episode_at: person.latest_episode_at,
    wikipedia_match_status: person.wikipedia_match_status,
    wikipedia_match_confidence: person.wikipedia_match_confidence,
    ai_bio: person.ai_bio,
    overview_text: person.overview_text,
    sample_mentions: (mentionsQ.data || []).map((m: any) => ({
      type: m.mention_type,
      confidence: m.confidence,
      podcast: m.episodes?.podcasts?.title,
      episode_title: m.episodes?.title,
      episode_description: (m.episodes?.description || "").slice(0, 280),
      evidence: m.evidence || null,
    })),
    podcasts_map: (podMapQ.data || []).map((p: any) => ({
      role: p.role, episodes: p.episode_count, podcast: p.podcasts?.title,
    })),
    duplicate_candidates: (dupQ.data || []).map((d: any) => ({ id: d.id, name: d.name, slug: d.slug, episode_count: d.episode_count })),
  };
}

const HARD_AUTO_DOWNGRADE_FLAGS = new Set([
  "not_a_person","fragment","likely_topic_not_person","likely_organization_not_person",
  "weak_one_off","only_first_name",
]);

function shouldAutoDowngrade(args: any): { downgrade: boolean; reason: string } {
  if (!args) return { downgrade: false, reason: "" };
  if (!["hide","reject"].includes(args.recommended_action)) return { downgrade: false, reason: "" };
  if ((args.confidence ?? 0) < 0.9) return { downgrade: false, reason: "" };
  const matched = (args.flags || []).filter((f: string) => HARD_AUTO_DOWNGRADE_FLAGS.has(f));
  if (matched.length === 0) return { downgrade: false, reason: "" };
  return { downgrade: true, reason: `${args.recommended_action}: ${matched.join(",")}` };
}

async function reviewOne(admin: any, personId: string): Promise<any> {
  const { data: p } = await admin.from("people").select("*").eq("id", personId).maybeSingle();
  if (!p) return { id: personId, skipped: "not_found" };
  if (p.manual_approved) return { id: personId, skipped: "manual_approved" };

  const evidence = await collectEvidence(admin, p as PersonRow);

  const { data: jobRow } = await admin.from("person_ai_review_jobs").insert({
    person_id: personId, status: "running", started_at: new Date().toISOString(),
    input_snapshot: { name: p.name, slug: p.slug, counts: {
      episode: p.episode_count, strong: p.strong_mention_count, hosts: p.host_count,
      guest: p.guest_count, subject: p.subject_count, mentioned: p.mentioned_count,
      distinct_podcast: p.distinct_podcast_count,
    } },
  }).select("id").maybeSingle();
  const jobId = jobRow?.id;

  const ai = await callAI(evidence);
  if (ai.error || !ai.args) {
    if (jobId) await admin.from("person_ai_review_jobs").update({
      status: "failed", error_message: ai.error || "unknown", finished_at: new Date().toISOString(),
    }).eq("id", jobId);
    return { id: personId, error: ai.error || "no_args" };
  }
  await bumpSpend(admin, ai.cost);

  const args = sanitize(ai.args);
  const dup = args.duplicate_candidate || {};
  const reviewStatus = dup.is_duplicate ? "duplicate_candidate"
    : args.recommended_action === "needs_review" ? "needs_human_review"
    : "reviewed";

  const update: any = {
    ai_review_status: reviewStatus,
    ai_review_score: args.review_score,
    ai_review_confidence: args.confidence,
    ai_review_flags: args.flags,
    ai_review_summary: args.summary,
    ai_recommended_action: args.recommended_action,
    ai_recommended_canonical_name: args.canonical_name || null,
    ai_duplicate_of_person_id: dup.duplicate_of_person_id || null,
    ai_reviewed_at: new Date().toISOString(),
    ai_review_model: MODEL,
    ai_review_sources: { evidence_keys: Object.keys(evidence), ai_cost_usd: ai.cost },
  };

  // Safe auto-downgrade
  const dg = shouldAutoDowngrade(args);
  if (dg.downgrade && !p.manual_approved) {
    update.is_public = false;
    update.is_indexable = false;
    update.activation_status = "inactive";
    update.activation_reason = `AI quality review downgrade: ${dg.reason}`;
  }

  await admin.from("people").update(update).eq("id", personId);

  if (jobId) await admin.from("person_ai_review_jobs").update({
    status: "completed",
    finished_at: new Date().toISOString(),
    output_snapshot: { args, auto_downgraded: dg.downgrade, cost_usd: ai.cost },
  }).eq("id", jobId);

  return { id: personId, action: args.recommended_action, conf: args.confidence, auto_downgraded: dg.downgrade, cost_usd: ai.cost };
}

async function selectCandidates(admin: any, limit: number): Promise<string[]> {
  // Priority cascade: indexable w/o review, public w/ many eps, possible duplicates, ai_bio w/o verified wiki, public_noindex
  const seen = new Set<string>();
  const ids: string[] = [];
  const add = (rows: any[] | null) => {
    (rows || []).forEach((r: any) => {
      if (!seen.has(r.id) && ids.length < limit) { seen.add(r.id); ids.push(r.id); }
    });
  };

  // 1. currently indexable without review
  const { data: a } = await admin.from("people").select("id")
    .eq("is_indexable", true).neq("ai_review_status", "reviewed")
    .neq("ai_review_status", "duplicate_candidate")
    .order("episode_count", { ascending: false }).limit(limit);
  add(a);

  if (ids.length < limit) {
    // 2. public people with many episodes, no review
    const { data: b } = await admin.from("people").select("id")
      .eq("is_public", true).eq("ai_review_status", "pending")
      .gte("episode_count", 3)
      .order("episode_count", { ascending: false }).limit(limit);
    add(b);
  }

  if (ids.length < limit) {
    // 3. people with possible duplicates (same normalized_name)
    const { data: dups } = await admin.rpc("find_duplicate_person_ids", { _limit: limit }).maybeSingle?.() ?? { data: null };
    add(dups as any);
  }

  if (ids.length < limit) {
    // 4. AI bio generated but no verified wiki match
    const { data: c } = await admin.from("people").select("id")
      .not("ai_bio", "is", null).neq("wikipedia_match_status", "verified")
      .eq("ai_review_status", "pending")
      .order("episode_count", { ascending: false }).limit(limit);
    add(c);
  }

  if (ids.length < limit) {
    // 5. public_noindex
    const { data: d } = await admin.from("people").select("id")
      .eq("activation_status", "public_noindex").eq("ai_review_status", "pending")
      .order("episode_count", { ascending: false }).limit(limit);
    add(d);
  }

  return ids.slice(0, limit);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit || 20), 1), 50);
  const personIds: string[] = Array.isArray(body.person_ids) ? body.person_ids : [];

  const spent = await dailySpend(admin);
  if (spent >= DAILY_BUDGET_USD && !body.ignore_budget) {
    return new Response(JSON.stringify({ paused: "budget_reached", spent_today: spent, budget: DAILY_BUDGET_USD }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ids = personIds.length > 0 ? personIds.slice(0, limit) : await selectCandidates(admin, limit);
  const results: any[] = [];
  let totalCost = 0;
  for (const id of ids) {
    const r = await reviewOne(admin, id);
    if (typeof r.cost_usd === "number") totalCost += r.cost_usd;
    results.push(r);
    if ((await dailySpend(admin)) >= DAILY_BUDGET_USD) {
      results.push({ stopped: "budget_reached_mid_run" });
      break;
    }
    await new Promise(res => setTimeout(res, 80));
  }
  return new Response(JSON.stringify({
    processed: results.length, ids_selected: ids.length, total_cost_usd: totalCost, results,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
