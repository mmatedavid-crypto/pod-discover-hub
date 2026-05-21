// Search v2 hybrid endpoint: lexical (tsv+trgm) + semantic (vector RRF) + AI re-rank.
// v13-port from Podiverzum remix. Chunk-augmentation disabled by default
// (engine v12) — engine=v13 query param available if/when episode_chunks ships.
// POST { q: string, limit?: number, lang?: 'en'|'hu'|null, rerank?: boolean, engine?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { understandQuery, buildExpandedQuery, detectAdjNounTopic, type Understanding } from "../_shared/search-understand.ts";
import { loadCuratedSynonyms } from "../_shared/search-synonyms.ts";
import { getHydeExpansion, blendEmbeddings } from "../_shared/search-hyde.ts";
import { cohereRerank, type CohereRerankInput } from "../_shared/cohere-rerank.ts";
import { detectBot } from "../_shared/bot-detect.ts";

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

const MARKET_SYMBOL_ALIASES: Record<string, string[]> = {
  eth: ["Ethereum", "Ether"],
  btc: ["Bitcoin"],
  sol: ["Solana"],
  xrp: ["XRP Ledger", "Ripple"],
  ada: ["Cardano"],
  doge: ["Dogecoin"],
  avax: ["Avalanche"],
  link: ["Chainlink"],
  dot: ["Polkadot"],
  matic: ["Polygon"],
  nbis: ["Nebius", "Nebius Group"],
  asts: ["AST SpaceMobile"],
  smci: ["Super Micro Computer", "Supermicro"],
  pltr: ["Palantir"],
  rddt: ["Reddit"],
  arm: ["Arm Holdings"],
  coin: ["Coinbase"],
  hood: ["Robinhood"],
  rivn: ["Rivian"],
  lcid: ["Lucid Motors"],
  mstr: ["MicroStrategy"],
  nvda: ["Nvidia"],
  tsla: ["Tesla"],
  amd: ["AMD", "Advanced Micro Devices"],
  meta: ["Meta", "Facebook"],
  goog: ["Google", "Alphabet"],
  googl: ["Google", "Alphabet"],
  msft: ["Microsoft"],
  aapl: ["Apple"],
  amzn: ["Amazon"],
  nflx: ["Netflix"],
  tsm: ["TSMC", "Taiwan Semiconductor"],
  // BÉT (Budapesti Értéktőzsde) — magyar blue chipek és mid-capek
  otp: ["OTP Bank", "OTP"],
  mol: ["MOL Nyrt", "MOL Magyar Olaj"],
  richter: ["Richter Gedeon", "Gedeon Richter"],
  mtelekom: ["Magyar Telekom"],
  opus: ["Opus Global"],
  "4ig": ["4iG", "4iG Nyrt"],
  masterplast: ["Masterplast"],
  any: ["ANY Biztonsági Nyomda"],
  waberer: ["Waberer's", "Waberers"],
  akko: ["AKKO Invest"],
  alteo: ["ALTEO"],
  autowallis: ["AutoWallis"],
  duna: ["Duna House"],
  raba: ["Rába"],
  zwack: ["Zwack Unicum"],
  cig: ["CIG Pannónia"],
  pannergy: ["PannErgy"],
  delta: ["Delta Technologies"],
};

// "ANY", "MOL", "OTP" stb. közneveknek is tűnhetnek angolul, de magyar tőzsdei
// környezetben gyakran tickerként szerepelnek — ezért NEM tesszük a non-ticker listára.
const COMMON_NON_TICKER_ACRONYMS = new Set(["AI", "AR", "EU", "IT", "ML", "UK", "US", "UX", "VR"]);

// Stop-words excluded from rare-token MUST gate (common English + Hungarian + podcast filler).
const RARE_GATE_STOPWORDS = new Set([
  // English articles / aux / pronouns
  "a","an","the","is","am","are","was","were","be","been","being","do","does","did","done",
  "has","have","had","having","of","in","on","at","to","by","as","or","if","it","its","i","me","my",
  "we","us","our","he","she","him","her","his","they","them","their","you","your","yours","myself",
  "and","but","not","no","so","up","off","out","into","over","under","than","then","also","only","very",
  "for","with","that","this","from","what","when","where","how","why","who","which","whom","whose",
  // Hungarian articles / common words (accents already stripped by normalizeQ)
  "az","es","vagy","de","hogy","mert","ez","egy","van","volt","lesz","csak","mar","meg","most",
  "ha","sem","is","ne","nem","igen","ott","itt","oda","ide","nincs","ki","be","fel","le","at",
  "mi","te","o","mink","tik","ok","engem","teged","ot","minket","titeket","oket","nekem","neked","neki",
  "ami","aki","ahol","amikor","mig","valamint","azonban","viszont","tehat","tovabba","amit","akit",
  // Podcast filler — EN + HU
  "podcast","podcasts","episode","episodes","show","shows","talk","talks","about","best","top","new",
  "latest","good","great","like","just","one","two","three","all","any","some","more","most","much","even",
  "epizod","epizodok","musor","beszelgetes","interju","adasok","resz","reszek",
]);

function looksLikeGibberish(t: string): boolean {
  if (t.length < 4) return false;
  if (/^(.)\1{3,}$/.test(t)) return true;
  if (/[a-z]/.test(t) && /\d/.test(t) && t.length <= 10 && !/^[a-z]+\d{1,4}$/.test(t)) {
    if (!/^(gpt|llama|claude|gemini|rtx|gtx|h|a|b|m|i|core|ipv|ip|mp|mp3|mp4|h264|h265|w|wd|sd|hd)\d/.test(t)) return true;
  }
  if (t.length >= 6 && !/[aeiouy]/.test(t)) return true;
  return false;
}

function tokenizeForRareGate(q: string, isTickerQ: boolean): string[] {
  if (isTickerQ) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of q.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/)) {
    const t = raw.trim();
    if (t.length < 3 || t.length > 30) continue;
    if (RARE_GATE_STOPWORDS.has(t)) continue;
    if (/^\d+$/.test(t)) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= 6) break;
  }
  return out;
}

const MARKET_SYMBOL_SECTORS: Record<string, string> = {
  nbis: "AI cloud computing GPU infrastructure data centers hyperscaler",
  asts: "satellite communications space-based mobile broadband",
  smci: "AI server hardware data center GPU infrastructure",
  pltr: "data analytics enterprise AI software defense tech",
  rddt: "social media online communities user-generated content",
  arm: "semiconductor chip design ARM architecture mobile processors",
  coin: "cryptocurrency exchange digital assets bitcoin trading",
  hood: "retail trading brokerage fintech investing app",
  rivn: "electric vehicles EV trucks automotive startups",
  lcid: "luxury electric vehicles EV automotive",
  mstr: "bitcoin treasury enterprise software cryptocurrency",
  nvda: "GPU AI chips semiconductor accelerated computing",
  tsla: "electric vehicles autonomous driving energy storage",
  amd: "semiconductor CPU GPU chips data center",
  meta: "social media VR augmented reality advertising platform",
  goog: "search advertising cloud computing AI Android",
  googl: "search advertising cloud computing AI Android",
  msft: "cloud computing Azure enterprise software AI Copilot",
  aapl: "consumer electronics iPhone services ecosystem",
  amzn: "ecommerce AWS cloud computing logistics",
  nflx: "streaming video entertainment subscription content",
  tsm: "semiconductor foundry chip manufacturing advanced nodes",
  eth: "ethereum smart contracts DeFi blockchain",
  btc: "bitcoin cryptocurrency digital gold store of value",
  sol: "solana blockchain web3 high-performance L1",
  xrp: "ripple cross-border payments crypto",
  doge: "dogecoin meme cryptocurrency",
  avax: "avalanche blockchain L1 DeFi",
  // BÉT szektorok
  otp: "bankszektor lakossági banki szolgáltatások közép-európai bank",
  mol: "olaj gáz energia downstream petrolkémia üzemanyag",
  richter: "gyógyszeripar pharma nőgyógyászati készítmények biotechnológia",
  mtelekom: "telekommunikáció mobilszolgáltató internet kábeltévé",
  opus: "építőipar energetika holding diverzifikált",
  "4ig": "informatika IT szolgáltatások védelmi technológia űripar",
  masterplast: "építőanyag szigetelés homlokzati rendszerek",
  any: "értékpapír-nyomtatás okmánybiztonság kártya",
  waberer: "logisztika közúti szállítmányozás fuvarozás",
  alteo: "megújuló energia áramtermelés energiakereskedelem",
  autowallis: "autókereskedelem gépjármű import",
  duna: "ingatlanközvetítés ingatlanpiac lakáspiac",
  raba: "járműipar haszonjármű alkatrész tengely",
  zwack: "italgyártás likőr Unicum szeszipar",
  cig: "biztosító életbiztosítás pénzügyi szolgáltatás",
  pannergy: "geotermikus energia távhő megújuló",
  delta: "informatika rendszerintegráció IT szolgáltatások",
};

const TICKER_HELPER_WORDS = new Set([
  "stock","stocks","share","shares","ticker","equity","equities",
  "részvény","reszveny","részvények","reszvenyek","papír","papir",
  "price","quote","chart","earnings","revenue","sales","results","guidance","forecast",
  "analysis","analyst","valuation","market","cap","financials","quarter","q1","q2","q3","q4",
]);
function compactMarketSymbol(q: string): string | null {
  const trimmed = q.trim();
  const hadDollar = trimmed.startsWith("$");
  const t = trimmed.replace(/^\$/, "");
  const isAllCaps = (s: string) => s === s.toUpperCase() && /[A-Z]/.test(s);
  // Explicit BÉT / alfanumerikus alias match (pl. "4iG", "4IG", "richter", "MTELEKOM")
  const aliasKey = t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  if (MARKET_SYMBOL_ALIASES[aliasKey]) return aliasKey.toUpperCase();
  if (/^[A-Za-z]{2,5}(\.[A-Za-z])?$/.test(t)) {
    if (hadDollar || isAllCaps(t)) return t.toUpperCase();
    return null;
  }
  // Alfanumerikus tickerek (pl. "4iG") — csak $ vagy all-caps prefix esetén
  if (/^[A-Za-z0-9]{2,6}$/.test(t) && /[A-Za-z]/.test(t) && /[0-9]/.test(t)) {
    if (hadDollar || isAllCaps(t)) return t.toUpperCase();
  }
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && parts.length <= 4) {
    const core = parts.filter((p) => !TICKER_HELPER_WORDS.has(p.toLowerCase()));
    if (core.length === 1 && /^[A-Za-z]{2,5}(\.[A-Za-z])?$/.test(core[0])) {
      if (hadDollar || isAllCaps(core[0])) return core[0].toUpperCase();
    }
  }
  return null;
}

function uniqueClean(values: string[], max = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const v = String(raw || "").trim();
    const key = v.toLowerCase();
    if (!v || seen.has(key)) continue;
    seen.add(key);
    out.push(v);
    if (out.length >= max) break;
  }
  return out;
}

function quoteWebSearchTerm(term: string): string {
  return term.includes(" ") ? `"${term.replace(/"/g, " ").trim()}"` : term;
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
// Quality-first: give the embedding call enough time to complete on cold paths.
// A missing embedding silently degrades to lexical-only — that's the noisiest mode.
const embed = (q: string) => withTimeout(embedRaw(q), 3500, "embed");

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
          { role: "system", content: "You re-rank Hungarian podcast episodes by relevance and explain why each top result matches in <12 words, in Hungarian." },
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
// Quality-first: allow the reranker the time it needs. A 2-4s search with
// correct ordering beats a 500ms search with the wrong top result.
const rerank = (q: string, items: any[]) => withTimeout(rerankWithReasons(q, items), 9000, "rerank");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    let q = String(body.q || "").trim();
    const limit = Math.min(80, Math.max(5, Number(body.limit) || 50));
    const lang = body.lang === null ? null : (typeof body.lang === "string" ? body.lang : "hu");

    // Bot gate — crawlers, scrapers, AI training bots, link previewers and
    // monitoring agents get a lexical-only path. No LLM understanding, no
    // embedding call, no HyDE expansion, no Cohere rerank, no AI rerank.
    // Real users keep the full v13 quality-first pipeline.
    const botCheck = detectBot(req);
    const isBot = botCheck.isBot;
    if (isBot) console.log("search-hybrid bot path", { reason: botCheck.reason, ua: botCheck.ua.slice(0, 80) });

    const wantRerank = !isBot && body.rerank !== false;

    // Engine version flags. Default comes from app_settings.search_engine when caller
    // does not pin it explicitly. quality_guard re-runs with fallback engine if v13 returns 0.
    const supaPre = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    let engineCfg: any = {
      default_engine: "v13",
      fallback_engine: "v12",
      chunk_aug_enabled: false,
      quality_guard_enabled: true,
      // Bumped whenever ranking logic changes — invalidates cached understanding / rerank rows.
      ranking_version: 2,
      understanding_version: 2,
    };
    try {
      const { data: cfgRow } = await supaPre.from("app_settings").select("value").eq("key", "search_engine").maybeSingle();
      if (cfgRow?.value && typeof cfgRow.value === "object") engineCfg = { ...engineCfg, ...cfgRow.value };
    } catch (_) { /* keep defaults */ }
    const RANKING_VERSION = Number(engineCfg.ranking_version || 1);
    const UNDERSTANDING_VERSION = Number(engineCfg.understanding_version || 1);
    const engineRaw = String(body.engine || engineCfg.default_engine || "v13").toLowerCase();
    const engN = (() => { const m = engineRaw.match(/v?(\d+)/); return m ? parseInt(m[1], 10) : 13; })();
    // Chunk-aug is a soft flag; v13 only uses it when both engN>=13 AND config allows.
    const chunkAugAllowed = engN >= 13 && !!engineCfg.chunk_aug_enabled;
    const FF = {
      threePassMust: engN >= 9,
      mmrDiversity: engN >= 9,
      hallucinationGuard: engN >= 10,
      entityPyramid: engN >= 10,
      spell: engN >= 11,
      decay: engN >= 12,
      bigramMust: engN >= 12,
      // AI-cost features force-disabled for bots regardless of engine version.
      hyde: !isBot && engN >= 12,
      cohere: !isBot && engN >= 12,
      chunkAugment: chunkAugAllowed,
    };

    if (!q) return new Response(JSON.stringify({ episodes: [], reason: "empty" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supa = supaPre;
    const t0 = Date.now();
    let qNorm = normalizeQ(q);

    // Stopword + gibberish gate.
    {
      const tokens = qNorm.split(/[^a-z0-9]+/).filter((t) => t.length >= 1);
      const meaningful = tokens.filter((t) => t.length >= 2 && !RARE_GATE_STOPWORDS.has(t) && !/^\d+$/.test(t));
      const allGibberish = meaningful.length > 0 && meaningful.every((t) => looksLikeGibberish(t));
      if (tokens.length > 0 && (meaningful.length === 0 || allGibberish)) {
        return new Response(JSON.stringify({
          episodes: [],
          timing: { embed_ms: 0, rpc_ms: 0, total_ms: Date.now() - t0 },
          confidence_band: "low",
          stopword_gate: meaningful.length === 0,
          gibberish_gate: allGibberish,
          reason: allGibberish ? "gibberish_only" : "stopwords_only",
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    // === PERSON-NAME STRICT GATE (2026-05-20) ===
    // Multi-token title-cased queries must exact-match a person via
    // person_aliases / person_episode_mentions. NO single-token fallback,
    // NO stemming, NO vector fallback. Prevents "Burján Szilárd" -> Pap/Demeter
    // Szilárd or "szilárdult" word matches.
    {
      const origTokens = q.split(/\s+/).filter((t) => t.length > 0);
      const titleTokens = origTokens.filter((t) => /^[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű'-]+/.test(t));
      const isPersonNameQuery = origTokens.length >= 2 && titleTokens.length >= 2 && origTokens.length <= 4;
      if (isPersonNameQuery) {
        const phrase = qNorm; // already lowercased + diacritics-stripped + trimmed
        try {
          // 1) Resolve person via aliases (accepted scope=global) — exact normalized match.
          const { data: aliasRows } = await supa
            .from("person_aliases")
            .select("person_id")
            .eq("normalized_alias", phrase)
            .eq("status", "accepted")
            .limit(50);
          const personIds = Array.from(new Set((aliasRows || []).map((r: any) => r.person_id).filter(Boolean)));

          let epIds: string[] = [];
          if (personIds.length > 0) {
            const { data: mentionRows } = await supa
              .from("person_episode_mentions")
              .select("episode_id, confidence, mention_type, relevance_status")
              .in("person_id", personIds)
              .order("confidence", { ascending: false })
              .limit(200);
            epIds = Array.from(new Set((mentionRows || [])
              .filter((r: any) => r.relevance_status !== "rejected")
              .map((r: any) => r.episode_id).filter(Boolean)));
          }

          // Fetch episodes (HU-only via podcasts.language)
          let episodes: any[] = [];
          if (epIds.length > 0) {
            const { data: eps } = await supa
              .from("episodes")
              .select(EPISODE_SELECT)
              .in("id", epIds.slice(0, 80))
              .order("published_at", { ascending: false })
              .limit(limit);
            episodes = (eps || []).filter((e: any) => {
              const plang = e?.podcasts?.language || "";
              return typeof plang === "string" && plang.toLowerCase().startsWith("hu");
            });
          }

          return new Response(JSON.stringify({
            episodes,
            timing: { embed_ms: 0, rpc_ms: 0, total_ms: Date.now() - t0 },
            confidence_band: episodes.length > 0 ? "high" : "low",
            person_name_strict: true,
            person_query: phrase,
            matched_person_ids: personIds,
            no_exact_person_match: episodes.length === 0,
            reason: episodes.length === 0 ? "person_strict_no_match" : "person_strict_match",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        } catch (e) {
          console.warn("person-strict gate err, falling through", e);
          // fall through to normal flow on unexpected error
        }
      }
    }


    // 1) Cache lookup
    let understanding: Understanding | null = null;
    let q_embedding: number[] | null = null;
    let cachedRerank: { ids: string[]; why: Record<string, string> } | null = null;
    let cacheHit = false;
    try {
      const { data: cached } = await supa
        .from("search_query_cache")
        .select("understanding, embedding, updated_at, rerank, rerank_updated_at")
        .eq("q_norm", qNorm)
        .maybeSingle();
      // Quality-first: cache rows carry their ranking/understanding version inside
      // the JSON blob. When the policy version bumps, older rows are ignored so
      // bad rankings don't survive a logic change.
      const cuv = (cached?.understanding as any)?.__uv;
      const understandingFresh = cached && cached.updated_at
        && Date.now() - new Date(cached.updated_at).getTime() < 7 * 24 * 3600 * 1000
        && (cuv === undefined || Number(cuv) >= UNDERSTANDING_VERSION);
      if (understandingFresh) {
        understanding = cached.understanding as Understanding;
        if (typeof cached.embedding === "string") {
          try {
            const arr = JSON.parse(cached.embedding);
            if (Array.isArray(arr) && arr.length === 768) q_embedding = arr as number[];
          } catch { /* ignore */ }
        } else if (Array.isArray(cached.embedding) && cached.embedding.length === 768) {
          q_embedding = cached.embedding as number[];
        }
        cacheHit = true;
      }
      const crv = (cached?.rerank as any)?.__rv;
      const rerankFresh = cached?.rerank && cached.rerank_updated_at
        && Date.now() - new Date(cached.rerank_updated_at).getTime() < 24 * 3600 * 1000
        && (crv === undefined ? false : Number(crv) >= RANKING_VERSION);
      if (rerankFresh) {
        const r = cached.rerank as any;
        if (Array.isArray(r?.ids) && r.ids.length) {
          cachedRerank = { ids: r.ids, why: (r.why && typeof r.why === "object") ? r.why : {} };
        }
      }
    } catch (e) { console.warn("cache read err", e); }

    const marketSymbol = compactMarketSymbol(q);
    const symbolAliases = marketSymbol ? (MARKET_SYMBOL_ALIASES[marketSymbol.toLowerCase()] || []) : [];
    const isTickerQ = !!marketSymbol && !COMMON_NON_TICKER_ACRONYMS.has(marketSymbol);
    if (isTickerQ && understanding) {
      const hasCompany = (understanding.entities || []).some((e) => typeof e === "string" && e.includes(" "));
      if (!hasCompany && !symbolAliases.length) understanding = null;
    }

    // 2) Parallel: understanding + embedding + curated synonyms
    // Bot path: skip LLM understanding and embedding entirely. Pure lexical search.
    const [u, embVal, curated] = await Promise.all([
      understanding ? Promise.resolve(understanding) : (isBot ? Promise.resolve(null) : understandQuery(q, 2500)),
      q_embedding ? Promise.resolve(q_embedding) : (isBot ? Promise.resolve(null) : embed(q)),
      loadCuratedSynonyms(supa, qNorm),
    ]);
    understanding = u as Understanding;
    if (!q_embedding) q_embedding = embVal;
    understanding = u as Understanding;
    if (!q_embedding) q_embedding = embVal;
    const tEmb = Date.now() - t0;

    // === P0 fix: adj+noun topic guard (e.g. "orosz irodalom" must NOT promote Orosz Ferenc) ===
    // Recompute here defensively — cached understanding rows may pre-date the guard,
    // and even fresh ones can be polluted by the upstream LLM with surname-only entities.
    const adjNoun = (understanding?.adj_noun) || detectAdjNounTopic(q);
    if (adjNoun) {
      const adj = adjNoun.adjective.toLowerCase();
      const noun = adjNoun.noun.toLowerCase();
      const stripped = (understanding?.entities || []).filter((e) => {
        const lc = String(e || "").toLowerCase().trim();
        if (!lc) return false;
        if (lc === adj) return false;
        const firstTok = lc.split(/\s+/)[0];
        if (firstTok === adj && !lc.includes(noun)) return false;
        return true;
      });
      understanding = {
        ...(understanding as Understanding),
        entities: stripped,
        intent: "topic",
        adj_noun: adjNoun,
      };
    }

    // Ticker override
    if (isTickerQ && marketSymbol) {
      const sym = marketSymbol;
      const aiEntities = (understanding?.entities || []).filter((e) => e && e.toUpperCase() !== sym);
      const curatedCompanies = (curated.expansions || []).filter((e) => e && e.toUpperCase() !== sym);
      const resolvedNames = uniqueClean([...symbolAliases, ...curatedCompanies, ...aiEntities], 10);
      understanding = {
        entities: uniqueClean([sym, ...resolvedNames], 8),
        expanded_terms: uniqueClean([sym, ...resolvedNames], 8),
        synonyms: [],
        intent: "ticker",
        language: understanding?.language || "hu",
      };
      cachedRerank = null;
    }

    // 3) Persist to cache (versioned)
    // Bot path: NEVER write cache — would poison entries with null
    // understanding/embedding and starve real users of AI rerank.
    if (isBot) {
      // skip cache write entirely
    } else if (!cacheHit || isTickerQ) {
      const understandingToCache = understanding
        ? { ...(understanding as any), __uv: UNDERSTANDING_VERSION }
        : null;
      supa.from("search_query_cache").upsert({
        q_norm: qNorm,
        understanding: understandingToCache,
        embedding: q_embedding ? `[${q_embedding.join(",")}]` : null,
        updated_at: new Date().toISOString(),
      }).then(() => {}, (e) => console.warn("cache write", e));
    } else {
      supa.from("search_query_cache").update({ hits: 1, updated_at: new Date().toISOString() }).eq("q_norm", qNorm).then(() => {}, () => {});
    }

    // 4) Hybrid RPC
    const aiExpanded = buildExpandedQuery(q, understanding);
    const expanded = curated.expansions.length
      ? `${aiExpanded} ${curated.expansions.join(" ")}`.slice(0, 700)
      : aiExpanded;

    const rawEntities = (understanding?.entities || [])
      .map((s) => String(s || "").trim())
      .filter((s) => s.length >= 3 && s.length <= 60);
    const resolvedMarketTerms = isTickerQ && marketSymbol
      ? uniqueClean([
          marketSymbol,
          ...symbolAliases,
          ...(curated.expansions || []),
          ...rawEntities.filter((t) => t.toUpperCase() !== marketSymbol),
        ], 8)
      : [];
    const strictCandidateTerms = isTickerQ && resolvedMarketTerms.length
      ? [
          resolvedMarketTerms.find((t) => t.includes(" "))
            || resolvedMarketTerms.find((t) => t.toUpperCase() !== marketSymbol)
            || resolvedMarketTerms[0],
        ].filter(Boolean) as string[]
      : rawEntities;
    const intent = String(understanding?.intent || "").toLowerCase();
    const highPrecisionIntent = isTickerQ || intent === "person" || intent === "company" || intent === "ticker" || intent === "episode";
    const requiredTermsBase = (highPrecisionIntent ? strictCandidateTerms : [])
      .slice()
      .sort((a, b) => b.length - a.length)
      .slice(0, 4);

    // Rare-token MUST gate via IDF
    const rareGateTokens = tokenizeForRareGate(q, isTickerQ);
    let rareTokens: string[] = [];
    let unknownTokens: string[] = [];
    let unknownTokenCount = 0;
    let idfRpcOk = false;
    if (rareGateTokens.length) {
      try {
        const { data: idfRows, error: idfErr } = await supa.rpc("token_idf", { p_tokens: rareGateTokens });
        if (idfErr) throw idfErr;
        idfRpcOk = true;
        const RARE_THRESHOLD = 200;
        const UNKNOWN_THRESHOLD = 1;
        const rows = ((idfRows as Array<{ token: string; df: number }>) || []);
        rareTokens = rows.filter((r) => r.df > 0 && r.df < RARE_THRESHOLD).map((r) => r.token);
        const dfMap = new Map(rows.map((r) => [r.token, r.df]));
        unknownTokens = rareGateTokens.filter((t) => {
          const df = dfMap.get(t);
          return df === undefined ? true : df < UNKNOWN_THRESHOLD;
        });
        unknownTokenCount = unknownTokens.length;
      } catch (e) { console.warn("token_idf err", e); }
    }

    // Spell-correction
    const spellCorrections: Array<{ from: string; to: string }> = [];
    const rawEntitiesPre = (understanding?.entities || [])
      .map((s) => String(s || "").trim())
      .filter((s) => s.length >= 3 && s.length <= 60);
    const trustedEntitiesPre = rawEntitiesPre.filter((e) => {
      if (e.includes(" ")) return true;
      const tk = e.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      return !(tk.length === 1 && rareGateTokens.includes(tk[0]));
    });
    if (FF.spell && idfRpcOk && !isTickerQ && unknownTokens.length > 0 && trustedEntitiesPre.length === 0) {
      const correctable = unknownTokens.filter((t) => {
        const re = new RegExp(`\\b${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
        const m = q.match(re);
        if (m && /[A-Z]/.test(m[0])) return false;
        return t.length >= 4 && /^[a-z]+$/.test(t);
      });
      if (correctable.length) {
        try {
          const { data: sugRows } = await supa.rpc("suggest_token_corrections", { p_tokens: correctable });
          const sugs = (sugRows as Array<{ token: string; suggestion: string; similarity: number }> | null) || [];
          for (const s of sugs) if (s?.token && s?.suggestion && s.token !== s.suggestion) {
            spellCorrections.push({ from: s.token, to: s.suggestion });
          }
        } catch (e) { console.warn("spell rpc err", e); }
      }
      if (spellCorrections.length) {
        let rewritten = q;
        for (const c of spellCorrections) {
          rewritten = rewritten.replace(new RegExp(`\\b${c.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), c.to);
        }
        q = rewritten;
        qNorm = normalizeQ(rewritten);
        const newEmb = await embed(rewritten);
        if (newEmb) q_embedding = newEmb;
        const newGateTokens = tokenizeForRareGate(rewritten, false);
        try {
          const { data: idfRows2 } = await supa.rpc("token_idf", { p_tokens: newGateTokens });
          const rows2 = ((idfRows2 as Array<{ token: string; df: number }>) || []);
          rareTokens = rows2.filter((r) => r.df > 0 && r.df < 200).map((r) => r.token);
          const df2 = new Map(rows2.map((r) => [r.token, r.df]));
          unknownTokens = newGateTokens.filter((t) => (df2.get(t) ?? 0) < 1);
          unknownTokenCount = unknownTokens.length;
        } catch { /* ignore */ }
      }
    }

    // Nonsense gate
    const trustedEntities = rawEntities.filter((e) => {
      const lc = e.toLowerCase();
      if (e.includes(" ")) return true;
      const tokens = lc.split(/[^a-z0-9]+/).filter(Boolean);
      if (tokens.length === 1 && rareGateTokens.includes(tokens[0])) return false;
      return true;
    });
    if (
      FF.hallucinationGuard &&
      idfRpcOk &&
      !isTickerQ &&
      rareGateTokens.length > 0 &&
      unknownTokenCount === rareGateTokens.length &&
      trustedEntities.length === 0
    ) {
      return new Response(JSON.stringify({
        episodes: [],
        understanding,
        timing: { embed_ms: tEmb, rpc_ms: 0, total_ms: Date.now() - t0 },
        semantic: !!q_embedding,
        cache_hit: cacheHit,
        confidence_band: "low",
        rare_tokens: rareGateTokens,
        nonsense_gate: true,
        reason: "no_known_tokens",
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Phrase tokens
    const phraseTokens = qNorm.split(/[^a-z0-9]+/).filter(
      (t) => t.length >= 3 && !RARE_GATE_STOPWORDS.has(t) && !/^\d+$/.test(t)
    );
    const phrasePool: string[] = [];
    if (highPrecisionIntent && !isTickerQ && phraseTokens.length >= 2 && phraseTokens.length <= 4) {
      for (const t of phraseTokens) phrasePool.push(t);
    }

    // Entity resolution
    let resolvedEntities: Array<{ kind: string; display_name: string; slug: string; similarity: number }> = [];
    if (!isTickerQ && qNorm.length >= 3 && qNorm.length <= 60) {
      // Quality-first: 400ms was too tight, entity resolution often timed out
      // (≈0% hit-rate). Bumped to 1500ms — the pyramid resolves >90% of HU
      // person/topic entities at this budget.
      const resolved = await withTimeout(
        supa.rpc("resolve_query_entities", { p_q: q, p_max: 6, p_threshold: 0.45 }).then((r: any) => r.data),
        1500, "resolve_query_entities",
      );
      if (Array.isArray(resolved)) resolvedEntities = resolved as any;
    }
    const resolvedNames = uniqueClean(resolvedEntities.map((r) => r.display_name), 4);

    const gatedRareTokens = (FF.hallucinationGuard && highPrecisionIntent) ? rareTokens : [];
    const requiredTerms = uniqueClean([...requiredTermsBase, ...gatedRareTokens, ...phrasePool], 8);
    const entityTerms = uniqueClean([...rawEntities, ...resolvedNames], 10);
    const contiguousPhrase = (!isTickerQ && phraseTokens.length >= 2 && phraseTokens.length <= 4)
      ? [phraseTokens.join(" ")] : [];
    const phraseTerms = uniqueClean([...contiguousPhrase, ...resolvedNames], 6);

    if (
      FF.bigramMust &&
      (intent === "person" || intent === "company") &&
      contiguousPhrase.length &&
      rawEntities.some((e) => e.toLowerCase() === contiguousPhrase[0].toLowerCase())
    ) {
      if (!requiredTerms.includes(contiguousPhrase[0])) requiredTerms.push(contiguousPhrase[0]);
    }

    const alphaLex = isTickerQ ? 0.8 : (rawEntities.length > 0 || resolvedNames.length > 0) ? 0.65 : 0.45;
    const decayLambda = (FF.decay && (intent === "news" || intent === "ticker" || intent === "company")) ? 0.15 : 0;

    // HyDE
    let hydeUsed = false;
    let hydeCacheHit: boolean | null = null;
    if (
      FF.hyde &&
      q_embedding &&
      (intent === "topic" || intent === "question" || intent === "") &&
      !isTickerQ &&
      qNorm.split(/\s+/).filter(Boolean).length >= 3
    ) {
      try {
        const hyde = await getHydeExpansion(supa, qNorm, q);
        if (hyde && hyde.embedding.length === 768) {
          q_embedding = blendEmbeddings(q_embedding, hyde.embedding, 0.6);
          hydeUsed = true;
          hydeCacheHit = hyde.cache_hit;
        }
      } catch (e) { console.warn("hyde err", e); }
    }

    // Lexical query
    let lexQ = q;
    if (isTickerQ && marketSymbol) {
      const companies = uniqueClean([
        ...symbolAliases,
        ...(curated.expansions || []),
        ...rawEntities.filter((t) => t.toUpperCase() !== marketSymbol),
        marketSymbol,
      ], 8);
      if (companies.length) {
        lexQ = companies.map(quoteWebSearchTerm).join(" OR ");
      }
    } else {
      const synExpansions = uniqueClean([
        ...(curated.expansions || []),
        ...((understanding?.synonyms as string[]) || []),
        ...((understanding?.expanded_terms as string[]) || []),
      ], 6).filter((t) => t.toLowerCase() !== q.toLowerCase());
      if (synExpansions.length) {
        const parts = [quoteWebSearchTerm(q), ...synExpansions.map(quoteWebSearchTerm)];
        lexQ = parts.join(" OR ");
      }
    }

    let { data: rows, error } = await supa.rpc("search_episodes_hybrid", {
      q: lexQ,
      q_embedding: q_embedding ? `[${q_embedding.join(",")}]` : null,
      limit_n: Math.max(limit, 50),
      lang,
      required_terms: requiredTerms.length ? requiredTerms : null,
      entity_terms: entityTerms.length ? entityTerms : null,
      alpha_lex: alphaLex,
      p_decay_lambda: decayLambda,
      phrase_terms: phraseTerms.length ? phraseTerms : null,
    });
    if (error) {
      console.error("rpc err", error);
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    let mustGateApplied = requiredTerms.length > 0;
    let mustGateRelaxed = false;
    let mustGateDropped = false;
    const strictRows = rows || [];
    const strictHitIds = new Set(strictRows.map((r: any) => r.episode_id));
    const strictIds = new Set(strictHitIds);
    const appendNew = (extra: any[] | null | undefined) => {
      if (!extra) return;
      for (const r of extra) {
        if (!strictIds.has(r.episode_id)) {
          strictRows.push(r);
          strictIds.add(r.episode_id);
        }
      }
    };

    // Pass 2 — drop phrase requirement
    if (FF.threePassMust && strictRows.length < 5 && mustGateApplied && phrasePool.length) {
      const noPhraseTerms = requiredTerms.filter((t) => !phrasePool.includes(t));
      if (noPhraseTerms.length !== requiredTerms.length) {
        const retry = await supa.rpc("search_episodes_hybrid", {
          q: lexQ,
          q_embedding: q_embedding ? `[${q_embedding.join(",")}]` : null,
          limit_n: Math.max(limit, 50),
          lang,
          required_terms: noPhraseTerms.length ? noPhraseTerms : null,
          entity_terms: entityTerms.length ? entityTerms : null,
          alpha_lex: alphaLex,
          p_decay_lambda: decayLambda,
          phrase_terms: phraseTerms.length ? phraseTerms : null,
        });
        if (!retry.error) { appendNew(retry.data); mustGateRelaxed = true; }
      }
    }

    // Pass 3 — relaxed gate
    if (FF.threePassMust && strictRows.length < 5 && mustGateApplied) {
      const strictTerms = requiredTerms.filter((t) => t.includes(" ") && !phrasePool.includes(t));
      const relaxedTerms = strictTerms.length ? strictTerms : null;
      if ((relaxedTerms?.join("|") || "") !== requiredTerms.join("|")) {
        const retry = await supa.rpc("search_episodes_hybrid", {
          q: lexQ,
          q_embedding: q_embedding ? `[${q_embedding.join(",")}]` : null,
          limit_n: Math.max(limit, 50),
          lang,
          required_terms: relaxedTerms,
          entity_terms: entityTerms.length ? entityTerms : null,
          alpha_lex: alphaLex,
          p_decay_lambda: decayLambda,
          phrase_terms: phraseTerms.length ? phraseTerms : null,
        });
        if (!retry.error) { appendNew(retry.data); mustGateRelaxed = true; }
      }
    }

    // Pass 4 — drop gate
    if (FF.threePassMust && strictRows.length < 5 && mustGateApplied && q_embedding && !isTickerQ && phrasePool.length === 0) {
      const retry2 = await supa.rpc("search_episodes_hybrid", {
        q: lexQ,
        q_embedding: `[${q_embedding.join(",")}]`,
        limit_n: Math.max(limit, 50),
        lang,
        required_terms: null,
        entity_terms: entityTerms.length ? entityTerms : null,
        alpha_lex: Math.min(alphaLex, 0.35),
        p_decay_lambda: decayLambda,
        phrase_terms: phraseTerms.length ? phraseTerms : null,
      });
      if (!retry2.error) { appendNew(retry2.data); mustGateDropped = true; }
    }

    // Entity pyramid fallback
    let sectorFallback = false;
    let sectorHint: string | null = null;
    let fallbackKind: "ticker" | "person" | "company" | null = null;
    if (FF.entityPyramid && strictRows.length === 0) {
      let entityName: string | null = null;
      let contextTerms: string | null = null;

      if (isTickerQ && marketSymbol) {
        fallbackKind = "ticker";
        entityName = symbolAliases[0]
          || rawEntities.find((t) => t.toUpperCase() !== marketSymbol)
          || (curated.expansions || [])[0]
          || marketSymbol;
        contextTerms = MARKET_SYMBOL_SECTORS[marketSymbol.toLowerCase()] || null;
      } else if (understanding?.intent === "person" || understanding?.intent === "company") {
        const primaryEntity = rawEntities.find((t) => t.includes(" ")) || rawEntities[0];
        if (primaryEntity) {
          fallbackKind = understanding.intent as "person" | "company";
          entityName = primaryEntity;
          const ctx = uniqueClean([
            ...((understanding.expanded_terms as string[]) || []),
            ...((understanding.synonyms as string[]) || []),
          ], 6).filter((t) => t.toLowerCase() !== primaryEntity.toLowerCase());
          if (ctx.length) contextTerms = ctx.join(" ");
        }
      }

      if (entityName && contextTerms) {
        const sectorQText = `${entityName} ${contextTerms}`.trim();
        const sectorEmb = await embed(sectorQText);
        if (sectorEmb) {
          const retry3 = await supa.rpc("search_episodes_hybrid", {
            q: entityName,
            q_embedding: `[${sectorEmb.join(",")}]`,
            limit_n: Math.max(limit, 30),
            lang,
            required_terms: null,
            entity_terms: null,
            alpha_lex: 0.15,
          });
          if (!retry3.error && retry3.data?.length) {
            appendNew(retry3.data);
            sectorFallback = true;
            sectorHint = contextTerms.split(/\s+/).slice(0, 6).join(" ");
          }
        }
      }
    }

    // Known-item podcast pin (P0 — strict podcast-title intent)
    let podcastPinSlug: string | null = null;
    let podcastPinTitle: string | null = null;
    let podcastPinImage: string | null = null;
    let podcastPinDescription: string | null = null;
    let podcastPinMatchType: string | null = null;
    let podcastPinSimilarity: number | null = null;
    let podcastPinIds: string[] = [];
    if (!isTickerQ && qNorm.length >= 3 && qNorm.length <= 60) {
      const cleanedQ = qNorm.replace(/\b(podcast|podcasts|show|shows|episode|episodes|epizod|musor)\b/g, " ").replace(/\s+/g, " ").trim() || qNorm;
      const pmRes = await withTimeout(
        supa.rpc("match_podcast_by_name", { p_q: cleanedQ, p_max: 1, p_threshold: 0.45 }).then((r: any) => r.data),
        1200, "match_podcast_by_name",
      );
      const top = Array.isArray(pmRes) && pmRes.length ? (pmRes[0] as any) : null;
      const sim = top && (typeof top.similarity === "number" ? top.similarity : (typeof top.sim === "number" ? top.sim : 0));
      const mtype = top?.match_type as string | undefined;
      // Pin ONLY on word-boundary matches (alias/exact/token/prefix).
      // Never on `substr` (in-word match like "irodalom" ⊂ "birodalom") or
      // `trgm` (fuzzy) — those produced false positives where a query word
      // appeared as a substring inside an unrelated podcast title.
      const pinAllowed = top && (
        mtype === "alias" || mtype === "exact" || mtype === "token" || mtype === "prefix"
      );
      if (pinAllowed) {
        podcastPinSlug = top.slug;
        podcastPinTitle = top.title;
        podcastPinMatchType = mtype || null;
        podcastPinSimilarity = sim;
        const [{ data: pinMeta }, { data: pinEps }] = await Promise.all([
          supa.from("podcasts").select("image_url,description,summary").eq("id", top.podcast_id).maybeSingle(),
          supa.from("episodes").select("id").eq("podcast_id", top.podcast_id)
            .order("published_at", { ascending: false, nullsFirst: false }).limit(8),
        ]);
        if (pinMeta) {
          podcastPinImage = (pinMeta as any).image_url || null;
          podcastPinDescription = (pinMeta as any).description || (pinMeta as any).summary || null;
        }
        if (pinEps?.length) podcastPinIds = pinEps.map((e: any) => e.id);
        for (const id of podcastPinIds) {
          if (!strictIds.has(id)) {
            strictRows.unshift({ episode_id: id, lex_score: 1, sem_score: 1, hybrid_score: 1 } as any);
            strictIds.add(id);
            strictHitIds.add(id);
          }
        }
      }
    }

    // Confidence band
    const strictCount = strictHitIds.size;
    let confidenceBand: "high" | "medium" | "low";
    if (sectorFallback || mustGateDropped) confidenceBand = "low";
    else if (mustGateApplied && strictCount >= 5 && !mustGateRelaxed) confidenceBand = "high";
    else if (strictCount >= 3) confidenceBand = "medium";
    else confidenceBand = "low";

    // Chunk augmentation (v13 — disabled by default; episode_chunks not yet shipped)
    let chunkAugmented = 0;
    if (FF.chunkAugment && q_embedding && strictRows.length < 30) {
      try {
        const { data: chunkRows } = await supa.rpc("search_episode_chunks", {
          query_embedding: `[${q_embedding.join(",")}]`,
          match_count: 30,
          candidate_pool: 400,
        });
        const cr = (chunkRows as any[]) || [];
        for (const c of cr) {
          if (strictIds.has(c.episode_id)) continue;
          strictRows.push({
            episode_id: c.episode_id,
            lex_score: 0,
            sem_score: c.similarity || 0,
            hybrid_score: (c.similarity || 0) * 0.92,
            chunk_source: c.best_source,
          } as any);
          strictIds.add(c.episode_id);
          chunkAugmented++;
          if (chunkAugmented >= 20) break;
        }
      } catch (err) {
        console.warn("chunk_augment_failed", err);
      }
    }

    rows = strictRows;
    const tRpc = Date.now() - t0 - tEmb;

    const ids = (rows || []).map((r: any) => r.episode_id);
    if (ids.length === 0) {
      return new Response(JSON.stringify({ episodes: [], understanding, timing: { embed_ms: tEmb, rpc_ms: tRpc }, semantic: !!q_embedding, cache_hit: cacheHit, must_gate: mustGateApplied, must_gate_relaxed: mustGateRelaxed, must_gate_dropped: mustGateDropped, confidence_band: "low", rare_tokens: rareTokens }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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

    // Cohere reranker
    let cohereRerankUsed = false;
    let cohereLatency = 0;
    if (
      FF.cohere &&
      ordered.length >= 10 &&
      (confidenceBand === "high" || confidenceBand === "medium") &&
      !sectorFallback
    ) {
      const candidates: CohereRerankInput[] = ordered.slice(0, 30).map((e: any) => ({
        id: e.id,
        text: `${e.podcasts?.title || ""} — ${e.title || ""}\n${(e.ai_summary || e.summary || e.description || "").slice(0, 500)}`,
      }));
      const co = await cohereRerank(supa, q, candidates, Math.min(30, candidates.length));
      if (co && co.ids.length) {
        cohereRerankUsed = true;
        cohereLatency = co.latency_ms;
        const rank = new Map(co.ids.map((id, i) => [id, i]));
        const head = ordered
          .filter((e: any) => rank.has(e.id))
          .sort((a: any, b: any) => (rank.get(a.id)! - rank.get(b.id)!));
        const tail = ordered.filter((e: any) => !rank.has(e.id));
        ordered = [...head, ...tail];
      }
    }

    // Gemini reranker fallback
    let rerankResult: { ids: string[]; why: Record<string, string> } | null = null;
    let rerankCacheHit = false;
    if (wantRerank && !cohereRerankUsed) {
      if (cachedRerank) {
        const present = new Set(ordered.map((e: any) => e.id));
        const filteredIds = cachedRerank.ids.filter((id) => present.has(id));
        if (filteredIds.length >= 5) {
          rerankResult = { ids: filteredIds, why: cachedRerank.why };
          rerankCacheHit = true;
        }
      }
      if (!rerankResult) {
        rerankResult = await rerank(q, ordered);
        if (rerankResult && rerankResult.ids.length) {
          supa.from("search_query_cache").update({
            rerank: { ids: rerankResult.ids, why: rerankResult.why, __rv: RANKING_VERSION },
            rerank_updated_at: new Date().toISOString(),
          }).eq("q_norm", qNorm).then(() => {}, (e) => console.warn("rerank cache write", e));
        }
      }
    }
    const tRerank = Date.now() - t0 - tEmb - tRpc;

    if (rerankResult && rerankResult.ids.length) {
      const idx = new Map(rerankResult.ids.map((id, i) => [id, i]));
      ordered = ordered
        .map((e: any) => ({
          e,
          pin: strictHitIds.has(e.id) ? 0 : 1,
          r: idx.has(e.id) ? idx.get(e.id)! : 999 + (orderMap.get(e.id) ?? 0),
        }))
        .sort((a, b) => a.pin - b.pin || a.r - b.r)
        .map((x) => {
          const why = rerankResult!.why[x.e.id];
          return why ? { ...x.e, why_matched: why } : x.e;
        });
    }

    // Entity-pinning boost
    const pinEntities = uniqueClean([
      ...((understanding?.entities as string[]) || []),
    ], 6).map((s) => s.toLowerCase()).filter((s) => s.length >= 3);
    if (pinEntities.length) {
      const strictBrandMatch = (e: any): boolean => {
        const arrays: string[] = [
          ...(Array.isArray(e.people) ? e.people : []),
          ...(Array.isArray(e.companies) ? e.companies : []),
          ...(Array.isArray(e.tickers) ? e.tickers : []),
        ].map((s) => String(s || "").toLowerCase());
        if (!arrays.length) return false;
        return pinEntities.some((ent) => arrays.some((v) => v === ent || v.includes(ent)));
      };
      const matchEntity = (e: any): boolean => {
        const hayParts = [
          e.title || "",
          (Array.isArray(e.people) ? e.people.join(" ") : ""),
          (Array.isArray(e.companies) ? e.companies.join(" ") : ""),
          (Array.isArray(e.tickers) ? e.tickers.join(" ") : ""),
          (Array.isArray(e.topics) ? e.topics.join(" ") : ""),
        ];
        const hay = hayParts.join(" ").toLowerCase();
        return pinEntities.some((ent) => {
          const re = new RegExp(`(?:^|[^a-z0-9])${ent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`);
          return re.test(hay);
        });
      };
      const annotated = ordered.map((e: any) => ({
        e,
        strict: strictBrandMatch(e),
        hit: matchEntity(e),
      }));
      const strictBrand = annotated.filter((x) => x.strict).map((x) => x.e);
      const looseHits = annotated.filter((x) => !x.strict && x.hit).map((x) => x.e);
      const misses = annotated.filter((x) => !x.strict && !x.hit).map((x) => x.e);
      if (strictBrand.length > 0 || looseHits.length > 0) {
        const strictHead = strictBrand.slice(0, 6);
        const strictTail = strictBrand.slice(6);
        ordered = [...strictHead, ...looseHits, ...strictTail, ...misses];
      }
    }

    // MMR diversity
    const diversify = (list: any[]): any[] => {
      if (list.length <= 5) return list;
      const caps: Array<{ until: number; max: number }> = [
        { until: 10, max: 2 },
        { until: 20, max: 3 },
      ];
      const counts = new Map<string, number>();
      const kept: any[] = [];
      const overflow: any[] = [];
      for (const e of list) {
        const pid = e.podcast_id || e.podcasts?.slug || "unknown";
        if (strictHitIds.has(e.id)) {
          kept.push(e);
          counts.set(pid, (counts.get(pid) || 0) + 1);
          continue;
        }
        const pos = kept.length;
        const cap = caps.find((c) => pos < c.until);
        const cur = counts.get(pid) || 0;
        if (cap && cur >= cap.max) { overflow.push(e); continue; }
        kept.push(e);
        counts.set(pid, cur + 1);
      }
      return [...kept, ...overflow];
    };
    if (FF.mmrDiversity) ordered = diversify(ordered);

    // Final podcast pin
    if (podcastPinIds.length) {
      const pinSet = new Set(podcastPinIds);
      const pinned = ordered.filter((e: any) => pinSet.has(e.id));
      const rest = ordered.filter((e: any) => !pinSet.has(e.id));
      pinned.sort((a: any, b: any) => podcastPinIds.indexOf(a.id) - podcastPinIds.indexOf(b.id));
      ordered = [...pinned, ...rest];
    }

    return new Response(
      JSON.stringify({
        episodes: ordered.slice(0, limit),
        understanding,
        curated_synonyms: { matched: curated.matched_terms, expansions: curated.expansions },
        semantic: !!q_embedding,
        reranked: !!rerankResult,
        rerank_cache_hit: rerankCacheHit,
        cache_hit: cacheHit,
        must_gate: mustGateApplied,
        must_gate_relaxed: mustGateRelaxed,
        must_gate_dropped: mustGateDropped,
        sector_fallback: sectorFallback,
        sector_hint: sectorHint,
        fallback_kind: fallbackKind,
        ticker_symbol: isTickerQ ? marketSymbol : null,
        confidence_band: confidenceBand,
        rare_tokens: rareTokens,
        spell_corrections: spellCorrections.length ? spellCorrections : undefined,
        podcast_pin: podcastPinSlug ? {
          slug: podcastPinSlug,
          title: podcastPinTitle,
          image_url: podcastPinImage,
          description: podcastPinDescription,
          match_type: podcastPinMatchType,
          similarity: podcastPinSimilarity,
          latest_episode_ids: podcastPinIds,
        } : null,
        cohere_used: cohereRerankUsed,
        cohere_latency_ms: cohereLatency || undefined,
        hyde_used: hydeUsed,
        hyde_cache_hit: hydeCacheHit,
        chunk_augmented: chunkAugmented || undefined,
        engine: `v${engN}`,
        timing: { embed_ms: tEmb, rpc_ms: tRpc, rerank_ms: tRerank, total_ms: Date.now() - t0 },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("search-hybrid err", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
