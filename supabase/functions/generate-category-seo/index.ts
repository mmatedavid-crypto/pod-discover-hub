// Generates per-category SEO title + description using Lovable AI Gateway.
// Stores results into public.categories.seo_title / seo_description.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callLovableAI } from "../_shared/lovable-ai.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const body = await req.json().catch(() => ({}));
    const force = body.force === true;
    const onlySlug: string | undefined = body.slug;

    let q = admin.from("categories").select("id,slug,name,description,seo_title,seo_description");
    if (onlySlug) q = q.eq("slug", onlySlug);
    const { data: cats, error } = await q;
    if (error) throw error;

    const results: any[] = [];
    for (const c of cats || []) {
      if (!force && c.seo_title && c.seo_description) {
        results.push({ slug: c.slug, ok: true, skipped: true });
        continue;
      }

      // Pull ~12 representative podcast titles from this category to ground the model.
      const { data: pods } = await admin
        .from("podcasts")
        .select("title,display_title,summary,seo_description")
        .eq("category", c.name)
        .in("shadow_rank_tier", ["S", "A"])
        .order("podiverzum_rank", { ascending: false })
        .limit(12);

      const grounding = (pods || [])
        .map((p: any) => `- ${p.display_title || p.title}: ${(p.seo_description || p.summary || "").slice(0, 140)}`)
        .join("\n");

      const sys =
        "You write SEO meta tags for category landing pages on Podiverzum, a podcast episode search engine. " +
        "Return one title (max 60 chars, must include the category name and a hook word like 'best', 'top', 'latest' or 'episodes') " +
        "and one description (max 155 chars, plain English, mention what kind of podcasts and episodes the user will find here). " +
        "No quotes, no emoji, no trailing period required, never use the word 'curated'.";

      const userPrompt =
        `CATEGORY: ${c.name}\nSLUG: ${c.slug}\nEXISTING DESCRIPTION: ${c.description || "(none)"}\n\nTOP PODCASTS IN THIS CATEGORY:\n${grounding || "(no examples available)"}`;

      const ai = await callLovableAI({
        model: "google/gemini-2.5-flash-lite",
        job_type: "generate_category_seo",
        target_type: "category",
        target_id: c.id,
        prompt_version: "category-seo-v2",
        input_text: userPrompt,
        min_input_chars: 60,
        messages: [
            { role: "system", content: sys },
            { role: "user", content: userPrompt },
        ],
        tools: [{
            type: "function",
            function: {
              name: "publish_seo",
              description: "Publish SEO title and description for a category landing page.",
              parameters: {
                type: "object",
                properties: {
                  title: { type: "string", description: "SEO title, max 60 chars" },
                  description: { type: "string", description: "Meta description, max 155 chars" },
                },
                required: ["title", "description"],
                additionalProperties: false,
              },
            },
        }],
        tool_choice: { type: "function", function: { name: "publish_seo" } },
      });

      if (!ai.ok) {
        results.push({ slug: c.slug, ok: false, error: ai.error || `gateway_${ai.status}` });
        if (ai.status === 429 || ai.status === 402) break;
        continue;
      }

      const j = ai.data;
      const args = j.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
      if (!args) { results.push({ slug: c.slug, ok: false, error: "no_tool_call" }); continue; }
      let parsed: { title: string; description: string };
      try { parsed = JSON.parse(args); } catch { results.push({ slug: c.slug, ok: false, error: "bad_json" }); continue; }

      const title = String(parsed.title || "").slice(0, 60).trim();
      const description = String(parsed.description || "").slice(0, 160).trim();
      if (!title || !description) { results.push({ slug: c.slug, ok: false, error: "empty_fields" }); continue; }

      const { error: upErr } = await admin.from("categories").update({
        seo_title: title,
        seo_description: description,
        seo_updated_at: new Date().toISOString(),
      }).eq("id", c.id);
      if (upErr) { results.push({ slug: c.slug, ok: false, error: upErr.message }); continue; }

      results.push({ slug: c.slug, ok: true, title, description });
      await new Promise((r) => setTimeout(r, 250)); // gentle pacing
    }

    return json({ ok: true, results });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message) }, 500);
  }
});
