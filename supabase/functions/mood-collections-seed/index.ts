// Auto-seeds mood_collections.podcast_ids by embedding each mood's seed_query
// and finding the top S/A podcasts via cosine similarity.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const EMBED_MODEL = "google/gemini-embedding-001";

// Default seeds per mood slug — used if seed_query is null on the row.
// HU mood collections: magyar nyelvű seed promptok a magyar podcast korpuszhoz.
const DEFAULT_SEEDS: Record<string, string> = {
  "elalvashoz":
    "Nyugodt, lassú beszélgetésű magyar podcastok elalváshoz és kikapcsolódáshoz. Meditáció, mindfulness, relaxáció, halk hangú mesélés, alvássegítő történetek, lélektani témák, csendes esti reflexió. Nem hírműsor, nem politika, nem humor.",
  "munkaba-menet": 
    "Rövidebb, könnyen fogyasztható magyar podcastok reggeli ingázáshoz, munkába menet. Napindító összefoglalók, friss hírek tömören, motivációs és produktivitási tippek, kávé melletti hallgatnivaló. Tempós, de nem hangos.",
  "reggeli-radio":
    "Klasszikus reggeli rádiós műsorok és napindító magyar podcastok: élő hangulat, vendégek, könnyed beszélgetés, zenei betétek, aktuális hírek, humoros betelefonálók. Balázsék, Bochkor, kereskedelmi reggeli rádiók stílusa.",
  "edzeshez":
    "Energikus, pörgős magyar podcastok edzéshez, futáshoz, kondizáshoz. Sport, fitness, motiváció, teljesítmény, mentális erő, sportolói interjúk, lendületes beszélgetések. Magas energia, gyors tempó.",
  "hosszu-utra":
    "Hosszabb, mélyebb magyar podcast beszélgetések autós utazáshoz, hosszú útra. Másfél-három órás interjúk, sztorizós formátumok, dokumentarista riportok, igazi mélyfúrások egy témába vagy egy emberbe.",
  "vilag-esemenyei":
    "Magyar podcastok a világ aktuális eseményeiről: politika, gazdaság, geopolitika, háború, választások, nemzetközi hírek, elemzések, háttér-beszélgetések újságírókkal és szakértőkkel.",
  "mosolyogashoz":
    "Könnyed, szórakoztató, humoros magyar podcastok: stand-up, vicces beszélgetések, popkultúra, abszurd sztorik, baráti társalgási formátumok, nevettetős tartalom. Nem komoly, nem nyomasztó.",
  "tanulashoz":
    "Ismeretterjesztő, oktatási magyar podcastok: tudomány, történelem, pszichológia, mesterséges intelligencia, technológia, közgazdaságtan, érdekes új ismeretek minden epizódban. Tanulhatsz belőle.",
  "elmelyuleshez":
    "Lassabb tempójú, gondolkodós magyar podcastok: filozófia, pszichológia, önismeret, spiritualitás, életvezetés, mély beszélgetések az élet nagy kérdéseiről. Reflektív, nem felszínes.",
  "uzleti-inspiracio":
    "Magyar podcastok vállalkozásról, cégépítésről, startupokról, vezetésről, marketingről, growth-ról, sales-ről, csapatépítésről. Vállalkozói interjúk, alapítói történetek, gyakorlati üzleti tanulságok.",
  "penzugyi-gondolkodas":
    "Magyar podcastok pénzügyekről, befektetésekről, tőzsdéről, részvényekről, makrogazdaságról, inflációról, kamatokról, állampapírról, magánnyugdíjról, vagyonkezelésről, megtakarításról. Komoly pénzügyi elemzések.",
  "kulturahoz":
    "Magyar podcastok kultúráról: könyvek, irodalom, színház, képzőművészet, zene, klasszikus művek, kortárs alkotók, kritika, esszé, kulturális események. Igényes, reflektív beszélgetések.",
  "filmekhez":
    "Magyar podcastok filmekről, sorozatokról, rendezőkről, színészekről, filmes újdonságokról, kritikákról, mozis ajánlókról, streaming sorozatokról, filmtörténetről.",
  "nyugodt-beszelgetesek":
    "Csendes, lassú tempójú, emberi magyar podcast beszélgetések. Mély interjúk, személyes történetek, reflexió, pszichológia, mindfulness, életvezetés. Nem hírműsor, nem politika.",
  "gyors-frissites":
    "Rövid, gyors magyar podcast epizódok: napi hírösszefoglalók, percpodcastok, rövid hírelemzések, friss aktualitások tömören. 5-15 perces formátumok, lényegre törő tartalom.",
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
        p_lang: "hu",
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

      if (!dryRun) {
        // Store the seed embedding as pgvector literal "[v1,v2,...]" so future
        // mood-recommendation RPCs can query episode_embeddings without re-embedding.
        const seedLit = `[${vec.join(",")}]`;
        const payload: Record<string, unknown> = {
          seed_query: m.seed_query || seed,
          seed_embedding: seedLit,
          updated_at: new Date().toISOString(),
        };
        if (ids.length) payload.podcast_ids = ids;
        const { error: upErr } = await admin
          .from("mood_collections")
          .update(payload)
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
