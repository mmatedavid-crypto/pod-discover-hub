// Re-checks language for peeked B/C podcasts using Gemini on title+description.
// If non-HU, sets language to detected code AND pi_backfill_completed_at=now()
// + pi_backfill_approved=false so they drop out of the backfill pipeline + HU homepage.
//
// POST { limit?: number, only_peeked?: boolean (default true), tier?: ('B'|'C'|'BC') }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MODEL = "google/gemini-3-flash-preview";

async function detectLanguage(title: string, description: string): Promise<{ lang: string; confidence: number; reason: string } | null> {
  const apiKey = Deno.env.get("LOVABLE_API_KEY");
  if (!apiKey) return null;
  const text = `Title: ${title}\n\nDescription: ${(description || "").slice(0, 2000)}`;
  const resp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: "You detect the primary spoken language of a podcast based on its title and description. Reply via the tool only." },
        { role: "user", content: text },
      ],
      tools: [{
        type: "function",
        function: {
          name: "set_language",
          description: "Set the detected ISO-639-1 language code",
          parameters: {
            type: "object",
            properties: {
              lang: { type: "string", description: "ISO-639-1 code, e.g. 'hu', 'en', 'de'. Use 'unknown' if unclear." },
              confidence: { type: "number", description: "0..1" },
              reason: { type: "string", description: "Short reason" },
            },
            required: ["lang", "confidence", "reason"],
            additionalProperties: false,
          },
        },
      }],
      tool_choice: { type: "function", function: { name: "set_language" } },
    }),
  });
  if (!resp.ok) return null;
  const j = await resp.json();
  const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
  if (!args) return null;
  try { return JSON.parse(args); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.max(1, Math.min(200, Number(body?.limit) || 50));
    const tier = (body?.tier || "BC") as "B" | "C" | "BC";
    const tiers = tier === "BC" ? ["B", "C"] : [tier];

    const { data: rows, error } = await supabase
      .from("podcasts")
      .select("id,title,description,language,rank_label,pi_backfill_dry_run")
      .ilike("language", "hu%")
      .in("rank_label", tiers)
      .not("pi_backfill_peeked_at", "is", null)
      .is("pi_backfill_completed_at", null)
      .limit(500);
    if (error) throw error;
    // Skip already-rechecked (marker in pi_backfill_dry_run.lang_recheck)
    const pending = (rows || []).filter((r: any) => !r?.pi_backfill_dry_run?.lang_recheck).slice(0, limit);

    const results: any[] = [];
    let changed = 0, kept = 0, errors = 0;
    for (const p of rows || []) {
      const det = await detectLanguage(p.title, p.description || "");
      if (!det) { errors++; results.push({ id: p.id, title: p.title, ok: false }); continue; }
      const isHu = det.lang === "hu" && det.confidence >= 0.6;
      if (isHu) {
        kept++;
        results.push({ id: p.id, title: p.title, lang: det.lang, conf: det.confidence, kept: true });
      } else {
        changed++;
        await supabase.from("podcasts").update({
          language: det.lang === "unknown" ? null : det.lang,
          pi_backfill_completed_at: new Date().toISOString(),
          pi_backfill_approved: false,
          pi_backfill_error: `lang_recheck: ${det.lang} (${det.confidence}) ${det.reason}`.slice(0, 500),
        }).eq("id", p.id);
        results.push({ id: p.id, title: p.title, was: "hu", now: det.lang, conf: det.confidence, reason: det.reason });
      }
    }

    return new Response(JSON.stringify({ ok: true, processed: rows?.length || 0, changed, kept, errors, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
