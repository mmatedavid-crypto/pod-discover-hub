// organization-ai-reviewer
// Reviews organizations (companies, parties, media, institutions, etc.) extracted
// from HU podcast episodes. Recommends action, applies safe auto-downgrades.
// Uses Lovable AI Gateway (google/gemini-2.5-flash).

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
const MODEL = "google/gemini-2.5-flash";
const DAILY_BUDGET_USD = 15;

const ALLOWED_ACTIONS = new Set([
  "keep_indexable", "keep_public_noindex", "hide", "merge", "needs_review", "reject", "mark_internal",
]);
const ALLOWED_FLAGS = new Set([
  "not_an_organization", "platform_account_noise", "podcast_internal_chrome",
  "ambiguous_brand", "possible_duplicate", "thin_evidence", "weak_one_off",
  "wrong_org_type", "needs_accent_fix", "verified_real_org", "real_political_party",
  "real_media_outlet", "real_institution", "real_company", "real_ngo",
  "topic_not_org", "person_not_org", "generic_term",
]);
const ALLOWED_ORG_TYPES = new Set([
  "company", "party", "media", "institution", "ngo", "government", "university",
  "sports_team", "religious", "platform", "other",
]);

const REVIEW_TOOL = {
  type: "function",
  function: {
    name: "submit_org_review",
    description: "Return a strict quality review of the organization.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        is_real_organization: { type: "boolean" },
        canonical_name: { type: "string" },
        recommended_org_type: { type: "string", enum: [...ALLOWED_ORG_TYPES] },
        recommended_action: { type: "string", enum: [...ALLOWED_ACTIONS] },
        recommended_is_public: { type: "boolean" },
        recommended_is_indexable: { type: "boolean" },
        duplicate_candidate: {
          type: "object",
          additionalProperties: false,
          properties: {
            is_duplicate: { type: "boolean" },
            duplicate_of_name: { type: ["string", "null"] },
            duplicate_of_organization_id: { type: ["string", "null"] },
            reason: { type: "string" },
          },
          required: ["is_duplicate", "duplicate_of_name", "duplicate_of_organization_id", "reason"],
        },
        flags: { type: "array", items: { type: "string", enum: [...ALLOWED_FLAGS] } },
        confidence: { type: "number" },
        review_score: { type: "number" },
        summary: { type: "string" },
      },
      required: [
        "is_real_organization", "canonical_name", "recommended_org_type",
        "recommended_action", "recommended_is_public", "recommended_is_indexable",
        "duplicate_candidate", "flags", "confidence", "review_score", "summary",
      ],
    },
  },
};

const SYSTEM_PROMPT = `Magyar podcast-katalógus szervezet entitásait minősíted SEO és felhasználói minőség szempontjából.
Feladat: döntsd el, hogy egy kinyert "organization" valódi, említésre méltó szervezet-e, érdemes-e publikus / indexálható oldalt csinálni.

Szigorú szabályok:
- Csak a megadott bizonyíték alapján dolgozz, soha ne találj ki tényt.
- mark_internal: ha platform/podcast chrome (pl. "Spotify", "Apple Podcasts", "Patreon", "Facebook", "Instagram", "TikTok", "YouTube", "Discord szerver"), vagy ha láthatóan a podcast saját csatorna/lábléc említése (pl. "Kövess minket Facebookon").
- reject / not_an_organization: ha valójában személy, topic, általános fogalom, vagy értelmetlen fragmens.
- hide: gyenge bizonyíték (1 epizód, 1 podcast), vagy félrevezető brand.
- keep_indexable: valódi szervezet + elég bizonyíték (több epizód, több podcast, vagy ismert valós szervezet — pl. politikai párt, ismert cég, közmédia, egyetem, intézmény).
- keep_public_noindex: valódi szervezet de túl vékony tartalom az indexáláshoz.
- merge: duplikátum gyanú (pl. "Tisza Párt" vs "Tisza"). Tölts ki duplicate_candidate-et.
- needs_review: bizonytalan.
- recommended_org_type: a valódi típus (company/party/media/institution/ngo/government/university/sports_team/religious/platform/other).
- summary: rövid magyar nyelvű indoklás.`;

async function dailySpend(admin: any): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin.from("ai_spend_daily").select("by_kind").eq("day", today).maybeSingle();
  return Number(((data?.by_kind as any) || {}).org_ai_review || 0);
}

async function bumpSpend(admin: any, cost: number) {
  const today = new Date().toISOString().slice(0, 10);
  const { data } = await admin.from("ai_spend_daily").select("by_kind, spend_usd, calls").eq("day", today).maybeSingle();
  const byKind: any = (data?.by_kind as any) || {};
  byKind.org_ai_review = Number(byKind.org_ai_review || 0) + cost;
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
      tool_choice: { type: "function", function: { name: "submit_org_review" } },
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
  const outTok = (j?.usage?.completion_tokens || 0) + (j?.usage?.completion_tokens_details?.reasoning_tokens || 0);
  const cost = chatTokenCostUsd(MODEL, Number(inTok || 0), Number(outTok || 0));
  return { args: parsed, cost };
}

function sanitize(args: any): any {
  if (!args || typeof args !== "object") return null;
  if (typeof args.recommended_action !== "string" || !ALLOWED_ACTIONS.has(args.recommended_action)) {
    args.recommended_action = "needs_review";
  }
  if (typeof args.recommended_org_type !== "string" || !ALLOWED_ORG_TYPES.has(args.recommended_org_type)) {
    args.recommended_org_type = "other";
  }
  args.flags = Array.isArray(args.flags) ? args.flags.filter((f: any) => typeof f === "string" && ALLOWED_FLAGS.has(f)) : [];
  args.confidence = Math.max(0, Math.min(1, Number(args.confidence) || 0));
  args.review_score = Math.max(0, Math.min(1, Number(args.review_score) || 0));
  args.summary = String(args.summary || "").slice(0, 800);
  args.canonical_name = String(args.canonical_name || "").slice(0, 200);
  if (!args.duplicate_candidate || typeof args.duplicate_candidate !== "object") {
    args.duplicate_candidate = { is_duplicate: false, duplicate_of_name: null, duplicate_of_organization_id: null, reason: "" };
  }
  return args;
}

async function collectEvidence(admin: any, org: any) {
  const [aliasesQ, mapQ, dupQ] = await Promise.all([
    admin.from("organization_aliases").select("alias").eq("organization_id", org.id).limit(15),
    admin.from("episode_organization_map")
      .select("role, confidence, episodes!inner(title, description, podcasts!inner(title, language))")
      .eq("organization_id", org.id)
      .ilike("episodes.podcasts.language", "hu%")
      .limit(15),
    admin.from("organizations")
      .select("id, name, slug, episode_count, org_type")
      .eq("normalized_name", org.normalized_name)
      .neq("id", org.id)
      .limit(5),
  ]);
  return {
    name: org.name,
    slug: org.slug,
    normalized_name: org.normalized_name,
    current_org_type: org.org_type,
    aliases: (aliasesQ.data || []).map((a: any) => a.alias),
    current_is_public: org.is_public,
    current_is_indexable: org.is_indexable,
    current_is_podcast_internal: org.is_podcast_internal,
    episode_count: org.episode_count,
    gated_episode_count: org.gated_episode_count,
    distinct_podcast_count: org.distinct_podcast_count,
    mention_count: org.mention_count,
    primary_count: org.primary_count,
    latest_episode_at: org.latest_episode_at,
    wikipedia_match_status: org.wikipedia_match_status,
    wikipedia_match_confidence: org.wikipedia_match_confidence,
    wikipedia_title: org.wikipedia_title,
    wikipedia_extract: (org.wikipedia_extract || "").slice(0, 600),
    ai_bio: (org.ai_bio || "").slice(0, 600),
    sample_episodes: (mapQ.data || []).map((m: any) => ({
      role: m.role,
      confidence: m.confidence,
      podcast: m.episodes?.podcasts?.title,
      episode_title: m.episodes?.title,
      episode_description: (m.episodes?.description || "").slice(0, 240),
    })),
    duplicate_candidates: (dupQ.data || []).map((d: any) => ({
      id: d.id, name: d.name, slug: d.slug, episode_count: d.episode_count, org_type: d.org_type,
    })),
  };
}

const HARD_AUTO_DOWNGRADE_FLAGS = new Set([
  "not_an_organization", "platform_account_noise", "podcast_internal_chrome",
  "topic_not_org", "person_not_org", "generic_term", "weak_one_off",
]);

function shouldAutoDowngrade(args: any): { action: "none" | "hide" | "mark_internal"; reason: string } {
  if (!args) return { action: "none", reason: "" };
  if ((args.confidence ?? 0) < 0.85) return { action: "none", reason: "" };
  const matched = (args.flags || []).filter((f: string) => HARD_AUTO_DOWNGRADE_FLAGS.has(f));
  if (args.recommended_action === "mark_internal" && matched.length > 0) {
    return { action: "mark_internal", reason: `mark_internal: ${matched.join(",")}` };
  }
  if (["hide", "reject"].includes(args.recommended_action) && matched.length > 0) {
    return { action: "hide", reason: `${args.recommended_action}: ${matched.join(",")}` };
  }
  return { action: "none", reason: "" };
}

async function reviewOne(admin: any, organizationId: string): Promise<any> {
  const { data: o } = await admin.from("organizations").select("*").eq("id", organizationId).maybeSingle();
  if (!o) return { id: organizationId, skipped: "not_found" };
  if (o.manually_seeded) return { id: organizationId, skipped: "manually_seeded" };

  const evidence = await collectEvidence(admin, o);

  const { data: jobRow } = await admin.from("org_ai_review_jobs").insert({
    organization_id: organizationId,
    status: "running",
    started_at: new Date().toISOString(),
    input_snapshot: {
      name: o.name, slug: o.slug, org_type: o.org_type,
      counts: { episode: o.episode_count, podcasts: o.distinct_podcast_count, mention: o.mention_count, primary: o.primary_count },
    },
  }).select("id").maybeSingle();
  const jobId = jobRow?.id;

  const ai = await callAI(evidence);
  if (ai.error || !ai.args) {
    if (jobId) await admin.from("org_ai_review_jobs").update({
      status: "failed", error_message: ai.error || "unknown", finished_at: new Date().toISOString(),
    }).eq("id", jobId);
    return { id: organizationId, error: ai.error || "no_args" };
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
    ai_recommended_org_type: args.recommended_org_type || null,
    ai_duplicate_of_organization_id: dup.duplicate_of_organization_id || null,
    ai_reviewed_at: new Date().toISOString(),
    ai_review_model: MODEL,
    ai_review_sources: { ai_cost_usd: ai.cost },
  };

  const dg = shouldAutoDowngrade(args);
  if (dg.action === "mark_internal") {
    update.is_podcast_internal = true;
    update.podcast_internal_reason = `AI: ${dg.reason}`;
    update.is_public = false;
    update.is_indexable = false;
    update.is_browsable_in_hub = false;
  } else if (dg.action === "hide") {
    update.is_public = false;
    update.is_indexable = false;
    update.is_browsable_in_hub = false;
  }

  await admin.from("organizations").update(update).eq("id", organizationId);

  if (jobId) await admin.from("org_ai_review_jobs").update({
    status: "completed",
    finished_at: new Date().toISOString(),
    output_snapshot: { args, auto_action: dg.action, cost_usd: ai.cost },
  }).eq("id", jobId);

  return { id: organizationId, action: args.recommended_action, conf: args.confidence, auto: dg.action, cost_usd: ai.cost };
}

async function selectCandidates(admin: any, limit: number): Promise<string[]> {
  // Priority: public + pending, highest episode_count first
  const { data } = await admin.from("organizations").select("id")
    .eq("ai_review_status", "pending")
    .eq("is_public", true)
    .eq("manually_seeded", false)
    .order("episode_count", { ascending: false })
    .limit(limit);
  return (data || []).map((r: any) => r.id);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit || 25), 1), 60);
  const orgIds: string[] = Array.isArray(body.organization_ids) ? body.organization_ids : [];

  const spent = await dailySpend(admin);
  if (spent >= DAILY_BUDGET_USD && !body.ignore_budget) {
    return new Response(JSON.stringify({ paused: "budget_reached", spent_today: spent, budget: DAILY_BUDGET_USD }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const ids = orgIds.length > 0 ? orgIds.slice(0, limit) : await selectCandidates(admin, limit);
  const results: any[] = [];
  let totalCost = 0;
  for (const id of ids) {
    const r = await reviewOne(admin, id);
    if (typeof r.cost_usd === "number") totalCost += r.cost_usd;
    results.push(r);
    if ((await dailySpend(admin)) >= DAILY_BUDGET_USD && !body.ignore_budget) {
      results.push({ stopped: "budget_reached_mid_run" });
      break;
    }
    await new Promise(res => setTimeout(res, 80));
  }

  // Recompute counts if any auto-actions applied
  const anyAuto = results.some((r: any) => r.auto && r.auto !== "none");
  if (anyAuto) {
    await admin.rpc("recompute_org_gated_counts").catch(() => {});
  }

  return new Response(JSON.stringify({
    reviewed: results.length,
    total_cost_usd: Number(totalCost.toFixed(6)),
    spent_today: await dailySpend(admin),
    results,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
