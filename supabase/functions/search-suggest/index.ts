// search-suggest: typeahead completions for the search box.
// POST { prefix: string } -> { suggestions: string[] }
// Strategy: cache lookup (24h) -> AI completion (gemini-2.5-flash-lite) seeded by prefix-matched episode titles.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

function normalize(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
}

async function aiSuggest(prefix: string, seedTitles: string[]): Promise<string[]> {
  if (!LOVABLE_API_KEY) return [];
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3500);
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You suggest podcast search completions. Return short, natural search queries (2-5 words). No punctuation, lowercase." },
          { role: "user", content: `Prefix: "${prefix}"\nExisting episode titles for inspiration:\n${seedTitles.slice(0, 12).join("\n")}\nReturn 5 distinct, natural search queries that complete or extend the prefix.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "suggest",
            parameters: {
              type: "object", additionalProperties: false,
              properties: { suggestions: { type: "array", items: { type: "string" }, maxItems: 5 } },
              required: ["suggestions"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "suggest" } },
      }),
    });
    clearTimeout(t);
    if (!r.ok) return [];
    const j = await r.json();
    const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return [];
    const p = typeof args === "string" ? JSON.parse(args) : args;
    return Array.isArray(p?.suggestions) ? p.suggestions.map((s: string) => String(s).toLowerCase().slice(0, 60)).filter(Boolean) : [];
  } catch (e) {
    clearTimeout(t);
    console.warn("aiSuggest err", e);
    return [];
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const prefix = normalize(String(body.prefix || ""));
    if (prefix.length < 2) {
      return new Response(JSON.stringify({ suggestions: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    // Cache (24h)
    try {
      const { data: cached } = await supa.from("search_suggest_cache").select("suggestions, updated_at").eq("prefix", prefix).maybeSingle();
      if (cached && cached.updated_at && Date.now() - new Date(cached.updated_at).getTime() < 24 * 3600 * 1000) {
        return new Response(JSON.stringify({ suggestions: cached.suggestions, cached: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } catch (e) { console.warn("cache read", e); }

    // Seed with up to 12 episode titles whose search_text contains the prefix.
    const { data: rows } = await supa
      .from("episodes")
      .select("title, podcasts!inner(language)")
      .ilike("search_text", `%${prefix}%`)
      .or("language.ilike.hu%", { foreignTable: "podcasts" })
      .limit(12);
    const seed = (rows || []).map((r: any) => String(r.title || "").slice(0, 100)).filter(Boolean);

    const suggestions = await aiSuggest(prefix, seed);
    const dedup = Array.from(new Set(suggestions)).slice(0, 5);

    // Persist (fire and forget) — only cache non-empty results.
    if (dedup.length > 0) {
      supa.from("search_suggest_cache").upsert({
        prefix, suggestions: dedup, updated_at: new Date().toISOString(),
      }).then(() => {}, (e) => console.warn("cache write", e));
    }

    return new Response(JSON.stringify({ suggestions: dedup, cached: false }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("search-suggest err", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
