// Auto-seeds mood_collections.podcast_ids by embedding each mood's seed_query
// and finding the top S/A podcasts via cosine similarity.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMBED_MODEL = "google/gemini-embedding-001";

// Default seeds per mood slug — used if seed_query is null on the row.
const DEFAULT_SEEDS: Record<string, string> = {
  "morning-inspiration":
    "Energizing motivational morning podcasts about positive mindset, daily habits, productivity, gratitude, optimism and starting the day with intention.",
  "deep-focus":
    "Calm, thoughtful long-form podcasts ideal for deep work and concentration: technology, science, programming, business strategy, slow conversation, no high-energy ads.",
  "wind-down":
    "Relaxing evening podcasts: meditation, sleep stories, mindfulness, calm storytelling, soothing voices, philosophy, gentle reflection before bed.",
  "learn-something-new":
    "Curious educational podcasts that explain ideas: history, science, psychology, economics, big ideas, popular intellectual interviews, learning every episode.",
  "news-now":
    "Daily news and current affairs podcasts: world news, politics, business news, breaking stories, daily briefings, journalism.",
};

async function embed(text: string): Promise<number[]> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("missing_gemini_api_key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text }] },
      taskType: "SEMANTIC_SIMILARITY",
      outputDimensionality: 768,
    }),
  });
  if (!res.ok) throw new Error(`gemini_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const vec = j.embedding?.values as number[] | undefined;
  if (!vec || vec.length !== 768) throw new Error("bad_embedding");
  return vec;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(20, Math.max(3, Number(body.limit ?? 8)));
    const onlySlug: string | undefined = body.slug;
    const dryRun = body.dryRun === true;

    let q = admin.from("mood_collections").select("id, slug, mood, title, description, seed_query, podcast_ids").eq("active", true);
    if (onlySlug) q = q.eq("slug", onlySlug);
    const { data: moods, error } = await q;
    if (error) throw error;

    const results: any[] = [];
    for (const m of moods ?? []) {
      const seed =
        (m.seed_query && m.seed_query.trim()) ||
        DEFAULT_SEEDS[m.slug] ||
        `${m.title}. ${m.mood}. ${m.description ?? ""}`.trim();

      let vec: number[];
      try {
        vec = await embed(seed);
      } catch (e) {
        results.push({ slug: m.slug, ok: false, error: String((e as Error).message) });
        continue;
      }

      // Cast to vector via rpc
      const { data: matches, error: mErr } = await admin.rpc("match_podcasts_by_embedding", {
        p_embedding: vec as unknown as string,
        p_limit: limit,
        p_lang: "en",
        p_model: EMBED_MODEL,
      });
      if (mErr) {
        results.push({ slug: m.slug, ok: false, error: mErr.message });
        continue;
      }

      const ids = (matches ?? []).map((r: any) => r.id);
      const top = (matches ?? []).slice(0, 5).map((r: any) => ({
        title: r.display_title ?? r.title,
        slug: r.slug,
        sim: Number(r.similarity?.toFixed?.(3) ?? r.similarity),
        tier: r.shadow_rank_tier,
      }));

      if (!dryRun && ids.length) {
        const { error: upErr } = await admin
          .from("mood_collections")
          .update({
            podcast_ids: ids,
            seed_query: m.seed_query || seed,
            updated_at: new Date().toISOString(),
          })
          .eq("id", m.id);
        if (upErr) {
          results.push({ slug: m.slug, ok: false, error: upErr.message });
          continue;
        }
      }

      results.push({ slug: m.slug, ok: true, count: ids.length, top });
    }

    return json({ ok: true, dryRun, results });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message) }, 500);
  }
});
