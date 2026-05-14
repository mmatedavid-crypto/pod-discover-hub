// search-answer: streams a 2-3 sentence AI summary of the top episodes for a query.
// POST { q: string, episodes: [{title,podcast,summary}] }  -> SSE stream
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const q = String(body.q || "").trim();
    const episodes = Array.isArray(body.episodes) ? body.episodes.slice(0, 6) : [];
    if (!q || episodes.length === 0 || !LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "missing input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const compact = episodes.map((e: any, i: number) => ({
      i: i + 1,
      title: String(e.title || "").slice(0, 140),
      podcast: String(e.podcast || "").slice(0, 60),
      summary: String(e.summary || "").slice(0, 260),
    }));
    const sys = "You are a podcast research assistant. Given a user query and the top podcast episode results, write a clear, factual 2-3 sentence overview answering the query, citing episodes inline like [1], [2]. Never invent facts beyond the snippets. Use US English, no hashtags, no emojis.";
    const user = `Query: ${q}\n\nTop episodes:\n${compact.map((c) => `[${c.i}] ${c.title} — ${c.podcast}\n  ${c.summary}`).join("\n")}\n\nWrite the overview now.`;

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [{ role: "system", content: sys }, { role: "user", content: user }],
        stream: true,
      }),
    });

    if (!upstream.ok) {
      const code = upstream.status;
      const msg = code === 429 ? "Rate limited, please try again later." : code === 402 ? "AI credits exhausted." : "AI gateway error";
      return new Response(JSON.stringify({ error: msg }), { status: code === 429 || code === 402 ? code : 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(upstream.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("search-answer err", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
