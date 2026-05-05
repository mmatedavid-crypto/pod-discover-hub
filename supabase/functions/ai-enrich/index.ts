// Generates an AI summary + extracts entities for a podcast or episode.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-2.5-flash";

async function callAI(messages: any[], tools?: any[], tool_choice?: any) {
  const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, messages, tools, tool_choice }),
  });
  if (res.status === 429) throw new Error("Rate limit exceeded, try again later");
  if (res.status === 402) throw new Error("AI credits exhausted, add funds in Settings → Workspace → Usage");
  if (!res.ok) throw new Error(`AI gateway error ${res.status}`);
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { type, id } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (type === "podcast") {
      const { data: p } = await supabase.from("podcasts").select("*").eq("id", id).single();
      if (!p) throw new Error("podcast not found");
      const j = await callAI([
        { role: "system", content: "You write concise 2-sentence podcast summaries (max 280 chars). No marketing fluff." },
        { role: "user", content: `Podcast: ${p.title}\n\nDescription: ${p.description || "(none)"}\n\nWrite a clear neutral summary.` },
      ]);
      const summary = j.choices?.[0]?.message?.content?.trim() || "";
      await supabase.from("podcasts").update({ summary }).eq("id", id);
      return new Response(JSON.stringify({ ok: true, summary }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (type === "episode") {
      const { data: ep } = await supabase.from("episodes").select("*, podcasts(title)").eq("id", id).single();
      if (!ep) throw new Error("episode not found");
      const tools = [
        {
          type: "function",
          function: {
            name: "enrich_episode",
            description: "Summarize episode and extract entities.",
            parameters: {
              type: "object",
              properties: {
                summary: { type: "string", description: "2-sentence neutral summary, max 280 chars." },
                topics: { type: "array", items: { type: "string" }, description: "3-7 topical keywords" },
                people: { type: "array", items: { type: "string" } },
                companies: { type: "array", items: { type: "string" } },
                tickers: { type: "array", items: { type: "string" }, description: "Stock tickers like AAPL" },
                ingredients: { type: "array", items: { type: "string" }, description: "Only if cooking-related" },
              },
              required: ["summary", "topics", "people", "companies", "tickers", "ingredients"],
              additionalProperties: false,
            },
          },
        },
      ];
      const j = await callAI(
        [
          { role: "system", content: "You analyze podcast episode metadata and extract structured entities." },
          {
            role: "user",
            content: `Podcast: ${(ep as any).podcasts?.title}\nEpisode: ${ep.title}\n\nDescription: ${ep.description || "(none)"}`,
          },
        ],
        tools,
        { type: "function", function: { name: "enrich_episode" } },
      );
      const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      const parsed = args ? JSON.parse(args) : {};
      await supabase
        .from("episodes")
        .update({
          summary: parsed.summary || null,
          topics: parsed.topics || [],
          people: parsed.people || [],
          companies: parsed.companies || [],
          tickers: parsed.tickers || [],
          ingredients: parsed.ingredients || [],
        })
        .eq("id", id);
      return new Response(JSON.stringify({ ok: true, ...parsed }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    throw new Error("type must be 'podcast' or 'episode'");
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
