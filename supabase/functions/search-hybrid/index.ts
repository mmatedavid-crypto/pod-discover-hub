// Search v2 hybrid endpoint: lexical (tsv+trgm) + semantic (vector RRF) + AI re-rank.
// Now also: AI query understanding (cached) + per-result "why matched" snippets.
// POST { q: string, limit?: number, lang?: 'en'|'hu'|null, rerank?: boolean }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { understandQuery, buildExpandedQuery, type Understanding } from "../_shared/search-understand.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

const EPISODE_SELECT =
  "id,title,slug,published_at,summary,description,ai_summary,topics,people,companies,tickers,ingredients,audio_url,podcast_id,podcasts!inner(slug,title,image_url,category,podiverzum_rank,rank_label,rss_status,language)";

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { console.warn(`${label} timeout ${ms}ms`); resolve(null); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); console.warn(`${label} err`, e); resolve(null); });
  });
}

function normalizeQ(q: string): string {
  return q.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

async function embedRaw(q: string): Promise<number[] | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: q }] },
        taskType: "RETRIEVAL_QUERY",
        outputDimensionality: 768,
      }),
    });
    if (!r.ok) { console.warn("embed http", r.status); return null; }
    const j = await r.json();
    const v = j?.embedding?.values as number[] | undefined;
    return v && v.length === 768 ? v : null;
  } catch (e) { console.warn("embed err", e); return null; }
}
const embed = (q: string) => withTimeout(embedRaw(q), 1800, "embed");

async function rerankWithReasons(q: string, items: any[]): Promise<{ ids: string[]; why: Record<string, string> } | null> {
  if (!LOVABLE_API_KEY || items.length < 5) return null;
  const top = items.slice(0, 30);
  const compact = top.map((e, i) => ({
    i, id: e.id,
    t: (e.title || "").slice(0, 140),
    s: (e.ai_summary || e.summary || "").slice(0, 220),
    p: e.podcasts?.title?.slice(0, 60) ?? "",
  }));
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You re-rank podcast episodes by relevance and explain why each top result matches in <12 words." },
          { role: "user", content: `Query: ${q}\nCandidates: ${JSON.stringify(compact)}\nReturn the top 15 most relevant ids in order, each with a one-line why_matched.` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "rank",
            parameters: {
              type: "object", additionalProperties: false,
              properties: {
                results: {
                  type: "array",
                  maxItems: 15,
                  items: {
                    type: "object", additionalProperties: false,
                    properties: { id: { type: "string" }, why: { type: "string" } },
                    required: ["id", "why"],
                  },
                },
              },
              required: ["results"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "rank" } },
      }),
    });
    if (!r.ok) { console.warn("rerank http", r.status); return null; }
    const j = await r.json();
    const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return null;
    const parsed = typeof args === "string" ? JSON.parse(args) : args;
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    const ids = results.map((r: any) => r.id).filter(Boolean);
    const why: Record<string, string> = {};
    for (const r of results) if (r?.id && r?.why) why[r.id] = String(r.why).slice(0, 160);
    return { ids, why };
  } catch (e) { console.warn("rerank err", e); return null; }
}
const rerank = (q: string, items: any[]) => withTimeout(rerankWithReasons(q, items), 2500, "rerank");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const q = String(body.q || "").trim();
    const limit = Math.min(80, Math.max(5, Number(body.limit) || 50));
    const lang = body.lang === null ? null : (typeof body.lang === "string" ? body.lang : "en");
    const wantRerank = body.rerank !== false;

    if (!q) return new Response(JSON.stringify({ episodes: [], reason: "empty" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supa = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const t0 = Date.now();
    const qNorm = normalizeQ(q);

    // 1) Cache lookup (understanding + embedding) — 7d TTL
    let understanding: Understanding | null = null;
    let q_embedding: number[] | null = null;
    let cacheHit = false;
    try {
      const { data: cached } = await supa
        .from("search_query_cache")
        .select("understanding, embedding, updated_at")
        .eq("q_norm", qNorm)
        .maybeSingle();
      if (cached && cached.updated_at && Date.now() - new Date(cached.updated_at).getTime() < 7 * 24 * 3600 * 1000) {
        understanding = cached.understanding as Understanding;
        if (typeof cached.embedding === "string") {
          // pgvector returns "[...]" string
          try {
            const arr = JSON.parse(cached.embedding);
            if (Array.isArray(arr) && arr.length === 768) q_embedding = arr as number[];
          } catch { /* ignore */ }
        } else if (Array.isArray(cached.embedding) && cached.embedding.length === 768) {
          q_embedding = cached.embedding as number[];
        }
        cacheHit = true;
      }
    } catch (e) { console.warn("cache read err", e); }

    // 2) Parallel: understanding (if missing) + embedding (if missing)
    const [u, embVal] = await Promise.all([
      understanding ? Promise.resolve(understanding) : understandQuery(q, 1500),
      q_embedding ? Promise.resolve(q_embedding) : embed(q),
    ]);
    understanding = u as Understanding;
    if (!q_embedding) q_embedding = embVal;
    const tEmb = Date.now() - t0;

    // 3) Persist to cache (fire and forget)
    if (!cacheHit) {
      supa.from("search_query_cache").upsert({
        q_norm: qNorm,
        understanding: understanding,
        embedding: q_embedding ? `[${q_embedding.join(",")}]` : null,
        updated_at: new Date().toISOString(),
      }).then(() => {}, (e) => console.warn("cache write", e));
    } else {
      supa.rpc("noop").then(() => {}, () => {});
      supa.from("search_query_cache").update({ hits: 1, updated_at: new Date().toISOString() }).eq("q_norm", qNorm).then(() => {}, () => {});
    }

    // 4) Hybrid RPC with expanded query (lexical) + original embedding (semantic)
    const expanded = buildExpandedQuery(q, understanding);
    const { data: rows, error } = await supa.rpc("search_episodes_hybrid", {
      q: expanded,
      q_embedding: q_embedding ? `[${q_embedding.join(",")}]` : null,
      limit_n: Math.max(limit, 50),
      lang,
    });
    if (error) {
      console.error("rpc err", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const tRpc = Date.now() - t0 - tEmb;

    const ids = (rows || []).map((r: any) => r.episode_id);
    if (ids.length === 0) {
      return new Response(JSON.stringify({ episodes: [], understanding, timing: { embed_ms: tEmb, rpc_ms: tRpc }, semantic: !!q_embedding, cache_hit: cacheHit }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: eps, error: eErr } = await supa.from("episodes").select(EPISODE_SELECT).in("id", ids);
    if (eErr) {
      return new Response(JSON.stringify({ error: eErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const orderMap = new Map<string, number>();
    (rows as any[]).forEach((r, i) => orderMap.set(r.episode_id, i));
    let ordered = (eps || [])
      .filter((e: any) => {
        const p = e.podcasts;
        if (!p) return false;
        if (p.rss_status === "failed" || p.rss_status === "inactive") return false;
        return true;
      })
      .sort((a: any, b: any) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));

    let rerankResult: { ids: string[]; why: Record<string, string> } | null = null;
    if (wantRerank) rerankResult = await rerank(q, ordered);
    const tRerank = Date.now() - t0 - tEmb - tRpc;

    if (rerankResult && rerankResult.ids.length) {
      const idx = new Map(rerankResult.ids.map((id, i) => [id, i]));
      ordered = ordered
        .map((e: any) => ({ e, r: idx.has(e.id) ? idx.get(e.id)! : 999 + (orderMap.get(e.id) ?? 0) }))
        .sort((a, b) => a.r - b.r)
        .map((x) => {
          const why = rerankResult!.why[x.e.id];
          return why ? { ...x.e, why_matched: why } : x.e;
        });
    }

    return new Response(
      JSON.stringify({
        episodes: ordered.slice(0, limit),
        understanding,
        semantic: !!q_embedding,
        reranked: !!rerankResult,
        cache_hit: cacheHit,
        timing: { embed_ms: tEmb, rpc_ms: tRpc, rerank_ms: tRerank, total_ms: Date.now() - t0 },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("search-hybrid err", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
