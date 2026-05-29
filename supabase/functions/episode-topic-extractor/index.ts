// episode-topic-extractor: bottom-up, taxonomy-free topic discovery.
// For each pending episode (clean_text present), asks the LLM: "What is this episode about?"
// Returns 3-7 free-form topic labels — NO predefined list, NO hints, NO taxonomy injection.
// Output goes to public.episode_extracted_topics. Clustering / normalization happens later.
//
// 2026-05-28: parallelized (Promise.all, concurrency=8) + drain loop with time budget
// so each invocation processes 60-150 episodes instead of 2-3.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { chatTokenCostUsd } from "../_shared/ai-pricing.ts";
import { callLovableAI } from "../_shared/lovable-ai.ts";

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

async function extract(model: string, text: string, title: string, episodeId: string, timeoutMs = 25000): Promise<{ topics: any[]; usage: any } | null> {
  const body = `CÍM: ${title}\n\nSZÖVEG:\n${text.slice(0, 12000)}`;
  const ctrl = new AbortController();
  const tm = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const ai = await Promise.race([
      callLovableAI({
        model,
        job_type: "episode_topic_extractor",
        target_type: "episode",
        target_id: episodeId,
        prompt_version: "topic-extractor-v1",
        input_text: text,
        min_input_chars: 400,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: body },
        ],
        tools: [TOOL],
        tool_choice: { type: "function", function: { name: "describe_episode_topics" } },
      }),
      new Promise<null>((resolve) => {
        ctrl.signal.addEventListener("abort", () => resolve(null), { once: true });
      }),
    ]);
    if (!ai || !ai.ok) {
      console.warn("topic extractor ai skipped/error", ai?.status, ai?.error);
      return null;
    }
    const j = ai.data;
    const call = j.choices?.[0]?.message?.tool_calls?.[0];
    if (!call) return null;
    try {
      const args = JSON.parse(call.function?.arguments || "{}");
      if (!Array.isArray(args.topics)) return null;
      return {
        topics: args.topics,
        usage: {
          prompt_tokens: ai.input_tokens || j.usage?.prompt_tokens || 0,
          completion_tokens: ai.output_tokens || j.usage?.completion_tokens || 0,
          completion_tokens_details: j.usage?.completion_tokens_details || {},
        },
      };
    } catch {
      return null;
    }
  } catch (e) {
    console.warn("ai fetch failed", e instanceof Error ? e.message : String(e));
    return null;
  } finally {
    clearTimeout(tm);
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
    if (ctrl.enabled !== true) return json({ ok: true, paused: true, reason: "disabled_by_controls" });

    const model = String(ctrl.model || "google/gemini-2.5-flash-lite");
    if (/(openai\/gpt-5|gpt-5|gemini-.*-pro|\/.*-pro|gemini-3)/i.test(model)) {
      return json({ ok: true, paused: true, reason: "blocked_batch_model", model });
    }
    const batchSize = Math.max(1, Math.min(40, Number(body.batch ?? ctrl.batch_limit ?? 20)));
    const concurrency = Math.max(1, Math.min(12, Number(ctrl.concurrency ?? 8)));
    const tierFilter: string[] = Array.isArray(ctrl.tier_filter) ? ctrl.tier_filter : ["S"];
    const minChars = Number(ctrl.min_clean_chars ?? 400);
    const version = Number(ctrl.extractor_version ?? 1);
    const dailyBudget = Number(ctrl.daily_budget_usd ?? 10);
    const maxRuntimeMs = Math.max(20000, Math.min(140000, Number(ctrl.max_runtime_ms ?? 120000)));

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

    let totalProcessed = 0, totalWritten = 0, totalSkipped = 0, totalErrors = 0, runCost = 0, batches = 0;

    // Drain loop: keep claiming batches until time budget exhausted, queue empty, or budget exhausted
    while (Date.now() - startedAt < maxRuntimeMs) {
      // Need at least ~25s headroom per batch (AI calls can take 20s+)
      if (maxRuntimeMs - (Date.now() - startedAt) < 25000) break;
      if (spentToday + runCost >= dailyBudget) break;

      // Claim pending S-tier episodes with clean_text done
      const { data: epsRaw, error: selErr } = await admin
        .from("episodes")
        .select("id, title, podcast_id, podcasts!inner(rank_label, language)")
        .eq("topic_extraction_status", "pending")
        .eq("clean_text_status", "done")
        .in("podcasts.rank_label", tierFilter)
        .ilike("podcasts.language", "hu%")
        .limit(batchSize);
      if (selErr) return json({ ok: false, error: selErr.message }, 500);
      if (!epsRaw || epsRaw.length === 0) break;

      // Mark as in_progress immediately to prevent re-claim by next cron tick
      const claimIds = epsRaw.map((e: any) => e.id);
      await admin.from("episodes").update({ topic_extraction_status: "in_progress" }).in("id", claimIds);

      // Fetch clean_text
      const { data: cts } = await admin.from("episode_clean_text").select("episode_id, cleaned_text").in("episode_id", claimIds);
      const ctMap = new Map<string, string>((cts || []).map((r: any) => [r.episode_id, r.cleaned_text || ""]));

      // Pre-filter short ones
      const skipIds: string[] = [];
      const work: any[] = [];
      for (const ep of epsRaw as any[]) {
        const text = String(ctMap.get(ep.id) || "");
        if (text.length < minChars) { skipIds.push(ep.id); continue; }
        work.push({ ep, text });
      }

      const inserts: any[] = [];
      const doneIds: string[] = [];
      const errIds: string[] = [];

      // Process in parallel chunks
      for (let i = 0; i < work.length; i += concurrency) {
        if (Date.now() - startedAt > maxRuntimeMs - 5000) {
          // Out of time — release remaining as pending again
          const remaining = work.slice(i).map((w) => w.ep.id);
          if (remaining.length > 0) {
            await admin.from("episodes").update({ topic_extraction_status: "pending" }).in("id", remaining);
          }
          break;
        }
        const slice = work.slice(i, i + concurrency);
        const results = await Promise.all(
          slice.map(({ ep, text }) => extract(model, text, String(ep.title || ""), ep.id).then((ai) => ({ ep, text, ai })))
        );
        for (const { ep, text, ai } of results) {
          if (!ai || ai.topics.length === 0) { errIds.push(ep.id); continue; }
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
        }
      }

      // Persist this batch
      if (inserts.length > 0) {
        for (let i = 0; i < inserts.length; i += 500) {
          const { error: insErr } = await admin.from("episode_extracted_topics").insert(inserts.slice(i, i + 500));
          if (insErr) console.warn("insert error", insErr.message);
        }
      }
      if (doneIds.length > 0) {
        for (let i = 0; i < doneIds.length; i += 150) {
          await admin.from("episodes").update({
            topic_extraction_status: "done",
            topic_extraction_version: version,
            topic_extracted_at: new Date().toISOString(),
          }).in("id", doneIds.slice(i, i + 150));
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

      totalProcessed += epsRaw.length;
      totalWritten += doneIds.length;
      totalSkipped += skipIds.length;
      totalErrors += errIds.length;
      batches++;
    }

    // Log run cost
    try {
      await admin.from("ai_runs").insert({
        runner: "episode-topic-extractor",
        model,
        cost_usd: runCost,
        meta: { processed: totalProcessed, written: totalWritten, skipped: totalSkipped, errors: totalErrors, batches },
      });
    } catch (_) { /* table optional */ }

    return json({
      ok: true,
      batches,
      processed: totalProcessed,
      written: totalWritten,
      skipped: totalSkipped,
      errors: totalErrors,
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
