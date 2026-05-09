// Generates 6–8 trending search suggestion chips using Lovable AI Gateway,
// then stores them in app_settings.search_suggestions for the homepage to read.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FALLBACK = [
  "AI healthcare",
  "Warren Buffett",
  "testosterone sleep",
  "asparagus cooking",
  "Nvidia data centers",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) throw new Error("missing_lovable_api_key");

    // Pull a recent slice of context: trending titles + entities/topics seen recently.
    const { data: recentEps } = await admin
      .from("episodes")
      .select("title,topics,people,companies,tickers,published_at")
      .gte("published_at", new Date(Date.now() - 14 * 86400_000).toISOString())
      .order("published_at", { ascending: false })
      .limit(150);

    const titleSample = (recentEps || [])
      .map((e: any) => e.title)
      .filter(Boolean)
      .slice(0, 60)
      .join(" | ");

    const tally = new Map<string, number>();
    for (const e of recentEps || []) {
      for (const k of ["topics", "people", "companies", "tickers"] as const) {
        for (const v of (e[k] || []) as string[]) {
          if (!v) continue;
          tally.set(v, (tally.get(v) || 0) + 1);
        }
      }
    }
    const topEntities = [...tally.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50).map(([k]) => k).join(", ");

    const sys =
      "You curate the homepage search-chip strip for Podiverzum, a podcast episode search engine. " +
      "Return 7 short, intriguing English search queries that real users would type to discover new podcast episodes, " +
      "based on what's actually trending in the recent episode catalog. Mix: 2 named people/companies, " +
      "2 broad topics, 2 timely angles, 1 lifestyle/curiosity. Each chip MUST be 1–4 words, lowercase except proper nouns, " +
      "no quotes, no punctuation at the end. Avoid generic queries like 'news' or 'business'. Avoid duplicates.";

    const userPrompt =
      `RECENT EPISODE TITLES:\n${titleSample}\n\nTOP ENTITIES (last 14d):\n${topEntities}`;

    const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: sys },
          { role: "user", content: userPrompt },
        ],
        tools: [{
          type: "function",
          function: {
            name: "publish_chips",
            description: "Publish 7 search suggestion chips for the homepage.",
            parameters: {
              type: "object",
              properties: {
                chips: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      label: { type: "string", description: "Display text on the chip, 1–4 words." },
                      query: { type: "string", description: "Exact search query to run (often equal to label)." },
                    },
                    required: ["label", "query"],
                    additionalProperties: false,
                  },
                  minItems: 6,
                  maxItems: 8,
                },
              },
              required: ["chips"],
              additionalProperties: false,
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "publish_chips" } },
      }),
    });

    if (!resp.ok) {
      const txt = await resp.text();
      if (resp.status === 429) return json({ ok: false, error: "rate_limited" }, 429);
      if (resp.status === 402) return json({ ok: false, error: "payment_required" }, 402);
      throw new Error(`gateway_${resp.status}: ${txt.slice(0, 200)}`);
    }

    const j = await resp.json();
    const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    let chips: { label: string; query: string }[] = [];
    if (args) {
      try {
        const parsed = JSON.parse(args);
        chips = (parsed.chips || []).slice(0, 8).filter((c: any) => c?.label && c?.query);
      } catch { /* ignore */ }
    }
    if (!chips.length) chips = FALLBACK.map((q) => ({ label: q, query: q }));

    const value = { items: chips, generated_at: new Date().toISOString(), model: "google/gemini-2.5-flash" };
    await admin.from("app_settings").upsert({ key: "search_suggestions", value, updated_at: new Date().toISOString() });

    return json({ ok: true, count: chips.length, chips });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message) }, 500);
  }
});
