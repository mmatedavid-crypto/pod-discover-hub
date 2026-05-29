// AI summary + entity extraction with daily cap & enable flag from app_settings.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callLovableAI } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_MODEL = "google/gemini-2.5-flash-lite";

async function loadControls(supabase: any) {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "ai_controls").maybeSingle();
  const v = data?.value || {};
  return {
    enabled: v.enabled !== false,
    maxPerDay: typeof v.max_per_day === "number" ? v.max_per_day : 100,
    maxPerClick: typeof v.max_per_podcast_per_click === "number" ? v.max_per_podcast_per_click : 15,
    model: typeof v.model === "string" && v.model.trim() ? v.model.trim() : DEFAULT_MODEL,
    minInputChars: typeof v.min_input_chars === "number" ? v.min_input_chars : 80,
  };
}

async function summariesToday(supabase: any) {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const { count } = await supabase
    .from("episodes").select("*", { count: "exact", head: true })
    .not("summary", "is", null).gte("updated_at", start.toISOString());
  return count || 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { type, id } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const ctrl = await loadControls(supabase);
    if (!ctrl.enabled) throw new Error("AI enrichment is disabled in admin settings");
    const used = await summariesToday(supabase);
    if (used >= ctrl.maxPerDay) {
      throw new Error(`Daily AI cap reached (${used}/${ctrl.maxPerDay}). Adjust in admin settings.`);
    }

    if (type === "podcast") {
      const { data: p } = await supabase.from("podcasts").select("*").eq("id", id).single();
      if (!p) throw new Error("podcast not found");
      const langCode = (p.language || "").toLowerCase().split(/[-_]/)[0] || "en";
      const langName = langCode === "hu" ? "Hungarian (magyar)" : langCode === "en" ? "English" : langCode;
      const inputText = `${p.title || ""}\n${p.description || ""}`;
      const ai = await callLovableAI({
        model: ctrl.model,
        job_type: "ai_enrich_podcast_summary",
        target_type: "podcast",
        target_id: id,
        prompt_version: "ai-enrich-v2",
        input_text: inputText,
        min_input_chars: ctrl.minInputChars,
        messages: [
        { role: "system", content: `You write concise 2-sentence podcast summaries (max 280 chars). No marketing fluff. Write the summary in ${langName} (${langCode}) — match the source language; never translate.` },
        { role: "user", content: `Podcast: ${p.title}\n\nDescription: ${p.description || "(none)"}\n\nWrite a clear neutral summary in ${langName}.` },
        ],
      });
      if (!ai.ok) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: ai.error || "ai_skipped" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const summary = ai.data?.choices?.[0]?.message?.content?.trim() || "";
      if (!summary) return new Response(JSON.stringify({ ok: true, skipped: true, reason: "empty_summary" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      await supabase.from("podcasts").update({ summary }).eq("id", id);
      return new Response(JSON.stringify({ ok: true, summary }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (type === "episode") {
      const { data: ep } = await supabase.from("episodes").select("*, podcasts(title,language)").eq("id", id).single();
      if (!ep) throw new Error("episode not found");
      const langRaw = ((ep as any).podcasts?.language) || "en";
      const langCode = String(langRaw).toLowerCase().split(/[-_]/)[0] || "en";
      const langName = langCode === "hu" ? "Hungarian (magyar)" : langCode === "en" ? "English" : langCode;
      const tools = [{
        type: "function",
        function: {
          name: "enrich_episode",
          description: "Summarize episode and extract entities.",
          parameters: {
            type: "object",
            properties: {
              summary: { type: "string", description: `2-sentence neutral summary in ${langName}, max 280 chars.` },
              topics: { type: "array", items: { type: "string" } },
              people: { type: "array", items: { type: "string" } },
              companies: { type: "array", items: { type: "string" } },
              tickers: { type: "array", items: { type: "string" } },
              ingredients: { type: "array", items: { type: "string" } },
            },
            required: ["summary", "topics", "people", "companies", "tickers", "ingredients"],
            additionalProperties: false,
          },
        },
      }];
      const inputText = `${ep.title || ""}\n${ep.description || ""}`;
      const ai = await callLovableAI({
        model: ctrl.model,
        job_type: "ai_enrich_episode",
        target_type: "episode",
        target_id: id,
        prompt_version: "ai-enrich-v2",
        input_text: inputText,
        min_input_chars: ctrl.minInputChars,
        messages: [
          { role: "system", content: `You analyze podcast episode metadata and extract structured entities. Write the summary field in ${langName} (${langCode}) — match the source language; never translate. Entity names (people, companies, tickers) stay in their original form.` },
          { role: "user", content: `Podcast: ${(ep as any).podcasts?.title}\nEpisode: ${ep.title}\n\nDescription: ${ep.description || "(none)"}` },
        ],
        tools,
        tool_choice: { type: "function", function: { name: "enrich_episode" } },
      });
      if (!ai.ok) {
        return new Response(JSON.stringify({ ok: true, skipped: true, reason: ai.error || "ai_skipped" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const args = ai.data?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      const parsed = args ? JSON.parse(args) : {};
      await supabase.from("episodes").update({
        summary: parsed.summary || null,
        topics: parsed.topics || [],
        people: parsed.people || [],
        companies: parsed.companies || [],
        tickers: parsed.tickers || [],
        ingredients: parsed.ingredients || [],
      }).eq("id", id);
      // Stamp last AI run
      await supabase.from("app_settings").upsert({
        key: "ai_last_run", value: { at: new Date().toISOString() }, updated_at: new Date().toISOString(),
      });
      return new Response(JSON.stringify({ ok: true, ...parsed }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    throw new Error("type must be 'podcast' or 'episode'");
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
