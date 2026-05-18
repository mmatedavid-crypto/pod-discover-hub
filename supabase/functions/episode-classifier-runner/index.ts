// Full HU episode-level AI classifier.
// For each HU-eligible episode with ai_summary:
//   1. Build source_hash (title+desc+ai_summary+podcast_id+taxonomy_version)
//   2. Skip if cached row with same source_hash exists
//   3. Embed an anchor text, fetch vector candidates (similar HU episodes), and
//      fetch nearest topic/category seeds via simple in-memory taxonomy hints.
//   4. Send strict tool-call prompt to Lovable AI; receive classification.
//   5. Upsert episode_ai_classifications.
//
// Body: { batch?, concurrency?, dry_run?, model? }
// Stops at TIME_BUDGET_MS, daily budget, or empty queue.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TIME_BUDGET_MS = 22_000;
const TAXONOMY_VERSION = "v1";

// Pricing (USD per 1K tokens) — gemini-2.5-flash-lite via Lovable AI Gateway
const MODEL_PRICES: Record<string, { in: number; out: number }> = {
  "google/gemini-2.5-flash-lite": { in: 0.00010, out: 0.00040 },
  "google/gemini-2.5-flash":      { in: 0.00030, out: 0.00250 },
  "google/gemini-3.1-flash-preview": { in: 0.00010, out: 0.00040 },
};

const CLASSIFIER_TOOL = {
  type: "function",
  function: {
    name: "classify_episode",
    description: "Classify the SPECIFIC episode (not the podcast) into the public Podiverzum category & topic taxonomy. Use no_good_match when nothing fits. Hungarian reasons.",
    parameters: {
      type: "object",
      properties: {
        classification_status: { type: "string", enum: ["classified", "no_good_match", "too_thin", "needs_review"] },
        primary_category: { type: ["string", "null"], description: "category slug, or null" },
        secondary_categories: { type: "array", items: { type: "string" }, maxItems: 2 },
        topics: {
          type: "array", maxItems: 6,
          items: {
            type: "object",
            properties: {
              slug: { type: "string" },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              reason_hu: { type: "string" },
            },
            required: ["slug", "confidence", "reason_hu"],
            additionalProperties: false,
          },
        },
        rejected_topics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              slug: { type: "string" },
              reason_hu: { type: "string" },
            },
            required: ["slug", "reason_hu"],
            additionalProperties: false,
          },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        reason_hu: { type: "string" },
        false_positive_risks: { type: "array", items: { type: "string" } },
      },
      required: ["classification_status", "secondary_categories", "topics", "rejected_topics", "confidence", "reason_hu", "false_positive_risks"],
      additionalProperties: false,
    },
  },
};

const SYSTEM = `Te egy magyar podcast-besoroló asszisztens vagy. Pontosan EGY epizódot kapsz, és el kell döntened:
1) Beleillik-e EGY létező nyilvános Podiverzum kategóriába (primary_category) és max 2 másodlagosba.
2) Mely témákhoz (max 6) tartozik valóban, EPIZÓD-szintű bizonyíték alapján.

SZIGORÚ szabályok:
- Az epizód CÍMÉT, LEÍRÁSÁT és AI ÖSSZEFOGLALÓJÁT vedd alapul. A podcast neve és kategóriája csak GYENGE kontextus.
- Ha nincs erős illeszkedés egy kategóriához sem → classification_status="no_good_match", primary_category=null.
- Ha túl kevés a szöveges bizonyíték → "too_thin".
- Ha értelmezhető, de bizonytalan → "needs_review".
- Ha egyértelmű → "classified".
- A jobban illő, de elutasított jelölteket rakd a rejected_topics-ba a magyar indokkal.
- Inkább kevesebb erős téma, mint sok gyenge.
- Tipikus false positive kockázatok, ha érvényes: food_from_show_title_only, surname_orosz, podcast_level_category_only, weak_keyword_only, vector_similarity_without_episode_evidence.
- SOHA ne találj ki tényt. SOHA ne adj olyan slug-ot, ami nincs a megadott listában.`;

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function embed(text: string): Promise<number[] | null> {
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "google/gemini-embedding-001", input: text, dimensions: 768 }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j?.data?.[0]?.embedding ?? null;
  } catch { return null; }
}

async function callAI(model: string, messages: any[]) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, tools: [CLASSIFIER_TOOL], tool_choice: { type: "function", function: { name: "classify_episode" } } }),
  });
  if (res.status === 429) throw new Error("rate_limited");
  if (res.status === 402) throw new Error("budget_exhausted_provider");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ai_${res.status}:${text.slice(0, 200)}`);
  }
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const t0 = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const guard = await checkBackgroundJobsAllowed(admin, "episode-classifier-runner");
  if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

  const body = await req.json().catch(() => ({}));
  const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "episode_ai_classifier_controls").maybeSingle();
  const ctrl = (ctrlRow?.value || {}) as any;
  if (ctrl.enabled === false && !body.force) return json({ ok: true, paused: true });

  const dryRun = body.dry_run === true;
  const dailyBudget = Number(ctrl.daily_budget_usd ?? 10);
  const model = String(body.model || ctrl.model || "google/gemini-2.5-flash-lite");
  const price = MODEL_PRICES[model] || MODEL_PRICES["google/gemini-2.5-flash-lite"];

  // Adaptive throttle: scale toward max ceilings on clean streaks, scale down on errors.
  const maxBatch = Math.max(1, Math.min(1500, Number(ctrl.max_batch_size) || 800));
  const maxConc = Math.max(1, Math.min(40, Number(ctrl.max_concurrency) || 20));
  const minBatch = Math.max(1, Number(ctrl.min_batch_size) || 60);
  const minConc = Math.max(1, Number(ctrl.min_concurrency) || 3);
  const baseBatch = Number(ctrl.batch_size) || 120;
  const baseConc = Number(ctrl.concurrency) || 6;
  const autoAdapt = ctrl.auto_adapt !== false;
  const recentRuns: any[] = Array.isArray(ctrl.recent_runs) ? ctrl.recent_runs.slice(-3) : [];
  let adaptiveBatch = baseBatch;
  let adaptiveConc = baseConc;
  if (autoAdapt && recentRuns.length >= 1) {
    const lastErr = recentRuns[recentRuns.length - 1]?.errors || 0;
    const lastRate = recentRuns[recentRuns.length - 1]?.rate_limited || 0;
    const cleanStreak = recentRuns.filter((r) => (r?.errors || 0) === 0 && (r?.rate_limited || 0) === 0).length;
    if (lastRate > 0 || lastErr > 5) {
      adaptiveBatch = Math.max(minBatch, Math.floor(baseBatch * 0.5));
      adaptiveConc = Math.max(minConc, Math.floor(baseConc * 0.5));
    } else if (cleanStreak >= recentRuns.length && recentRuns.length >= 2) {
      adaptiveBatch = Math.min(maxBatch, Math.floor(baseBatch * 1.5));
      adaptiveConc = Math.min(maxConc, baseConc + 2);
    }
  }
  const batch = Math.max(1, Math.min(maxBatch, Number(body.batch) || adaptiveBatch));
  const concurrency = Math.max(1, Math.min(maxConc, Number(body.concurrency) || adaptiveConc));

  // Load taxonomy
  const [{ data: cats }, { data: tops }] = await Promise.all([
    admin.from("categories").select("slug, name, description, positive_hints, negative_hints").eq("active", true),
    admin.from("topics").select("slug, name, intro_text").eq("is_public", true).limit(200),
  ]);
  const catList = (cats || []).map((c: any) => `- ${c.slug}: ${c.name}${c.description ? " — " + c.description : ""}`).join("\n");
  const topicList = (tops || []).map((t: any) => `- ${t.slug}: ${t.name}`).join("\n");
  const validCatSlugs = new Set((cats || []).map((c: any) => c.slug));
  const validTopicSlugs = new Set((tops || []).map((t: any) => t.slug));

  // Spend tracking (atomic per-kind via add_ai_spend RPC)
  const dayKey = new Date().toISOString().slice(0, 10);
  const { data: spendRow } = await admin.from("ai_spend_daily").select("by_kind").eq("day", dayKey).maybeSingle();
  const byKind0 = (spendRow?.by_kind || {}) as any;
  let mySpend = Number(byKind0.episode_classifier || 0);
  let runIncrement = 0; // cost accumulated in this invocation
  let runCalls = 0;
  if (mySpend >= dailyBudget) return json({ ok: true, budget_reached: true, spend_usd: mySpend });

  let processed = 0, classified = 0, no_good_match = 0, too_thin = 0, needs_review = 0, failed = 0, cached_skips = 0;
  let rateLimited = 0;
  let stop = false;

  const runOne = async (ep: any) => {
    if (stop) return;
    if (Date.now() - t0 > TIME_BUDGET_MS - 5_000) { stop = true; return; }
    if (mySpend >= dailyBudget) { stop = true; return; }

    const podTitle = ep.podcasts?.display_title || ep.podcasts?.title || "—";
    const podCat = ep.podcasts?.category || "—";
    const epTitle = ep.display_title || ep.title || "";
    const epDesc = String(ep.ai_summary || ep.description || "").replace(/\s+/g, " ").trim().slice(0, 2400);
    const sourceText = `${epTitle}\n${epDesc}\n${ep.podcast_id}\n${TAXONOMY_VERSION}`;
    const source_hash = await sha256(sourceText);

    // Check cache
    const { data: existing } = await admin
      .from("episode_ai_classifications")
      .select("id, source_hash")
      .eq("episode_id", ep.id)
      .maybeSingle();
    if (existing && existing.source_hash === source_hash) { cached_skips++; return; }

    // Vector evidence: nearest already-classified neighbors
    let vectorEvidence: any = {};
    try {
      const anchor = `${epTitle}\n${epDesc.slice(0, 800)}`;
      const emb = await embed(anchor);
      if (emb) {
        const { data: neighbors } = await admin.rpc("match_hu_episodes_by_embedding", {
          query_embedding: emb as any,
          match_count: 12,
          min_similarity: 0.7,
        } as any);
        const neighborIds = (neighbors || []).map((n: any) => n.episode_id).filter((id: string) => id !== ep.id);
        if (neighborIds.length) {
          const { data: cls } = await admin
            .from("episode_ai_classifications")
            .select("episode_id, primary_category, topics, classification_status")
            .in("episode_id", neighborIds)
            .eq("classification_status", "classified");
          const catTally: Record<string, number> = {};
          const topicTally: Record<string, number> = {};
          for (const c of (cls || [])) {
            if (c.primary_category) catTally[c.primary_category] = (catTally[c.primary_category] || 0) + 1;
            for (const t of (c.topics as any[]) || []) {
              if (t?.slug) topicTally[t.slug] = (topicTally[t.slug] || 0) + 1;
            }
          }
          vectorEvidence = {
            similar_count: neighborIds.length,
            classified_neighbors: (cls || []).length,
            top_categories: Object.entries(catTally).sort((a, b) => b[1] - a[1]).slice(0, 5),
            top_topics: Object.entries(topicTally).sort((a, b) => b[1] - a[1]).slice(0, 8),
          };
        } else {
          vectorEvidence = { similar_count: 0 };
        }
      }
    } catch (e) {
      vectorEvidence = { error: String((e as any)?.message || e).slice(0, 120) };
    }

    if (dryRun) {
      processed++;
      return;
    }

    let parsed: any = null;
    try {
      const userPrompt = `EPIZÓD:
Podcast: ${podTitle} (podcast kategória, csak kontextus: ${podCat})
Cím: ${epTitle}
Leírás / AI-összefoglaló:
${epDesc || "(nincs)"}

VEKTOR-BIZONYÍTÉK hasonló, már osztályozott HU epizódokból:
${JSON.stringify(vectorEvidence)}

ELÉRHETŐ KATEGÓRIÁK (csak ezekből választhatsz):
${catList}

ELÉRHETŐ TÉMÁK (csak ezekből választhatsz):
${topicList}

Adj vissza egyetlen tool-call választ a megadott séma szerint, kizárólag létező slug-okkal. Magyarul indokolj.`;

      const ai = await callAI(model, [
        { role: "system", content: SYSTEM },
        { role: "user", content: userPrompt },
      ]);
      const usage = ai.usage || {};
      const inTok = Number(usage.prompt_tokens || 0);
      const outTok = Number(usage.completion_tokens || 0);
      const cost = (inTok / 1000) * price.in + (outTok / 1000) * price.out;
      const args = ai.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!args) throw new Error("no_tool_call");
      parsed = typeof args === "string" ? JSON.parse(args) : args;

      // Validate slugs against taxonomy
      const status = ["classified", "no_good_match", "too_thin", "needs_review"].includes(parsed.classification_status)
        ? parsed.classification_status : "needs_review";
      let primary = parsed.primary_category && validCatSlugs.has(parsed.primary_category) ? parsed.primary_category : null;
      const secondary = (Array.isArray(parsed.secondary_categories) ? parsed.secondary_categories : [])
        .filter((s: any) => typeof s === "string" && validCatSlugs.has(s) && s !== primary)
        .slice(0, 2);
      const topics = (Array.isArray(parsed.topics) ? parsed.topics : [])
        .filter((t: any) => t && typeof t.slug === "string" && validTopicSlugs.has(t.slug))
        .slice(0, 6);
      const rejected = (Array.isArray(parsed.rejected_topics) ? parsed.rejected_topics : [])
        .filter((t: any) => t && typeof t.slug === "string")
        .slice(0, 8);

      // Enforce no_good_match consistency
      const finalStatus = (status === "classified" && !primary && !topics.length) ? "no_good_match" : status;
      if (finalStatus !== "classified") { primary = null; }

      await admin.from("episode_ai_classifications").upsert({
        episode_id: ep.id,
        classification_status: finalStatus,
        primary_category: primary,
        secondary_categories: secondary,
        topics,
        rejected_topics: rejected,
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence) || 0)),
        reason_hu: String(parsed.reason_hu || "").slice(0, 500),
        false_positive_risks: Array.isArray(parsed.false_positive_risks) ? parsed.false_positive_risks.slice(0, 6) : [],
        vector_evidence: vectorEvidence,
        source_hash,
        taxonomy_version: TAXONOMY_VERSION,
        model_version: model,
        reviewed_by: "ai",
        updated_at: new Date().toISOString(),
      }, { onConflict: "episode_id" });

      processed++;
      if (finalStatus === "classified") classified++;
      else if (finalStatus === "no_good_match") no_good_match++;
      else if (finalStatus === "too_thin") too_thin++;
      else needs_review++;
      mySpend += cost; runIncrement += cost; runCalls++;
    } catch (e: any) {
      failed++;
      const msg = e?.message || "error";
      if (msg === "rate_limited") { rateLimited++; stop = true; }
      else if (msg === "budget_exhausted_provider") stop = true;
    }
  };

  // Drain loop
  while (!stop) {
    if (Date.now() - t0 > TIME_BUDGET_MS - 6_000) break;
    if (mySpend >= dailyBudget) break;

    const { data: candIds, error: candErr } = await admin
      .rpc("select_classifier_candidates", { p_limit: batch, p_taxonomy_version: TAXONOMY_VERSION } as any);
    if (candErr) { failed++; break; }
    const ids = (candIds || []).map((r: any) => r.episode_id);
    if (!ids.length) break;

    // Chunk .in() to avoid PostgREST URL length limits (was silently breaking on batch>~150)
    const eps: any[] = [];
    for (let c = 0; c < ids.length; c += 100) {
      const chunk = ids.slice(c, c + 100);
      const { data: epsChunk, error: epsErr } = await admin
        .from("episodes")
        .select("id, title, display_title, description, ai_summary, podcast_id, podcasts!inner(title, display_title, category)")
        .in("id", chunk);
      if (epsErr) { failed++; continue; }
      if (epsChunk?.length) eps.push(...epsChunk);
    }
    if (!eps.length) break;

    let i = 0;
    const workers = Array.from({ length: concurrency }, async () => {
      while (true) {
        const idx = i++;
        if (idx >= eps.length || stop) return;
        if (Date.now() - t0 > TIME_BUDGET_MS - 6_000) { stop = true; return; }
        await runOne(eps[idx]);
      }
    });
    await Promise.all(workers);

    // Flush spend after each batch so partial work is accounted even if killed.
    if (!dryRun && runIncrement > 0) {
      try {
        await admin.rpc("add_ai_spend", {
          p_day: dayKey,
          p_kind: "episode_classifier",
          p_amount: runIncrement,
          p_calls: runCalls,
        } as any);
        runIncrement = 0; runCalls = 0;
      } catch (_e) { /* ignore, retry next batch */ }
    }
  }

  if (!dryRun && runIncrement > 0) {
    // Atomic per-kind merge — does NOT clobber other runners' by_kind entries.
    await admin.rpc("add_ai_spend", {
      p_day: dayKey,
      p_kind: "episode_classifier",
      p_amount: runIncrement,
      p_calls: runCalls,
    } as any);
  }
  // Persist run telemetry for adaptive throttle (last 3 runs).
  if (!dryRun) {
    const runEntry = {
      ts: new Date().toISOString(),
      processed, classified, failed, rate_limited: rateLimited,
      errors: failed, batch, concurrency,
      elapsed_ms: Date.now() - t0,
    };
    const nextRuns = [...recentRuns, runEntry].slice(-3);
    const nextCtrl: any = { ...ctrl, recent_runs: nextRuns };
    if (mySpend >= dailyBudget) {
      nextCtrl.enabled = false;
      nextCtrl.auto_paused_reason = "daily_budget_reached";
      nextCtrl.auto_paused_at = new Date().toISOString();
    }
    await admin.from("app_settings").upsert({
      key: "episode_ai_classifier_controls",
      value: nextCtrl,
      updated_at: new Date().toISOString(),
    });
  }

  return json({
    ok: true, dry_run: dryRun, elapsed_ms: Date.now() - t0,
    processed, classified, no_good_match, too_thin, needs_review, failed, cached_skips,
    rate_limited: rateLimited,
    spend_usd: mySpend, budget_usd: dailyBudget, model,
    effective_batch: batch, effective_concurrency: concurrency,
  });
});
