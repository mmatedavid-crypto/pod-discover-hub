// Topic page enricher — grounded Hungarian intro + FAQ for every public topic.
// Input is STRICTLY the topic's indexed episodes (titles, summaries, shows).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callLovableAI } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = "google/gemini-2.5-flash";
const PROMPT_VERSION = "topic-page-faq-v1";

const SYSTEM = `Egy magyar podcast-katalógus (Podiverzum) szerkesztője vagy. Egy témaoldalhoz írsz bevezetőt és gyakori kérdéseket.

SZABÁLYOK:
- A műsorokról és epizódokról KIZÁRÓLAG a megadott adatok alapján írj. Ne találj ki műsort, epizódot, vendéget, számot.
- A téma általános, közismert magyarázatához (1-2 mondat: mi ez a téma) használhatsz általános tudást, de vitatott, politikai vagy egészségügyi állítást ne tegyél.
- Magyarul, tárgyilagosan, felsőfok és marketingszöveg nélkül.
- "intro": 2 bekezdés (\\n\\n-nel elválasztva), összesen 450-900 karakter. 1. bekezdés: miről szól a téma és milyen kérdések kerülnek elő a magyar podcastokban. 2. bekezdés: mely műsorok foglalkoznak vele rendszeresen (konkrét műsornevekkel az adatokból) és milyen típusú beszélgetések várhatók.
- "faqs": 4-6 kérdés-válasz. Olyan kérdések, amiket valaki a Google-be beírna (pl. "Melyik a legjobb magyar ... podcast?", "Milyen magyar podcastok szólnak ...-ról?", "Hol kezdjem a ... podcastokat?", egy tartalmi kérdés a téma leggyakoribb altémájáról). A válasz 1-3 mondat, konkrét műsor- vagy epizódcímmel az adatokból.
- Csak JSON-t adj vissza: {"intro":"...","faqs":[{"q":"...","a":"..."}]}`;

function parseJson(text: string): any | null {
  const cleaned = String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const s = cleaned.indexOf("{"), e = cleaned.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try { return JSON.parse(cleaned.slice(s, e + 1)); } catch { return null; }
}
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[ \t]+/g, " ").trim().slice(0, max);
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY) as any;
  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }
  const limit = Math.min(Math.max(Number(body.limit ?? 10), 1), 30);
  const force = body.force === true;
  const dryRun = body.dry_run === true;
  const onlySlug = typeof body.slug === "string" ? body.slug : null;

  let q = supabase.from("topics")
    .select("id, name, slug, description, episode_count, podcast_count, content_generated_at")
    .eq("is_public", true)
    .order("episode_count", { ascending: false, nullsFirst: false });
  if (onlySlug) q = q.eq("slug", onlySlug);
  else if (!force) q = q.is("content_generated_at", null);
  const { data: topics, error } = await q.limit(limit);
  if (error) return json({ ok: false, error: error.message }, 500);

  const results: any[] = [];
  await Promise.all((topics ?? []).map(async (topic: any) => {
    try {
      const { data: rows } = await supabase.from("episode_topic_map")
        .select("episodes!inner(title, display_title, published_at, ai_summary, podcast:podcasts!inner(title, display_title, language_decision))")
        .eq("topic_id", topic.id)
        .order("confidence", { ascending: false })
        .limit(150);
      const eps = ((rows ?? []) as any[]).map((r) => r.episodes)
        .filter((e) => e && e.podcast?.language_decision === "accept_hungarian");
      const markDone = async () => {
        if (!dryRun) await supabase.from("topics").update({ content_generated_at: new Date().toISOString() }).eq("id", topic.id);
      };
      if (eps.length < 3) { await markDone(); results.push({ slug: topic.slug, skipped: "too_few_episodes" }); return; }

      const showCounts = new Map<string, number>();
      for (const e of eps) {
        const n = e.podcast.display_title || e.podcast.title;
        if (n) showCounts.set(n, (showCounts.get(n) || 0) + 1);
      }
      const shows = [...showCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
      // Diverse sample: max 3 per show, 30 total.
      const per = new Map<string, number>();
      const sample = eps.filter((e) => {
        const n = e.podcast.display_title || e.podcast.title;
        const c = per.get(n) || 0; if (c >= 3) return false; per.set(n, c + 1); return true;
      }).slice(0, 30);
      const epLines = sample.map((e, i) =>
        `${i + 1}. [${String(e.published_at || "").slice(0, 10)}] "${clean(e.display_title || e.title, 150)}" — ${clean(e.podcast.display_title || e.podcast.title, 80)}${e.ai_summary ? ` — ${clean(e.ai_summary, 260)}` : ""}`,
      ).join("\n");
      const user = `Téma: ${topic.name}${topic.description ? `\nLeírás: ${clean(topic.description, 300)}` : ""}
Epizódok a katalógusban: ${topic.episode_count ?? eps.length}, műsorok: ${topic.podcast_count ?? shows.length}
Leggyakoribb műsorok (epizódszám): ${shows.map(([n, c]) => `${n} (${c})`).join(", ")}

Minta epizódok:
${epLines}`;

      const ai = await callLovableAI({
        model: MODEL, job_type: "topic_page_enricher", target_type: "topic", target_id: topic.id,
        prompt_version: PROMPT_VERSION, input_text: user, min_input_chars: 200,
        messages: [{ role: "system", content: SYSTEM }, { role: "user", content: user }],
        temperature: 0.3,
      });
      if (!ai.ok) { results.push({ slug: topic.slug, error: ai.error || `ai_${ai.status}` }); return; }
      const parsed = parseJson(ai.data?.choices?.[0]?.message?.content || "");
      const intro = String(parsed?.intro ?? "").split(/\n{2,}/).map((p) => clean(p, 700)).filter(Boolean).slice(0, 3).join("\n\n");
      const faqs = Array.isArray(parsed?.faqs)
        ? parsed.faqs.map((f: any) => ({ q: clean(f?.q, 180), a: clean(f?.a, 700) }))
            .filter((f: any) => f.q.length > 8 && f.a.length > 20).slice(0, 6)
        : [];
      if (intro.length < 250 || faqs.length < 3) {
        results.push({ slug: topic.slug, error: "unusable_ai_output", intro_len: intro.length, faqs: faqs.length }); return;
      }
      if (dryRun) { results.push({ slug: topic.slug, dry_run: true, intro, faqs }); return; }
      const { error: upErr } = await supabase.from("topics")
        .update({ intro_long_hu: intro, faqs, content_generated_at: new Date().toISOString() })
        .eq("id", topic.id);
      results.push(upErr ? { slug: topic.slug, error: upErr.message } : { slug: topic.slug, ok: true, faqs: faqs.length });
    } catch (e) {
      results.push({ slug: topic.slug, error: String((e as Error)?.message || e) });
    }
  }));

  return json({ ok: true, processed: results.length, succeeded: results.filter((r) => r.ok).length, results });
});
