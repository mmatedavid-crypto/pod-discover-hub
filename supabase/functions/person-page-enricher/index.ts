// Person page enricher — grounded Hungarian page summary + FAQ (Q&A) for the
// most-mentioned people. Input is STRICTLY the person's indexed episode data:
// no outside knowledge, no speculation. Output feeds the person page and the
// prerender FAQPage structured data.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { callLovableAI } from "../_shared/lovable-ai.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const MODEL = "google/gemini-2.5-flash-lite";
const PROMPT_VERSION = "person-page-faq-v1";

const SYSTEM = `Magyar podcast-katalógus szerkesztője vagy. A feladat: egy személy oldalához rövid összefoglaló és gyakori kérdések (FAQ) írása.

SZIGORÚ SZABÁLYOK:
- KIZÁRÓLAG a megadott epizódadatokat (címek, összefoglalók, műsorok, témák, dátumok) használhatod. Külső tudást, feltételezést, becslést NEM.
- Semmilyen magánéleti, egészségügyi, vagyoni vagy politikai állítást ne írj, ha az nem szerepel szó szerint az adatokban.
- Ha valamit nem tudsz az adatokból, azt a kérdést hagyd ki.
- Magyar nyelven írj, tárgyilagosan, marketingszöveg és felsőfok nélkül.
- Az összefoglaló 2-3 mondat, max 480 karakter, azt írja le, milyen podcastokban és milyen témák kapcsán szerepel a személy.
- 3-6 kérdés-válasz pár. A kérdések olyanok legyenek, amiket egy kereső felhasználó valóban beírna (pl. "Milyen podcastokban hallható X?", "Miről beszélt X a legutóbbi epizódban?"). A válasz 1-3 mondat, konkrét műsor- vagy epizódcímekkel.
- Csak JSON-t adj vissza, magyarázat nélkül:
{"summary":"...","faqs":[{"q":"...","a":"..."}]}`;

function parseJson(text: string): any | null {
  const cleaned = String(text || "").replace(/^```(?:json)?/i, "").replace(/```$/,"").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
}

const clean = (v: unknown, max: number) =>
  String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const limit = Math.min(Math.max(Number(body.limit ?? 5), 1), 25);
  const force = body.force === true;
  const dryRun = body.dry_run === true;
  const onlySlug = typeof body.slug === "string" ? body.slug : null;

  // Candidate people: highest mention volume first, skip ones already enriched.
  let q = (supabase as any)
    .from("people")
    .select("id, name, slug, mention_count, episode_count, page_summary_hu, page_summary_generated_at")
    .eq("is_public", true)
    .eq("is_indexable", true)
    .order("mention_count", { ascending: false, nullsFirst: false })
    .limit(onlySlug ? 1 : limit * 30);
  if (onlySlug) q = q.eq("slug", onlySlug);
  const { data: candidates, error: candErr } = await q;
  if (candErr) {
    return new Response(JSON.stringify({ ok: false, error: candErr.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const pool = (candidates ?? []).filter((p: any) =>
    force || onlySlug || !p.page_summary_generated_at
  ).slice(0, limit);

  const results: any[] = [];

  for (const person of pool as any[]) {
    try {
      const { data: mentions } = await (supabase as any)
        .from("person_episode_mentions")
        .select("role_type, episodes!inner(id, title, display_title, published_at, ai_summary, podcast:podcasts!inner(title, display_title, language_decision))")
        .eq("person_id", person.id)
        .limit(200);

      const eps = ((mentions ?? []) as any[])
        .map((m) => ({ ...m.episodes, role_type: m.role_type }))
        .filter((e) => e && e.podcast?.language_decision === "accept_hungarian")
        .sort((a, b) => String(b.published_at || "").localeCompare(String(a.published_at || "")))
        .slice(0, 25);

      if (eps.length < 2) {
        results.push({ slug: person.slug, skipped: "too_few_episodes" });
        continue;
      }

      const showCounts = new Map<string, number>();
      for (const e of eps) {
        const n = e.podcast.display_title || e.podcast.title;
        if (n) showCounts.set(n, (showCounts.get(n) || 0) + 1);
      }
      const shows = [...showCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

      const roleCounts = eps.reduce((acc: Record<string, number>, e: any) => {
        const k = e.role_type || "mention";
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {});

      const epLines = eps.map((e: any, i: number) => {
        const date = e.published_at ? String(e.published_at).slice(0, 10) : "";
        const sum = clean(e.ai_summary, 320);
        return `${i + 1}. [${date}] "${clean(e.display_title || e.title, 160)}" — műsor: ${clean(e.podcast.display_title || e.podcast.title, 90)}${sum ? ` — összefoglaló: ${sum}` : ""}`;
      }).join("\n");

      const user = `Személy: ${person.name}
Összes indexelt epizód (katalógus): ${person.episode_count ?? eps.length}
Szerepek az alábbi epizódokban: ${JSON.stringify(roleCounts)}
Műsorok (epizódszámmal): ${shows.map(([n, c]) => `${n} (${c})`).join(", ")}

Epizódok:
${epLines}`;

      const ai = await callLovableAI({
        model: MODEL,
        job_type: "person_page_enricher",
        target_type: "person",
        target_id: person.id,
        prompt_version: PROMPT_VERSION,
        input_text: user,
        min_input_chars: 200,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: user },
        ],
        temperature: 0.2,
      });

      // Mark non-retryable cases so the batch pool moves on instead of
      // re-picking the same person forever.
      const markSkipped = async () => {
        if (dryRun) return;
        await (supabase as any)
          .from("people")
          .update({ page_summary_generated_at: new Date().toISOString() })
          .eq("id", person.id);
      };

      if (!ai.ok) {
        const permanent = /placeholder|too_short|min_input|policy/i.test(String(ai.error || ""));
        if (permanent) await markSkipped();
        results.push({ slug: person.slug, error: ai.error || `ai_${ai.status}` });
        continue;
      }

      const text = ai.data?.choices?.[0]?.message?.content || "";
      const parsed = parseJson(text);
      const summary = clean(parsed?.summary, 480);
      const faqs = Array.isArray(parsed?.faqs)
        ? parsed.faqs
            .map((f: any) => ({ q: clean(f?.q ?? f?.question, 160), a: clean(f?.a ?? f?.answer, 700) }))
            .filter((f: any) => f.q.length > 8 && f.a.length > 20)
            .slice(0, 6)
        : [];

      if (!summary || faqs.length < 2) {
        await markSkipped();
        results.push({ slug: person.slug, error: "unusable_ai_output", summary_len: summary.length, faqs: faqs.length });
        continue;
      }


      if (dryRun) {
        results.push({ slug: person.slug, dry_run: true, summary, faqs });
        continue;
      }

      const { error: upErr } = await (supabase as any)
        .from("people")
        .update({ page_summary_hu: summary, page_summary_generated_at: new Date().toISOString() })
        .eq("id", person.id);
      if (upErr) {
        results.push({ slug: person.slug, error: `person_update:${upErr.message}` });
        continue;
      }

      await (supabase as any).from("person_faqs").delete().eq("person_id", person.id);
      const { error: faqErr } = await (supabase as any).from("person_faqs").insert(
        faqs.map((f: any, i: number) => ({
          person_id: person.id,
          position: i,
          question: f.q,
          answer: f.a,
          model: MODEL,
        })),
      );
      if (faqErr) {
        results.push({ slug: person.slug, error: `faq_insert:${faqErr.message}` });
        continue;
      }

      results.push({ slug: person.slug, ok: true, faqs: faqs.length, episodes: eps.length });
    } catch (e) {
      results.push({ slug: person.slug, error: String((e as Error)?.message || e) });
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    processed: results.length,
    succeeded: results.filter((r) => r.ok).length,
    results,
  }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
