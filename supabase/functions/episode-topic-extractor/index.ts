// episode-topic-extractor: bottom-up, taxonomy-free topic discovery.
// For each pending episode (clean_text present), asks the LLM: "What is this episode about?"
// Returns 3-7 free-form topic labels — NO predefined list, NO hints, NO taxonomy injection.
// Output goes to public.episode_extracted_topics. Clustering / normalization happens later
// in a separate pipeline once we have enough samples.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { chatTokenCostUsd } from "../_shared/ai-pricing.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TOOL = {
  type: "function",
  function: {
    name: "describe_episode_topics",
    description: "List the actual topics this podcast episode is about, derived ONLY from the provided text. Do not invent or generalize beyond evidence.",
    parameters: {
      type: "object",
      properties: {
        topics: {
          type: "array",
          minItems: 1,
          maxItems: 7,
          items: {
            type: "object",
            properties: {
              label: { type: "string", description: "Concise topic label in the same language as the episode (Hungarian). 1-5 words. Specific, not generic. E.g. 'kvantumszámítógépek', '2026 magyar választás', 'éttermi nyitás Budapesten'. Avoid umbrella terms like 'politika', 'sport', 'gazdaság' unless the episode genuinely is just a broad overview." },
              kind: { type: "string", enum: ["event", "subject", "field", "person_focus", "place_focus", "work", "trend"], description: "What kind of thing this label refers to." },
              confidence: { type: "number", minimum: 0, maximum: 1 },
              evidence: { type: "string", description: "One short quote or paraphrase from the text that justifies this topic." }
            },
            required: ["label", "kind", "confidence", "evidence"],
            additionalProperties: false
          }
        }
      },
      required: ["topics"],
      additionalProperties: false
    }
  }
};

const SYSTEM = `You read a Hungarian podcast episode's cleaned transcript/description and identify what it is actually about.

Rules:
- Output ONLY topics that are demonstrably discussed in the provided text. No guessing from the title or vibe.
- Prefer SPECIFIC labels over generic ones. "magyar belpolitika 2026" is better than "politika". "Real Madrid–Barcelona 2024 El Clásico" is better than "futball".
- 3-7 topics maximum. Fewer is fine if the episode is narrow.
- Hungarian labels. Lowercase except proper nouns. No hashtags, no punctuation.
- Do NOT map onto any predefined taxonomy. Invent the most natural label for what you actually see.`;

async function extract(model: string, text: string, title: string): Promise<{ topics: any[]; usage: any } | null> {
  const key = Deno.env.get("LOVABLE_API_KEY");
  if (!key) return null;
  const body = `CÍM: ${title}\n\nSZÖVEG:\n${text.slice(0, 12000)}`;
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: body },
      ],
      tools: [TOOL],
      tool_choice: { type: "function", function: { name: "describe_episode_topics" } },
    }),
  });
  if (!res.ok) {
    console.warn("ai error", res.status, await res.text().catch(() => ""));
    return null;
  }
  const j = await res.json();
  const call = j.choices?.[0]?.message?.tool_calls?.[0];
  if (!call) return null;
  try {
    const args = JSON.parse(call.function?.arguments || "{}");
    if (!Array.isArray(args.topics)) return null;
    return { topics: args.topics, usage: j.usage };
  } catch {
    return null;
  }
}

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKC").replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "episode-topic-extractor");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "episode_topic_extractor_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    const body = await req.json().catch(() => ({}));
    if (ctrl.enabled === false && !body.force) return json({ ok: true, paused: true, reason: "disabled_by_controls" });

    const model = String(ctrl.model || "google/gemini-2.5-flash-lite");
    const batchLimit = Math.max(1, Math.min(60, Number(body.batch ?? ctrl.batch_limit ?? 30)));
    const tierFilter: string[] = Array.isArray(ctrl.tier_filter) ? ctrl.tier_filter : ["S"];
    const minChars = Number(ctrl.min_clean_chars ?? 400);
    const version = Number(ctrl.extractor_version ?? 1);
    const dailyBudget = Number(ctrl.daily_budget_usd ?? 10);

    // Budget check (today)
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const { data: spentRow } = await admin
      .from("ai_runs")
      .select("cost_usd")
      .eq("runner", "episode-topic-extractor")
      .gte("created_at", since.toISOString());
    const spentToday = (spentRow || []).reduce((a: number, r: any) => a + Number(r.cost_usd || 0), 0);
    if (spentToday >= dailyBudget) {
      return json({ ok: true, paused: true, reason: "daily_budget_exhausted", spent_today: spentToday });
    }

    // Claim pending episodes (S-tier only, clean_text done & long enough)
    const { data: eps, error: selErr } = await admin
      .from("episodes")
      .select("id, title, podcast_id, podcasts!inner(rank_label, language), episode_clean_text(cleaned_text)")
      .eq("topic_extraction_status", "pending")
      .eq("clean_text_status", "done")
      .in("podcasts.rank_label", tierFilter)
      .ilike("podcasts.language", "hu%")
      .limit(batchLimit);
    if (selErr) return json({ ok: false, error: selErr.message }, 500);
    if (!eps || eps.length === 0) return json({ ok: true, processed: 0, reason: "queue_empty" });

    let processed = 0, written = 0, skipped = 0, errors = 0, runCost = 0;
    const inserts: any[] = [];
    const doneIds: string[] = [];
    const skipIds: string[] = [];
    const errIds: string[] = [];

    for (const ep of eps as any[]) {
      processed++;
      const text = String(ep.episode_clean_text?.cleaned_text || "");
      if (text.length < minChars) {
        skipIds.push(ep.id); skipped++; continue;
      }
      const ai = await extract(model, text, String(ep.title || ""));
      if (!ai || ai.topics.length === 0) {
        errIds.push(ep.id); errors++; continue;
      }
      const inTok = Number(ai.usage?.prompt_tokens || Math.ceil(text.length / 4));
      const outTok = Number(ai.usage?.completion_tokens || 200) + Number(ai.usage?.completion_tokens_details?.reasoning_tokens || 0);
      runCost += chatTokenCostUsd(model, inTok, outTok);

      for (const t of ai.topics) {
        const rawLabel = String(t.label || "").trim();
        if (!rawLabel) continue;
        inserts.push({
          episode_id: ep.id,
          raw_label: rawLabel,
          normalized_label: normalize(rawLabel),
          kind: String(t.kind || "subject"),
          confidence: Math.max(0, Math.min(1, Number(t.confidence || 0.7))),
          rationale: String(t.evidence || "").slice(0, 500),
          model,
          extractor_version: version,
        });
      }
      doneIds.push(ep.id);
      written++;

      if (spentToday + runCost >= dailyBudget) break;
    }

    if (inserts.length > 0) {
      const { error: insErr } = await admin.from("episode_extracted_topics").insert(inserts);
      if (insErr) console.warn("insert error", insErr.message);
    }
    if (doneIds.length > 0) {
      for (let i = 0; i < doneIds.length; i += 150) {
        const slice = doneIds.slice(i, i + 150);
        await admin.from("episodes").update({
          topic_extraction_status: "done",
          topic_extraction_version: version,
          topic_extracted_at: new Date().toISOString(),
        }).in("id", slice);
      }
    }
    if (skipIds.length > 0) {
      for (let i = 0; i < skipIds.length; i += 150) {
        await admin.from("episodes").update({ topic_extraction_status: "skipped_short" }).in("id", skipIds.slice(i, i + 150));
      }
    }
    if (errIds.length > 0) {
      for (let i = 0; i < errIds.length; i += 150) {
        await admin.from("episodes").update({ topic_extraction_status: "error" }).in("id", errIds.slice(i, i + 150));
      }
    }

    // Log run cost
    try {
      await admin.from("ai_runs").insert({
        runner: "episode-topic-extractor",
        model,
        cost_usd: runCost,
        meta: { processed, written, skipped, errors, batch_limit: batchLimit },
      });
    } catch (_) { /* table optional */ }

    return json({
      ok: true,
      processed, written, skipped, errors,
      cost_usd: Number(runCost.toFixed(5)),
      spent_today: Number((spentToday + runCost).toFixed(4)),
      daily_budget_usd: dailyBudget,
      runtime_ms: Date.now() - startedAt,
    });
  } catch (e) {
    console.error("episode-topic-extractor err", e);
    return json({ ok: false, error: e instanceof Error ? e.message : "Unknown" }, 500);
  }
});
