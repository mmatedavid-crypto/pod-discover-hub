// AI-based exact language verifier for podcasts.
// Uses Gemini on title + description (+ up to 3 recent episode titles) to decide
// the primary spoken language. Authoritative: overrides the heuristic gate.
//
// POST body:
//   {
//     mode?: "accepted" | "ungated" | "ids",   // default "accepted"
//     ids?: string[],                          // when mode="ids"
//     limit?: number,                          // default 50, max 300
//     dry_run?: boolean,                       // default false
//     min_confidence?: number,                 // default 0.7
//     model?: string,                          // default google/gemini-2.5-flash-lite
//   }
//
// Behaviour:
//   - HU with conf >= min_confidence  → is_hungarian=true, language_decision=accept_hungarian, language='hu'
//   - non-HU with conf >= min_confidence → is_hungarian=false, language_decision=reject_foreign, language=<code>
//   - otherwise → language_decision=review_uncertain (no flip)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callLovableAI } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";

async function detectLanguage(model: string, title: string, description: string, epTitles: string[]) {
  const block = [
    `TITLE: ${title || "(none)"}`,
    `DESCRIPTION: ${(description || "").slice(0, 2500) || "(none)"}`,
    epTitles.length ? `RECENT EPISODE TITLES:\n- ${epTitles.slice(0, 3).join("\n- ")}` : "",
  ].filter(Boolean).join("\n\n");

  const ai = await callLovableAI({
    model,
    job_type: "ai_language_verifier",
    target_type: "podcast",
    prompt_version: "language-verifier-v2",
    input_text: block,
    min_input_chars: 40,
    messages: [
        {
          role: "system",
          content: "You determine the PRIMARY SPOKEN language of a podcast based on its title and description metadata. Reply ONLY via the set_language tool. Be strict: English text means 'en', Spanish 'es', Czech 'cs', etc. A podcast is Hungarian ONLY if the title/description is actually written in Hungarian (e.g. uses Hungarian words, accents, grammar). Marketing fluff in Hungarian inside an otherwise English show does NOT make it Hungarian.",
        },
        { role: "user", content: block },
    ],
    tools: [{
        type: "function",
        function: {
          name: "set_language",
          description: "Set the detected primary language",
          parameters: {
            type: "object",
            properties: {
              lang: { type: "string", description: "ISO-639-1 lowercase code (hu, en, de, es, fr, it, cs, ro, sk, etc.). Use 'unknown' if truly unclear." },
              confidence: { type: "number", description: "0..1, how confident in the language decision" },
              reason: { type: "string", description: "One short sentence of justification" },
            },
            required: ["lang", "confidence", "reason"],
            additionalProperties: false,
          },
        },
    }],
    tool_choice: { type: "function", function: { name: "set_language" } },
  });
  if (!ai.ok) throw new Error(ai.error || `ai_http_${ai.status}`);
  const j = ai.data;
  const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) throw new Error("ai_no_tool_call");
  return JSON.parse(args) as { lang: string; confidence: number; reason: string };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const started = Date.now();
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const mode: "accepted" | "ungated" | "ids" = body?.mode || "accepted";
    const limit = Math.max(1, Math.min(300, Number(body?.limit) || 50));
    const dryRun = body?.dry_run === true;
    const minConf = Math.max(0.5, Math.min(0.99, Number(body?.min_confidence) || 0.7));
    const model = String(body?.model || DEFAULT_MODEL);
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : [];

    let q = supabase
      .from("podcasts")
      .select("id,title,description,language,is_hungarian,language_decision,rank_label")
      .limit(limit);

    if (mode === "ids") {
      if (!ids.length) throw new Error("mode=ids requires ids[]");
      q = q.in("id", ids);
    } else if (mode === "ungated") {
      q = q.is("language_decision", null).in("rank_label", ["S", "A", "B", "C", "D", "E"]).order("rank_label", { ascending: true });
    } else {
      // accepted: re-verify the heuristic-accepted set, oldest checked first
      q = q.eq("is_hungarian", true).eq("language_decision", "accept_hungarian").order("language_checked_at", { ascending: true, nullsFirst: true });
    }

    const { data: rows, error } = await q;
    if (error) throw error;

    const CONCURRENCY = Math.max(1, Math.min(8, Number(body?.concurrency) || 6));
    const TIME_BUDGET_MS = 100_000;
    const results: any[] = [];
    let flipped_to_hu = 0, flipped_to_foreign = 0, kept = 0, review = 0, errors = 0;

    const queue = [...(rows || [])];
    const processOne = async (p: any) => {
      try {
        const { data: eps } = await supabase
          .from("episodes")
          .select("title")
          .eq("podcast_id", p.id)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(3);
        const epTitles = (eps || []).map((e: any) => e.title).filter(Boolean);

        const det = await detectLanguage(model, p.title || "", p.description || "", epTitles);
        const isHu = det.lang === "hu";
        const confident = det.confidence >= minConf;

        let action = "review";
        const patch: Record<string, unknown> = {
          language_checked_at: new Date().toISOString(),
          language_evidence: { ai: { lang: det.lang, conf: det.confidence, reason: det.reason, model, at: new Date().toISOString() } },
        };

        if (confident && isHu) {
          action = (!p.is_hungarian || p.language_decision !== "accept_hungarian") ? "flip_to_hu" : "kept_hu";
          patch.is_hungarian = true;
          patch.language_decision = "accept_hungarian";
          patch.language = "hu";
          patch.language_rejection_reason = null;
        } else if (confident && !isHu && det.lang !== "unknown") {
          action = p.is_hungarian ? "flip_to_foreign" : "kept_foreign";
          patch.is_hungarian = false;
          patch.language_decision = "reject_foreign";
          patch.language = det.lang;
          patch.language_rejection_reason = `ai_verifier:${det.lang}:${det.confidence.toFixed(2)}`;
        } else {
          patch.language_decision = "review_uncertain";
          patch.language_rejection_reason = `ai_low_confidence:${det.lang}:${det.confidence.toFixed(2)}`;
        }

        if (!dryRun) await supabase.from("podcasts").update(patch).eq("id", p.id);

        if (action === "flip_to_hu") flipped_to_hu++;
        else if (action === "flip_to_foreign") flipped_to_foreign++;
        else if (action === "review") review++;
        else kept++;

        results.push({ id: p.id, title: p.title, was_lang: p.language, was_hu: p.is_hungarian, ai_lang: det.lang, conf: det.confidence, reason: det.reason, action });
      } catch (e) {
        errors++;
        results.push({ id: p.id, title: p.title, error: String((e as Error)?.message || e) });
      }
    };

    const workers = Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length && Date.now() - started < TIME_BUDGET_MS) {
        const next = queue.shift();
        if (!next) break;
        await processOne(next);
      }
    });
    await Promise.all(workers);
    const remaining = queue.length;

    return new Response(JSON.stringify({
      ok: true, mode, dry_run: dryRun, model, min_confidence: minConf,
      scanned: (rows?.length || 0) - remaining,
      remaining_in_batch: remaining,
      flipped_to_hu, flipped_to_foreign, kept, review_uncertain: review, errors,
      elapsed_ms: Date.now() - started,
      results,
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
