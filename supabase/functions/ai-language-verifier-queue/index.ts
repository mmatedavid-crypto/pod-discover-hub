// AI language verifier for the discovery_queue (Approval Queue).
// Identifies non-Hungarian pending items via Gemini using title + description,
// and rejects confident non-HU entries so the approval queue stays Hungarian-only.
//
// POST body:
//   {
//     limit?: number,           // default 100, max 500
//     dry_run?: boolean,        // default false
//     min_confidence?: number,  // default 0.7
//     model?: string,           // default google/gemini-3-flash-preview
//     concurrency?: number,     // default 6, max 8
//     min_rank?: number,        // only scan candidates >= this rank (default 0)
//   }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_MODEL = "google/gemini-3.1-flash-lite-preview";

async function detectLanguage(model: string, title: string, description: string) {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) throw new Error("LOVABLE_API_KEY missing");
  const block = [
    `TITLE: ${title || "(none)"}`,
    `DESCRIPTION: ${(description || "").slice(0, 2500) || "(none)"}`,
  ].join("\n\n");

  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You determine the PRIMARY SPOKEN language of a podcast based on its title and description metadata. Reply ONLY via the set_language tool. Be strict: English text means 'en', Spanish 'es', Czech 'cs', etc. A podcast is Hungarian ONLY if the title/description is actually written in Hungarian (uses Hungarian words, accents, grammar). Marketing fluff in Hungarian inside an otherwise English show does NOT make it Hungarian.",
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
              confidence: { type: "number", description: "0..1 confidence" },
              reason: { type: "string", description: "One short sentence" },
            },
            required: ["lang", "confidence", "reason"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "set_language" } },
    }),
  });
  if (resp.status === 402) throw new Error("ai_credits_exhausted_402");
  if (resp.status === 429) { (detectLanguage as any)._429 = Date.now(); throw new Error("ai_rate_limit_429"); }
  if (!resp.ok) throw new Error(`ai_http_${resp.status}`);
  const j = await resp.json();
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
    const limit = Math.max(1, Math.min(500, Number(body?.limit) || 100));
    const dryRun = body?.dry_run === true;
    const minConf = Math.max(0.5, Math.min(0.99, Number(body?.min_confidence) || 0.7));
    const model = String(body?.model || DEFAULT_MODEL);
    const minRank = Math.max(0, Number(body?.min_rank) || 0);
    const CONCURRENCY = Math.max(1, Math.min(24, Number(body?.concurrency) || 16));
    const TIME_BUDGET_MS = 100_000;

    const { data: rows, error } = await supabase
      .from("discovery_queue")
      .select("id,title,description,language,candidate_rank,rank_reason")
      .eq("status", "pending")
      .gte("candidate_rank", minRank)
      .order("candidate_rank", { ascending: false })
      .limit(limit);
    if (error) throw error;

    let rejected_foreign = 0, kept_hu = 0, review = 0, errors = 0;
    const results: any[] = [];
    const queue = [...(rows || [])];

    const processOne = async (it: any) => {
      let det: { lang: string; confidence: number; reason: string } | null = null;
      let lastErr: any = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        try {
          det = await detectLanguage(model, it.title || "", it.description || "");
          break;
        } catch (e) {
          lastErr = e;
          const msg = String((e as Error)?.message || e);
          if (msg.includes("429")) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1) + Math.random() * 1500));
            continue;
          }
          break;
        }
      }
      if (!det) {
        errors++;
        results.push({ id: it.id, title: it.title, error: String((lastErr as Error)?.message || lastErr) });
        return;
      }
      try {
        const confident = det.confidence >= minConf;
        const isHu = det.lang === "hu";
        let action: string;
        const patch: Record<string, unknown> = {};

        const prevReason = (it.rank_reason && typeof it.rank_reason === "object") ? it.rank_reason : { legacy: it.rank_reason ?? null };
        const aiBlock = { ai_lang: det.lang, ai_conf: det.confidence, ai_reason: (det.reason || "").slice(0, 300), ai_model: model, ai_at: new Date().toISOString() };
        if (confident && !isHu && det.lang !== "unknown") {
          action = "reject_foreign";
          patch.status = "rejected";
          patch.rank_reason = { ...prevReason, ...aiBlock, ai_decision: "reject_foreign" };
          rejected_foreign++;
        } else if (confident && isHu) {
          action = "kept_hu";
          patch.rank_reason = { ...prevReason, ...aiBlock, ai_decision: "kept_hu" };
          kept_hu++;
        } else {
          action = "review";
          patch.rank_reason = { ...prevReason, ...aiBlock, ai_decision: "review_uncertain" };
          review++;
        }

        if (!dryRun) await supabase.from("discovery_queue").update(patch).eq("id", it.id);

        results.push({ id: it.id, title: it.title, rank: it.candidate_rank, ai_lang: det.lang, conf: det.confidence, action });
      } catch (e) {
        errors++;
        results.push({ id: it.id, title: it.title, error: String((e as Error)?.message || e) });
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

    return new Response(JSON.stringify({
      ok: true, dry_run: dryRun, model, min_confidence: minConf,
      scanned: (rows?.length || 0) - queue.length,
      remaining_in_batch: queue.length,
      rejected_foreign, kept_hu, review, errors,
      elapsed_ms: Date.now() - started,
      sample: results.slice(0, 20),
    }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
