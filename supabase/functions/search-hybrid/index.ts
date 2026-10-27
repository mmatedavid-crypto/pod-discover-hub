// Search hybrid endpoint: lexical (tsv+trgm) + semantic (vector RRF) + AI re-rank.
// v13 is the default engine with v12 as fallback. Transcript chunk augmentation
// is implemented but operator-controlled through app_settings.search_engine:
// default off until timestamped chunk quality gates are trusted in production.
// POST { q: string, limit?: number, lang?: 'en'|'hu'|null, rerank?: boolean, engine?: string }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { understandQuery, buildExpandedQuery, detectAdjNounTopic, type Understanding } from "../_shared/search-understand.ts";
import { loadCuratedSynonyms } from "../_shared/search-synonyms.ts";
import { getHydeExpansion, blendEmbeddings } from "../_shared/search-hyde.ts";
import { cohereRerank, type CohereRerankInput } from "../_shared/cohere-rerank.ts";
import { detectBot } from "../_shared/bot-detect.ts";
import { callLovableAI } from "../_shared/lovable-ai.ts";
import { createFullNameMatcher, foldSearchName, fullNameTsQuery, isNameShapedQuery, nameEvidenceTier, rankFullNameMatches } from "../_shared/search-name-match.ts";
import { cleanTextNameTsQuery, isPersonEvidenceCandidate, personIdentityState, rankPersonEvidence, type PersonCandidate, type PersonLink } from "../_shared/search-person-evidence.ts";
import { episodeExactFields, exactCleanTextTsQuery, exactMatchLabel, exactPhraseMatch, exactWebsearchQuery, parseExactPhraseQuery, type ExactPhraseQuery } from "../_shared/search-exact-phrase.ts";
import { detectTemporalIntent, isTemporalToken, preferWithinWindow } from "../_shared/search-temporal.ts";
import { podcastPinAllowed, wordAlignedMatch } from "../_shared/search-podcast-pin.ts";
import { rankByTermCoverage } from "../_shared/search-term-coverage.ts";
import {
  applyVerification, buildVerifyMessages, cleanConcepts, complexLexicalQuery, complexSemanticText, isNameOnlyQuery,
  looksComplex, meaningfulTokens, parseVerifyGrades, useComplexPath, VERIFY_CACHE_VERSION, VERIFY_MAX_CANDIDATES,
  VERIFY_PROMPT_VERSION, VERIFY_TOOL, type VerifyCandidate, type VerifyGrade,
} from "../_shared/search-complex.ts";

// Per-query cap for the person-first branch; a slow source degrades to fewer
// results instead of pushing the request past the client timeout.
const PERSON_STRICT_QUERY_MS = 2500;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const AGENT_SEARCH_KEY = Deno.env.get("AGENT_SEARCH_KEY") || "";

// Constant-time comparison of the internal agent-search key header.
function isTrustedAgentSearch(req: Request): boolean {
  const got = req.headers.get("x-podiverzum-agent-key") || "";
  if (!AGENT_SEARCH_KEY || AGENT_SEARCH_KEY.length < 32 || got.length !== AGENT_SEARCH_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ AGENT_SEARCH_KEY.charCodeAt(i);
  return diff === 0;
}
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

const EPISODE_SELECT =
  "id,title,display_title,slug,image_url,published_at,summary,description,ai_summary,topics,people,companies,tickers,ingredients,audio_url,podcast_id,podcasts!inner(slug,title,display_title,image_url,category,podiverzum_rank,rank_label,rss_status,language,language_decision)";

function isAcceptedHungarianPodcast(p: any): boolean {
  if (!p) return false;
  if (p.rss_status === "failed" || p.rss_status === "inactive") return false;
  return p.language_decision === "accept_hungarian";
}

function isSafePublicPerson(p: any): boolean {
  if (!p || p.is_public !== true || p.is_indexable !== true) return false;
  if (!["indexable", "manual_approved", "active", null, undefined].includes(p.activation_status)) return false;
  if (["hide", "reject"].includes(p.ai_recommended_action || "")) return false;
  if (["needs_human_review", "duplicate_candidate"].includes(p.ai_review_status || "")) return false;
  if (p.identity_status === "split_resolved") return false;
  const trustedWiki = p.wikipedia_match_status === "verified" && Number(p.wikipedia_match_confidence || 0) >= 0.8;
  const temporalTopicOnly = p.has_archival_evidence !== true && p.manual_approved !== true && (
    p.is_deceased === true
    || p.is_historical === true
    || p.persona === "historical"
    || p.date_of_death
    || p.is_living === false
  );
  if (temporalTopicOnly) return false;
  if (p.identity_ambiguous && !p.manual_approved && !trustedWiki) return false;
  return Number(p.gated_episode_count || p.episode_count || 0) >= 1;
}

function hasStrongPersonEvidence(p: any): boolean {
  if (!p) return false;
  if (p.manual_approved === true || p.has_archival_evidence === true) return true;
  return (
    Number(p.participant_count || 0)
    + Number(p.host_count || 0)
    + Number(p.guest_count || 0)
  ) >= 2;
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => { console.warn(`${label} timeout ${ms}ms`); resolve(null); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); console.warn(`${label} err`, e); resolve(null); });
  });
}

function normalizeQ(q: string): string {
  return q.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().slice(0, 200);
}

function foldText(s: string): string {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function hasAcceptedOrganizationAlias(supa: ReturnType<typeof createClient>, qNorm: string, timeoutMs = 650): Promise<boolean> {
  if (qNorm.length < 2 || qNorm.length > 80) return false;
  const aliasRows = await withTimeout(
    supa
      .from("organization_aliases")
      .select("organization_id,organizations!inner(id,is_public,is_indexable)")
      .eq("normalized_alias", qNorm)
      .eq("status", "accepted")
      .limit(1)
      .then((r: any) => r.data),
    timeoutMs,
    "org_alias_conflict_table",
  );
  return Boolean(Array.isArray(aliasRows) && aliasRows.some((r: any) => r?.organizations?.is_indexable !== false && r?.organizations?.is_public !== false));
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
  mtel: ["Magyar Telekom"],
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
  mtel: "telekommunikáció mobilszolgáltató internet kábeltévé",
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

type NaturalQuestionPlan = {
  isQuestion: boolean;
  coreTerms: string[];
  expandedTerms: string[];
  lexicalQuery: string;
  semanticText: string;
};

const HU_QUESTION_STARTERS = new Set([
  "mi", "mit", "mire", "miert", "hogyan", "hogy", "mikor", "hol", "hova", "honnan",
  "melyik", "milyen", "mennyi", "kinek", "kivel", "kitol", "kell", "lehet", "erdemes",
]);
const HU_NLQ_FILLER = new Set([
  ...RARE_GATE_STOPWORDS,
  "keresek", "keresnek", "talalok", "ajanlas", "ajanlj", "ajanlotok", "szeretnek",
  "tudok", "tudom", "legyen", "legjobb", "jo", "jobb", "tema", "temaban",
  "kapcsan", "rol", "roluk", "szol", "szolnak", "szolo", "valami", "valamilyen",
  "beszeltek", "beszelnek", "beszelt", "mondtak", "mondanak",
]);

const NLQ_DOMAIN_EXPANSIONS: Array<{ re: RegExp; terms: string[] }> = [
  { re: /\b(gyerek|gyermek|baba|csecsemo|szulo|szulok|anyuka|apuka)\b/, terms: ["gyerek", "gyermek", "baba", "csecsemő", "szülőség", "gyereknevelés"] },
  { re: /\b(csukl|csuklik|csuklas)\b/, terms: ["csuklás", "csuklik", "rekeszizom", "gyerekorvos", "egészség"] },
  { re: /\b(alvas|alszik|altatas|ebred|ebredes)\b/, terms: ["alvás", "altatás", "alvászavar", "gyereknevelés"] },
  { re: /\b(szorong|stressz|panik|depresszio|kieges)\b/, terms: ["mentális egészség", "szorongás", "stressz", "pszichológia", "terápia"] },
  { re: /\b(befektet|reszveny|tozsde|penz|megtakarit|hitel|inflacio)\b/, terms: ["befektetés", "tőzsde", "pénzügy", "megtakarítás", "gazdaság"] },
  { re: /\b(ai|chatgpt|mesterséges|intelligencia|robot|automatizalas)\b/, terms: ["mesterséges intelligencia", "AI", "technológia", "automatizálás"] },
  { re: /\b(valasztas|kormany|parlament|part|fidesz|tisza|ellenzek)\b/, terms: ["politika", "közélet", "választás", "parlament"] },
  { re: /\b(tortenelem|haboru|trianon|rendszervaltas|kommunizmus)\b/, terms: ["történelem", "magyar történelem", "háború", "közélet"] },
  { re: /\b(egeszseg|beteg|tunet|orvos|terapia|gyogyszer)\b/, terms: ["egészség", "orvos", "tünetek", "terápia"] },
];

function stripHuPossessive(token: string): string {
  let t = token;
  const suffixes = [
    "aimnak", "eimnek", "unknak", "unknek", "emnek", "amnak", "omnak",
    "oknak", "eknek", "aknak", "ban", "ben", "nak", "nek", "rol", "rol",
    "bol", "bol", "tol", "tol", "hoz", "hez", "hoz", "val", "vel",
    "kent", "ert", "ig", "on", "en", "ot", "et", "at", "em", "am", "om", "unk", "unk",
  ];
  for (const s of suffixes) {
    if (t.length > s.length + 3 && t.endsWith(s)) {
      t = t.slice(0, -s.length);
      break;
    }
  }
  return t;
}

function deriveNaturalQuestionPlan(q: string, qNorm: string): NaturalQuestionPlan {
  // Recency words ("mostanában", "a héten") say when, not what: never search for them as topics.
  const tokens = qNorm.split(/[^a-z0-9]+/).filter((t) => t && !isTemporalToken(t));
  const startsLikeQuestion = tokens.length > 0 && HU_QUESTION_STARTERS.has(tokens[0]);
  const hasQuestionMark = q.includes("?");
  const isQuestion = hasQuestionMark || startsLikeQuestion || /\b(miert|hogyan|milyen|melyik|mitol|mit tegyek|erdemes|lehet-e)\b/.test(qNorm);
  if (!isQuestion) return { isQuestion: false, coreTerms: [], expandedTerms: [], lexicalQuery: q, semanticText: q };

  const core = uniqueClean(tokens
    .map(stripHuPossessive)
    .filter((t) => t.length >= 3 && !HU_NLQ_FILLER.has(t) && !/^\d+$/.test(t)), 8);

  const expansions: string[] = [];
  for (const rule of NLQ_DOMAIN_EXPANSIONS) {
    if (rule.re.test(qNorm) || core.some((t) => rule.re.test(t))) expansions.push(...rule.terms);
  }
  for (const t of core) {
    expansions.push(t);
    if (t.endsWith("ik") && t.length > 5) expansions.push(`${t.slice(0, -2)}ás`);
    if (t.endsWith("ul") && t.length > 5) expansions.push(`${t.slice(0, -2)}ás`);
    if (t === "gyerek") expansions.push("gyermek", "gyereknevelés", "szülőség");
    if (t === "csukl") expansions.push("csuklás", "csuklik");
  }
  const expandedTerms = uniqueClean(expansions, 14);
  const lexicalTerms = uniqueClean([...core, ...expandedTerms], 12);
  const lexicalQuery = lexicalTerms.length
    ? lexicalTerms.map(quoteWebSearchTerm).join(" OR ")
    : q;
  const semanticText = uniqueClean([...core, ...expandedTerms], 14).join(" ");
  return {
    isQuestion: true,
    coreTerms: core,
    expandedTerms,
    lexicalQuery,
    semanticText: `Magyar podcast epizód erről a kérdésről: ${q}. Kapcsolódó témák: ${semanticText || q}.`,
  };
}

async function embedRaw(q: string): Promise<number[] | null> {
  // Lovable AI Gateway first; the legacy direct Google key is only a fallback.
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (lovableKey) {
    try {
      const r = await fetch("https://ai.gateway.lovable.dev/v1/embeddings", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
        body: JSON.stringify({ model: "google/gemini-embedding-001", input: q, dimensions: 768 }),
      });
      if (r.ok) {
        const j = await r.json();
        const v = j?.data?.[0]?.embedding as number[] | undefined;
        if (v && v.length === 768) return v;
      } else {
        console.warn("embed gateway http", r.status);
      }
    } catch (e) { console.warn("embed gateway err", e); }
  }
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

// Public search must return well under the platform/client timeout. A missing
// embedding degrades to lexical-only; cached embeddings still keep the high
// quality path hot for common queries.
const embed = (q: string, timeoutMs = 2200) => withTimeout(embedRaw(q), timeoutMs, "embed");

async function rerankWithReasons(q: string, items: any[]): Promise<{ ids: string[]; why: Record<string, string> } | null> {
  if (items.length < 5) return null;
  const top = items.slice(0, 30);
  const compact = top.map((e, i) => ({
    i, id: e.id,
    t: (e.title || "").slice(0, 140),
    s: (e.ai_summary || e.summary || "").slice(0, 220),
    p: e.podcasts?.title?.slice(0, 60) ?? "",
  }));
  try {
    const inputText = `${q}\n${compact.map((e) => `${e.t} ${e.p} ${e.s}`).join("\n")}`;
    const ai = await callLovableAI({
      model: "google/gemini-2.5-flash-lite",
      job_type: "search_hybrid_rerank",
      target_type: "search_query",
      prompt_version: "search-hybrid-rerank-v2",
      input_text: inputText,
      min_input_chars: 50,
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
    });
    if (!ai.ok) { console.warn("rerank ai skipped/error", ai.status, ai.error); return null; }
    const j = ai.data;
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
const rerank = (q: string, items: any[], timeoutMs = 3000) => withTimeout(rerankWithReasons(q, items), timeoutMs, "rerank");

async function resolvePodcastPin(supa: ReturnType<typeof createClient>, q: string, qNorm: string, limit: number, timeoutMs = 900) {
  if (qNorm.length < 2 || qNorm.length > 60) return null;
  const cleanedQ = qNorm.replace(/\b(podcast|podcasts|show|shows|episode|episodes|epizod|musor)\b/g, " ").replace(/\s+/g, " ").trim() || qNorm;
  const pmRes = await withTimeout(
    supa.rpc("match_podcast_by_name", { p_q: cleanedQ, p_max: 1, p_threshold: 0.45 }).then((r: any) => r.data),
    timeoutMs, "match_podcast_by_name",
  );
  const top = Array.isArray(pmRes) && pmRes.length ? (pmRes[0] as any) : null;
  const sim = top && (typeof top.similarity === "number" ? top.similarity : (typeof top.sim === "number" ? top.sim : 0));
  const mtype = top?.match_type as string | undefined;
  // Hard pin only when the visitor typed the show's name. A partial title match (AI → Airbag,
  // Budapest → Budapest Park, partiz → Partizán) is a soft match: its episodes join the candidate
  // pool and must earn their position in ranking instead of being pinned above everything.
  if (!top) return null;
  const hardPin = podcastPinAllowed(cleanedQ, String(top.title || ""), mtype);
  const softPin = !hardPin && (mtype === "token" || mtype === "prefix" || mtype === "slug_prefix");
  if (!hardPin && !softPin) return null;

  const [{ data: pinMeta }, { data: pinEps }] = await Promise.all([
    supa.from("podcasts").select("image_url,description,summary,rss_status,language_decision").eq("id", top.podcast_id).maybeSingle(),
    supa.from("episodes").select(EPISODE_SELECT).eq("podcast_id", top.podcast_id)
      .order("published_at", { ascending: false, nullsFirst: false }).limit(Math.max(8, Math.min(30, limit))),
  ]);
  if (!isAcceptedHungarianPodcast(pinMeta)) return null;
  const episodes = (pinEps || []).filter((e: any) => {
    return isAcceptedHungarianPodcast(e.podcasts);
  });
  return {
    podcast_id: top.podcast_id,
    slug: top.slug,
    title: top.title,
    image_url: (pinMeta as any)?.image_url || null,
    description: (pinMeta as any)?.description || (pinMeta as any)?.summary || null,
    match_type: mtype || null,
    similarity: sim,
    episodes,
    latest_episode_ids: episodes.map((e: any) => e.id).slice(0, 8),
    soft: softPin,
  };
}

async function resolvePersonPin(supa: ReturnType<typeof createClient>, qNorm: string, anchors: CatalogAnchor[], timeoutMs = 900) {
  if (qNorm.length < 2 || qNorm.length > 80) return null;
  const anchor = anchors.find((a) => a.kind === "person" && a.id);
  let personId = anchor?.id || null;

  if (!personId) {
    const aliasRows = await withTimeout(
      supa
        .from("person_aliases")
        .select("person_id,confidence,people!inner(id,is_public,is_indexable,activation_status,ai_recommended_action,ai_review_status,identity_status,identity_ambiguous,manual_approved,wikipedia_match_status,wikipedia_match_confidence,is_deceased,is_historical,has_archival_evidence,persona,is_topic_only,date_of_death,is_living,participant_count,host_count,guest_count,gated_episode_count,episode_count)")
        .eq("normalized_alias", qNorm)
        .eq("status", "accepted")
        .gte("confidence", 0.7)
        .order("confidence", { ascending: false, nullsFirst: false })
        .limit(1)
        .then((r: any) => r.data),
      timeoutMs,
      "person_pin_alias",
    );
    const alias = Array.isArray(aliasRows) && aliasRows.length ? aliasRows[0] : null;
    personId = alias?.person_id || alias?.people?.id || null;
  }

  if (!personId) return null;

  const person = await withTimeout(
    supa
      .from("people")
      .select("id,name,slug,image_url,short_bio,ai_bio,overview_text,wikipedia_description,disambiguation_label,gated_episode_count,episode_count,podcast_count,is_public,is_indexable,activation_status,ai_recommended_action,ai_review_status,identity_status,normalized_name,identity_ambiguous,manual_approved,ai_bio_status,ai_bio_confidence,wikipedia_match_status,wikipedia_match_confidence,is_deceased,is_historical,has_archival_evidence,persona,is_topic_only,date_of_death,is_living,participant_count,host_count,guest_count")
      .eq("id", personId)
      .eq("is_public", true)
      .eq("is_indexable", true)
      .maybeSingle()
      .then((r: any) => r.data),
    timeoutMs,
    "person_pin_meta",
  );
  if (!person?.slug || !person?.name || !isSafePublicPerson(person)) return null;
  const orgAliasConflict = await hasAcceptedOrganizationAlias(supa, qNorm, Math.min(timeoutMs, 650)).catch(() => false);
  if (orgAliasConflict && !hasStrongPersonEvidence(person)) return null;

  return {
    id: person.id,
    slug: person.slug,
    name: person.name,
    image_url: person.image_url || null,
    short_bio: person.short_bio || person.overview_text || person.wikipedia_description || null,
    ai_bio: person.ai_bio || null,
    disambiguation_label: person.disambiguation_label || null,
    is_public: person.is_public ?? null,
    is_indexable: person.is_indexable ?? null,
    activation_status: person.activation_status ?? null,
    ai_recommended_action: person.ai_recommended_action ?? null,
    ai_review_status: person.ai_review_status ?? null,
    identity_status: person.identity_status ?? null,
    gated_episode_count: person.gated_episode_count ?? person.episode_count ?? null,
    episode_count: person.episode_count ?? null,
    podcast_count: person.podcast_count ?? null,
    identity_ambiguous: person.identity_ambiguous ?? null,
    manual_approved: person.manual_approved ?? null,
    ai_bio_status: person.ai_bio_status ?? null,
    ai_bio_confidence: person.ai_bio_confidence ?? null,
    wikipedia_match_status: person.wikipedia_match_status ?? null,
    wikipedia_match_confidence: person.wikipedia_match_confidence ?? null,
    is_deceased: person.is_deceased ?? null,
    is_historical: person.is_historical ?? null,
    has_archival_evidence: person.has_archival_evidence ?? null,
    match_type: anchor ? "catalog_anchor" : "alias",
  };
}

async function resolveOrganizationPin(supa: ReturnType<typeof createClient>, qNorm: string, anchors: CatalogAnchor[], marketSymbol: string | null, timeoutMs = 900) {
  if (qNorm.length < 2 || qNorm.length > 80) return null;
  const symbolAliases = marketSymbol ? (MARKET_SYMBOL_ALIASES[marketSymbol.toLowerCase()] || []) : [];
  const anchor = anchors.find((a) => a.kind === "organization" && a.id)
    || anchors.find((a) => a.kind === "organization" && symbolAliases.some((alias) => foldText(alias) === foldText(a.name)));
  let organizationId = anchor?.id || null;

  if (!organizationId) {
    const aliasNorms = uniqueClean([
      qNorm,
      marketSymbol ? normalizeQ(marketSymbol) : "",
      ...symbolAliases.map(normalizeQ),
    ], 8);
    const aliasRows = await withTimeout(
      supa
        .from("organization_aliases")
        .select("organization_id,alias,confidence,organizations!inner(id,is_public,is_indexable)")
        .in("normalized_alias", aliasNorms)
        .eq("status", "accepted")
        .gte("confidence", 0.45)
        .order("confidence", { ascending: false, nullsFirst: false })
        .limit(1)
        .then((r: any) => r.data),
      timeoutMs,
      "organization_pin_alias",
    );
    const alias = Array.isArray(aliasRows) && aliasRows.length ? aliasRows[0] : null;
    organizationId = alias?.organization_id || alias?.organizations?.id || null;
  }

  if (!organizationId) {
    const names = uniqueClean([qNorm, ...symbolAliases.map(normalizeQ)], 8);
    const orgRows = await withTimeout(
      supa
        .from("organizations")
        .select("id")
        .or(names.map((n) => `normalized_name.eq.${n}`).join(","))
        .eq("is_indexable", true)
        .order("gated_episode_count", { ascending: false, nullsFirst: false })
        .limit(1)
        .then((r: any) => r.data),
      timeoutMs,
      "organization_pin_name",
    );
    const org = Array.isArray(orgRows) && orgRows.length ? orgRows[0] : null;
    organizationId = org?.id || null;
  }

  if (!organizationId) return null;
  const org = await withTimeout(
    supa
      .from("organizations")
      .select("id,name,slug,org_type,logo_url,short_description_hu,ai_bio,wikipedia_extract,ticker,sector,gated_episode_count,episode_count,podcast_count,is_public,is_indexable")
      .eq("id", organizationId)
      .maybeSingle()
      .then((r: any) => r.data),
    timeoutMs,
    "organization_pin_meta",
  );
  if (!org?.slug || !org?.name || (!org.is_public && !org.is_indexable)) return null;
  const count = Number(org.gated_episode_count ?? org.episode_count ?? 0);
  if (count < 1) return null;

  return {
    id: org.id,
    slug: org.slug,
    name: org.name,
    kind: org.org_type || "company",
    image_url: org.logo_url || null,
    short_bio: org.short_description_hu || org.ai_bio || org.wikipedia_extract || null,
    ticker: org.ticker || (marketSymbol ? marketSymbol.toUpperCase() : null),
    sector: org.sector || null,
    gated_episode_count: org.gated_episode_count ?? org.episode_count ?? null,
    podcast_count: org.podcast_count ?? null,
    match_type: anchor ? "catalog_anchor" : "alias",
  };
}

async function resolveTopicPin(supa: ReturnType<typeof createClient>, qNorm: string, anchors: CatalogAnchor[], timeoutMs = 900) {
  if (qNorm.length < 2 || qNorm.length > 80) return null;
  const anchor = anchors.find((a) => a.kind === "topic" && a.id);
  let topicId = anchor?.id || null;

  if (!topicId) {
    const aliasRows = await withTimeout(
      supa
        .from("topic_aliases")
        .select("topic_id,alias,weight,topics!inner(id,is_public)")
        .eq("normalized_alias", qNorm)
        .eq("topics.is_public", true)
        .order("weight", { ascending: false, nullsFirst: false })
        .limit(1)
        .then((r: any) => r.data),
      timeoutMs,
      "topic_pin_alias",
    );
    const alias = Array.isArray(aliasRows) && aliasRows.length ? aliasRows[0] : null;
    topicId = alias?.topic_id || alias?.topics?.id || null;
  }

  if (!topicId) return null;
  const topic = await withTimeout(
    supa
      .from("topics")
      .select("id,name,slug,short_name,description,episode_count,podcast_count,is_public")
      .eq("id", topicId)
      .eq("is_public", true)
      .maybeSingle()
      .then((r: any) => r.data),
    timeoutMs,
    "topic_pin_meta",
  );
  if (!topic?.slug || !(topic?.name || topic?.short_name)) return null;
  const count = Number(topic.episode_count || 0);
  if (count < 1) return null;

  return {
    id: topic.id,
    slug: topic.slug,
    name: topic.name || topic.short_name,
    short_bio: topic.description || null,
    gated_episode_count: topic.episode_count ?? null,
    podcast_count: topic.podcast_count ?? null,
    match_type: anchor ? "catalog_anchor" : "alias",
  };
}

type CatalogAnchor = {
  kind: "podcast" | "person" | "organization" | "topic";
  id: string | null;
  name: string;
  slug: string | null;
  score: number;
};

async function resolveCatalogAnchors(supa: ReturnType<typeof createClient>, qNorm: string, earlyPodcastPin: any): Promise<CatalogAnchor[]> {
  if (qNorm.length < 2 || qNorm.length > 80) return [];
  const prefix = `${qNorm}%`;
  const infix = `%${qNorm}%`;
  const tasks = [
    supa.from("people")
      .select("id,name,slug,gated_episode_count,episode_count,normalized_name,is_public,is_indexable,activation_status,ai_recommended_action,ai_review_status,identity_status,identity_ambiguous,manual_approved,wikipedia_match_status,wikipedia_match_confidence,is_deceased,is_historical,has_archival_evidence,persona,is_topic_only,date_of_death,is_living,participant_count,host_count,guest_count")
      .eq("is_public", true)
      .eq("is_indexable", true)
      .in("activation_status", ["indexable", "manual_approved", "active"])
      .or(`normalized_name.eq.${qNorm},normalized_name.ilike.${prefix}`)
      .order("gated_episode_count", { ascending: false, nullsFirst: false })
      .limit(4),
    supa.from("person_aliases")
      .select("person_id,alias,confidence,people!inner(id,name,slug,is_public,is_indexable,activation_status,ai_recommended_action,ai_review_status,identity_status,identity_ambiguous,manual_approved,wikipedia_match_status,wikipedia_match_confidence,is_deceased,is_historical,has_archival_evidence,persona,is_topic_only,date_of_death,is_living,participant_count,host_count,guest_count,gated_episode_count,episode_count)")
      .eq("normalized_alias", qNorm)
      .eq("status", "accepted")
      .gte("confidence", 0.7)
      .limit(4),
    supa.from("organizations")
      .select("id,name,slug,gated_episode_count,normalized_name")
      .eq("is_indexable", true)
      .or(`normalized_name.eq.${qNorm},normalized_name.ilike.${prefix}`)
      .order("gated_episode_count", { ascending: false, nullsFirst: false })
      .limit(4),
    supa.from("organization_aliases")
      .select("organization_id,alias,confidence,organizations!inner(id,name,slug,is_indexable,gated_episode_count)")
      .eq("normalized_alias", qNorm)
      .gte("confidence", 0.5)
      .limit(4),
    supa.from("topics")
      .select("id,name,slug,short_name,episode_count")
      .eq("is_public", true)
      .or(`name.ilike.${infix},short_name.ilike.${infix}`)
      .order("episode_count", { ascending: false, nullsFirst: false })
      .limit(4),
    supa.from("topic_aliases")
      .select("alias,weight,topics!inner(id,name,slug,short_name,episode_count,is_public)")
      .eq("normalized_alias", qNorm)
      .eq("topics.is_public", true)
      .order("weight", { ascending: false, nullsFirst: false })
      .limit(4),
  ];

  // PostgREST builders are thenables, not Promises — they have no .catch().
  // Wrap with Promise.resolve() so a failing sub-query degrades to empty data
  // instead of throwing and killing the whole anchor resolution step.
  const settled = await Promise.all(
    tasks.map((p) => Promise.resolve(p).then((r: any) => r, (error: any) => ({ data: [], error }))),
  );
  const exactOrganizationAliasHit = ((settled[3] as any).data || []).some((row: any) => {
    const o = row.organizations;
    return o?.name && o.is_indexable !== false;
  });
  // Prefix/infix lookups above are only candidate fetches; an anchor must match on whole words
  // (alma ≠ Almási, mák ≠ makrogazdaság), otherwise it would pin unrelated people and topics.
  for (const i of [0, 2, 4]) {
    const r = settled[i] as any;
    r.data = (r.data || []).filter((row: any) => wordAlignedMatch(qNorm, String(row.name || "")) || (i === 4 && wordAlignedMatch(qNorm, String(row.short_name || ""))));
  }
  const out: CatalogAnchor[] = [];
  if (earlyPodcastPin?.title && !earlyPodcastPin.soft) {
    out.push({ kind: "podcast", id: earlyPodcastPin.podcast_id || null, name: earlyPodcastPin.title, slug: earlyPodcastPin.slug || null, score: 1000 });
  }
  for (const row of ((settled[0] as any).data || []).filter(isSafePublicPerson)) {
    if (exactOrganizationAliasHit && !hasStrongPersonEvidence(row)) continue;
    out.push({ kind: "person", id: row.id || null, name: row.name, slug: row.slug || null, score: 700 + Number(row.gated_episode_count || row.episode_count || 0) });
  }
  for (const row of (settled[1] as any).data || []) {
    const p = row.people;
    if (exactOrganizationAliasHit && !hasStrongPersonEvidence(p)) continue;
    if (p?.name && isSafePublicPerson(p)) out.push({ kind: "person", id: p.id || row.person_id || null, name: p.name, slug: p.slug || null, score: 760 + Number(p.gated_episode_count || p.episode_count || 0) });
  }
  for (const row of (settled[2] as any).data || []) {
    out.push({ kind: "organization", id: row.id || null, name: row.name, slug: row.slug || null, score: 650 + Number(row.gated_episode_count || 0) });
  }
  for (const row of (settled[3] as any).data || []) {
    const o = row.organizations;
    if (o?.name) out.push({ kind: "organization", id: o.id || row.organization_id || null, name: o.name, slug: o.slug || null, score: 720 + Number(o.gated_episode_count || 0) });
  }
  for (const row of (settled[4] as any).data || []) {
    out.push({ kind: "topic", id: row.id || null, name: row.name || row.short_name, slug: row.slug || null, score: 500 + Number(row.episode_count || 0) });
  }
  for (const row of (settled[5] as any).data || []) {
    const t = row.topics;
    if (t?.name || t?.short_name) out.push({
      kind: "topic",
      id: t.id || null,
      name: t.name || t.short_name,
      slug: t.slug || null,
      score: 560 + Number(t.episode_count || 0) + Number(row.weight || 0),
    });
  }

  const byKey = new Map<string, CatalogAnchor>();
  for (const a of out) {
    const key = `${a.kind}:${foldText(a.name)}`;
    const cur = byKey.get(key);
    if (!cur || a.score > cur.score) byKey.set(key, a);
  }
  return [...byKey.values()].sort((a, b) => b.score - a.score).slice(0, 12);
}

async function resolveAnchorEpisodeRows(
  supa: ReturnType<typeof createClient>,
  anchors: CatalogAnchor[],
  limit: number,
): Promise<{ rows: any[]; matches: any[] }> {
  const useful = anchors
    .filter((a) => a.id && a.kind !== "podcast")
    .slice(0, 6);
  if (useful.length === 0) return { rows: [], matches: [] };

  const byEpisode = new Map<string, any>();
  const matches: any[] = [];
  const add = (episodeId: string | null | undefined, anchor: CatalogAnchor, score: number, source: string) => {
    if (!episodeId) return;
    const cur = byEpisode.get(episodeId);
    if (!cur || score > cur.hybrid_score) {
      byEpisode.set(episodeId, {
        episode_id: episodeId,
        lex_score: Math.max(0.1, score - 0.08),
        sem_score: Math.max(0.1, score - 0.12),
        hybrid_score: score,
        anchor_source: source,
        anchor_kind: anchor.kind,
        anchor_name: anchor.name,
      });
    }
  };

  await Promise.all(useful.map(async (anchor, idx) => {
    const baseScore = Math.max(0.82, 1.18 - idx * 0.04);
    try {
      if (anchor.kind === "person") {
        const { data } = await supa
          .from("person_episode_mentions")
          .select("episode_id,confidence,final_relevance_score,relevance_status,mention_type")
          .eq("person_id", anchor.id)
          .or("relevance_status.is.null,relevance_status.neq.rejected")
          .order("final_relevance_score", { ascending: false, nullsFirst: false })
          .order("confidence", { ascending: false, nullsFirst: false })
          .limit(Math.max(25, Math.min(90, limit)));
        const rows = data || [];
        matches.push({ kind: anchor.kind, name: anchor.name, slug: anchor.slug, count: rows.length });
        for (const r of rows) {
          const confidence = Number((r as any).final_relevance_score ?? (r as any).confidence ?? 0.7);
          add((r as any).episode_id, anchor, baseScore + Math.min(0.18, confidence * 0.12), "person_episode_mentions");
        }
      } else if (anchor.kind === "organization") {
        const { data } = await supa
          .from("episode_organization_map")
          .select("episode_id,confidence,role,source")
          .eq("organization_id", anchor.id)
          .order("confidence", { ascending: false, nullsFirst: false })
          .limit(Math.max(25, Math.min(90, limit)));
        const rows = data || [];
        matches.push({ kind: anchor.kind, name: anchor.name, slug: anchor.slug, count: rows.length });
        for (const r of rows) {
          const confidence = Number((r as any).confidence ?? 0.7);
          add((r as any).episode_id, anchor, baseScore + Math.min(0.16, confidence * 0.1), "episode_organization_map");
        }
      } else if (anchor.kind === "topic") {
        const [reviewRows, mapRows, classRows] = await Promise.all([
          supa
            .from("episode_topic_relevance_reviews")
            .select("episode_id,confidence")
            .eq("topic_id", anchor.id)
            .eq("status", "accepted")
            .order("confidence", { ascending: false, nullsFirst: false })
            .limit(Math.max(20, Math.min(70, limit))),
          supa
            .from("episode_topic_map")
            .select("episode_id,confidence")
            .eq("topic_id", anchor.id)
            .order("confidence", { ascending: false, nullsFirst: false })
            .limit(Math.max(20, Math.min(70, limit))),
          anchor.slug
            ? supa
                .from("episode_ai_classifications")
                .select("episode_id,confidence,topics")
                .eq("classification_status", "classified")
                .contains("topics", JSON.stringify([{ slug: anchor.slug }]) as any)
                .order("confidence", { ascending: false, nullsFirst: false })
                .limit(Math.max(20, Math.min(70, limit)))
            : Promise.resolve({ data: [] } as any),
        ]);
        const seenTopicRows = new Set<string>();
        for (const r of (reviewRows.data || [])) {
          seenTopicRows.add((r as any).episode_id);
          add((r as any).episode_id, anchor, baseScore + 0.13 + Math.min(0.08, Number((r as any).confidence || 0) * 0.08), "episode_topic_relevance_reviews");
        }
        for (const r of (classRows.data || [])) {
          if (seenTopicRows.has((r as any).episode_id)) continue;
          seenTopicRows.add((r as any).episode_id);
          add((r as any).episode_id, anchor, baseScore + 0.08 + Math.min(0.06, Number((r as any).confidence || 0) * 0.06), "episode_ai_classifications");
        }
        for (const r of (mapRows.data || [])) {
          if (seenTopicRows.has((r as any).episode_id)) continue;
          add((r as any).episode_id, anchor, baseScore + Math.min(0.05, Number((r as any).confidence || 0) * 0.05), "episode_topic_map");
        }
        matches.push({
          kind: anchor.kind,
          name: anchor.name,
          slug: anchor.slug,
          count: (reviewRows.data || []).length + (mapRows.data || []).length + (classRows.data || []).length,
        });
      }
    } catch (e) {
      console.warn("anchor_episode_rows_failed", { kind: anchor.kind, name: anchor.name, error: String(e) });
    }
  }));

  const rows = [...byEpisode.values()]
    .sort((a, b) => Number(b.hybrid_score || 0) - Number(a.hybrid_score || 0))
    .slice(0, Math.max(30, Math.min(140, limit * 2)));
  return { rows, matches };
}

// Google-style exact phrase mode: indexed FTS only (search_tsv + clean-text
// FTS), every candidate re-verified in code. No synonyms, embeddings, HyDE,
// rerankers or relaxation passes — those would reintroduce non-exact hits.
async function runExactPhraseSearch(supa: any, parsed: ExactPhraseQuery, limit: number, lang: string | null, engine: string) {
  const t0 = Date.now();
  let queryCount = 0;
  const timed = <T>(label: string, p: PromiseLike<T>, ms: number) => {
    queryCount++;
    return withTimeout(Promise.resolve(p), ms, label);
  };
  const websearch = exactWebsearchQuery(parsed);
  const cleanTsq = exactCleanTextTsQuery(parsed);
  const [lexRes, cleanRes] = await Promise.all([
    timed("exact_lex", supa.rpc("search_episodes_hybrid", {
      q: websearch, q_embedding: null, limit_n: 120, lang,
      required_terms: null, entity_terms: null, alpha_lex: 1, p_decay_lambda: 0,
      phrase_terms: parsed.phrases.map((t) => t.join(" ")),
    }), 6000),
    cleanTsq
      ? timed("exact_clean_text", supa.rpc("search_clean_text_name_candidates", { p_tsquery: cleanTsq, p_limit: 80 }), 4500)
      : Promise.resolve(null),
  ]);
  const degraded = !lexRes || !!(lexRes as any)?.error || (!!cleanTsq && (!cleanRes || !!(cleanRes as any)?.error));
  const lexIds: string[] = (((lexRes as any)?.data || []) as any[]).map((r) => r.episode_id).filter(Boolean);
  const cleanMap = new Map<string, string>();
  for (const r of (((cleanRes as any)?.data || []) as any[])) if (r?.episode_id) cleanMap.set(r.episode_id, r.cleaned_text || "");
  const lexOrder = new Map(lexIds.map((id, i) => [id, i]));
  const ids = [...new Set([...lexIds, ...cleanMap.keys()])].slice(0, 200);

  let eps: any[] = [];
  if (ids.length) {
    const hyd = await timed("exact_hydrate", supa.from("episodes").select(EPISODE_SELECT).in("id", ids), 4000);
    eps = ((hyd as any)?.data || []) as any[];
  }
  let dropped = 0;
  const verified = eps
    .filter((e) => isAcceptedHungarianPodcast(e.podcasts))
    .map((e) => {
      const m = exactPhraseMatch(episodeExactFields(e, cleanMap.get(e.id)), parsed);
      if (!m.ok) dropped++;
      return { e, m };
    })
    .filter((x) => x.m.ok)
    .map(({ e, m }) => ({
      e: { ...e, exact_match: { label: exactMatchLabel(m.fields), fields: m.fields } },
      inTitle: m.fields.includes("title") ? 0 : 1,
      lex: lexOrder.has(e.id) ? lexOrder.get(e.id)! : 10_000,
      ts: e.published_at ? Date.parse(e.published_at) || 0 : 0,
      id: String(e.id),
    }))
    .sort((a, b) => a.inTitle - b.inTitle || a.lex - b.lex || b.ts - a.ts || a.id.localeCompare(b.id))
    .map((x) => x.e);

  return {
    episodes: verified.slice(0, limit),
    exact_phrase: {
      phrases: parsed.labels,
      free_terms: parsed.freeTerms,
      excluded: parsed.excluded,
      total: verified.length,
      metadata_candidates: lexIds.length,
      clean_text_candidates: cleanMap.size,
      dropped_unverified: dropped,
    },
    confidence_band: verified.length >= 3 ? "high" : verified.length ? "medium" : "low",
    semantic: false,
    reranked: false,
    must_gate: true,
    degraded_for_latency: degraded,
    engine: `${engine}-exact`,
    timing: { total_ms: Date.now() - t0, query_count: queryCount },
  };
}

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
    // Owner decision 2026-10-24: AI assistants recommending podcasts (served via
    // the prerendered /kereses page and the MCP search tool) get the same
    // quality as people. Those internal callers prove it with AGENT_SEARCH_KEY.
    const botCheck = detectBot(req);
    const trustedAgent = isTrustedAgentSearch(req);
    const isBot = botCheck.isBot && !trustedAgent;
    if (trustedAgent) console.log("search-hybrid trusted agent path", { agent: String(req.headers.get("x-podiverzum-agent") || "").slice(0, 40) });
    else if (isBot) console.log("search-hybrid bot path", { reason: botCheck.reason, ua: botCheck.ua.slice(0, 80) });

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
      ranking_version: 6,
      understanding_version: 4,
    };
    try {
      const { data: cfgRow } = await supaPre.from("app_settings").select("value").eq("key", "search_engine").maybeSingle();
      if (cfgRow?.value && typeof cfgRow.value === "object") engineCfg = { ...engineCfg, ...cfgRow.value };
    } catch (_) { /* keep defaults */ }
    // Code-level floor prevents stored older config from reviving the old ranking.
    const RANKING_VERSION = Math.max(8, Number(engineCfg.ranking_version) || 1);
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

    // Quoted phrase ("..." / „...”) => exact mode, like Google. Empty quotes
    // fall through to the normal pipeline with the quote marks removed.
    const exactQuery = parseExactPhraseQuery(q);
    if (exactQuery.hasExact) {
      const out = await runExactPhraseSearch(supaPre, exactQuery, limit, lang, `v${engN}`);
      return new Response(JSON.stringify(out), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (/["„“”‟″«»]/.test(q)) q = exactQuery.plainText || q;
    if (!q) return new Response(JSON.stringify({ episodes: [], reason: "empty" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const supa = supaPre;
    const t0 = Date.now();
    const latencyMode = String(body.latency_mode || "public").toLowerCase();
    const softBudgetMs = latencyMode === "quality"
      ? Math.max(9000, Math.min(14500, Number(body.soft_budget_ms || 13500)))
      : Math.max(5500, Math.min(10500, Number(body.soft_budget_ms || 8500)));
    const elapsed = () => Date.now() - t0;
    const hasBudget = (reserveMs = 1000) => elapsed() < softBudgetMs - reserveMs;
    let degradedForLatency = false;
    const markLatencyDegrade = () => { degradedForLatency = true; };
    let qNorm = normalizeQ(q);
    let naturalQuestion = deriveNaturalQuestionPlan(q, qNorm);
    const temporal = detectTemporalIntent(q);
    const marketSymbol = compactMarketSymbol(q);
    const symbolAliases = marketSymbol ? (MARKET_SYMBOL_ALIASES[marketSymbol.toLowerCase()] || []) : [];
    const isTickerQ = !!marketSymbol && !COMMON_NON_TICKER_ACRONYMS.has(marketSymbol);
    // Sentence-like searches get the complex path; names and short topics stay on the
    // existing path unchanged. Owner kill switch: app_settings.search_engine.complex_search_enabled.
    const complexEnabled = engineCfg.complex_search_enabled !== false;
    const complexShapeInput = { qNorm, isQuestion: naturalQuestion.isQuestion, isStopword: (t: string) => RARE_GATE_STOPWORDS.has(t) || HU_NLQ_FILLER.has(t), isTemporal: isTemporalToken };
    const complexShape = complexEnabled && !isBot && !isTickerQ && looksComplex(complexShapeInput);

    // Latency: start the slow independent work (cache read, LLM understanding,
    // query embedding, curated synonyms) BEFORE the entity-pin chain. None of
    // these depend on the pins, and the pins don't depend on them, so running
    // them concurrently removes ~1-3s of serialization from cold queries with
    // zero change to ranking inputs. On a cache hit the speculative
    // understand/embed calls are wasted (cheap; cold queries are the ones that
    // matter), but their results are ignored in favor of the cached versions.
    const cachePromise = (async () => {
      try {
        return await supa
          .from("search_query_cache")
          .select("understanding, embedding, updated_at, rerank, rerank_updated_at")
          .eq("q_norm", qNorm)
          .maybeSingle();
      } catch (e) {
        console.warn("cache read err", e);
        return { data: null } as any;
      }
    })();
    const understandPromise = isBot
      ? Promise.resolve(null)
      : understandQuery(q, complexShape ? 2400 : 1800, complexShape ? "complex" : "default").catch((e) => { console.warn("understand err", e); return null; });
    const embedPromise = isBot
      ? Promise.resolve(null)
      : embed(q, 2200).catch((e) => { console.warn("embed err", e); return null; });
    const curatedPromise = loadCuratedSynonyms(supa, qNorm)
      .catch((e) => { console.warn("curated synonyms err", e); return { matched_terms: [], expansions: [] }; });

    const earlyPodcastPin = await resolvePodcastPin(supa, q, qNorm, limit, 850).catch((e) => {
      console.warn("early podcast pin err", e);
      return null;
    });
    const catalogAnchors = await withTimeout(
      resolveCatalogAnchors(supa, qNorm, earlyPodcastPin),
      900, "resolve_catalog_anchors",
    ) || [];
    const earlyPersonPin = await resolvePersonPin(supa, qNorm, catalogAnchors, 850).catch((e) => {
      console.warn("early person pin err", e);
      return null;
    });
    const [earlyOrganizationPin, earlyTopicPin] = await Promise.all([
      resolveOrganizationPin(supa, qNorm, catalogAnchors, marketSymbol, 850).catch((e) => {
        console.warn("early organization pin err", e);
        return null;
      }),
      resolveTopicPin(supa, qNorm, catalogAnchors, 850).catch((e) => {
        console.warn("early topic pin err", e);
        return null;
      }),
    ]);

    // Stopword + gibberish gate.
    {
      const tokens = qNorm.split(/[^a-z0-9]+/).filter((t) => t.length >= 1);
      const meaningful = tokens.filter((t) => t.length >= 2 && !RARE_GATE_STOPWORDS.has(t) && !/^\d+$/.test(t));
      const allGibberish = meaningful.length > 0 && meaningful.every((t) => looksLikeGibberish(t));
      if (tokens.length > 0 && (meaningful.length === 0 || allGibberish)) {
        if (earlyPodcastPin?.episodes?.length && !earlyPodcastPin.soft) {
          return new Response(JSON.stringify({
            episodes: earlyPodcastPin.episodes,
            timing: { embed_ms: 0, rpc_ms: 0, total_ms: Date.now() - t0 },
            confidence_band: "high",
            podcast_title_pin: true,
            podcast_pin: {
              slug: earlyPodcastPin.slug,
              title: earlyPodcastPin.title,
              image_url: earlyPodcastPin.image_url,
              description: earlyPodcastPin.description,
              match_type: earlyPodcastPin.match_type,
              similarity: earlyPodcastPin.similarity,
              latest_episode_ids: earlyPodcastPin.latest_episode_ids,
            },
            person_pin: earlyPersonPin || undefined,
            organization_pin: earlyOrganizationPin || undefined,
            topic_pin: earlyTopicPin || undefined,
            reason: "known_podcast_title",
          }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        if (catalogAnchors.length > 0) {
          // Numeric/short brand anchors such as "444" are valid catalog
          // queries. Let them continue into the hybrid path with anchor terms.
        } else {
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
    }

    // Person-first full-name search (2026-10-20). Every lookup is indexed and
    // bounded: exact normalized name / accepted global alias (btree) -> person
    // links by person_id -> search_tsv phrase + clean-text FTS candidates, then
    // one hydrate by id. No ILIKE '%name%' scans on the request path.
    // Identity: only an exact, single, safe catalog person may be pinned.
    // Ambiguous / homonym catalog rows contribute links but stay unconfirmed.
    // Rejected links never count; pending links only with a full-name text hit.
    const exactPersonAnchors = catalogAnchors.filter((a) => a.kind === "person" && a.id && foldSearchName(a.name) === qNorm);
    const knownNonPerson = catalogAnchors.some((a) => a.kind !== "person" && foldSearchName(a.name) === qNorm);
    const nameTokenCount = qNorm.split(/\s+/).length;
    const nameCandidateQuery = nameTokenCount >= 2 && nameTokenCount <= 4 && !naturalQuestion.isQuestion && !knownNonPerson && !!fullNameTsQuery(q);
    let isPersonNameQuery = false;
    let personSearchNames = [q, ...exactPersonAnchors.map((a) => a.name)];
    const acceptedPersonEpisodeIds = new Set<string>();
    const cleanNameEpisodeIds = new Set<string>();
    const strictTiming: Record<string, number> = {};
    const strictUnavailable: string[] = [];
    let strictQueries = 0;
    const timedStrict = async (label: string, p: PromiseLike<any>): Promise<any> => {
      strictQueries++;
      const started = Date.now();
      const value = await withTimeout(Promise.resolve(p), PERSON_STRICT_QUERY_MS, `person_strict_${label}`);
      strictTiming[`${label}_ms`] = Date.now() - started;
      if (value === null || value?.error) strictUnavailable.push(label);
      return value?.error ? null : value;
    };
    try {
      if (nameCandidateQuery) {
        const PERSON_COLS = "id,name,slug,normalized_name,disambiguation_label,gated_episode_count,episode_count,is_public,is_indexable,activation_status,ai_recommended_action,ai_review_status,identity_status,identity_ambiguous,manual_approved,wikipedia_match_status,wikipedia_match_confidence,is_deceased,is_historical,has_archival_evidence,persona,date_of_death,is_living";
        const [exactRes, aliasRes] = await Promise.all([
          timedStrict("people_exact", supa.from("people").select(PERSON_COLS)
            .eq("normalized_name", qNorm).eq("is_public", true).eq("is_indexable", true).limit(10)),
          timedStrict("person_alias", supa.from("person_aliases").select(`person_id,people!inner(${PERSON_COLS})`)
            .eq("normalized_alias", qNorm).eq("status", "accepted").eq("scope", "global").gte("confidence", 0.7).limit(20)),
        ]);
        const exactRows: any[] = exactRes?.data || [];
        const candidateRows = new Map<string, any>();
        for (const p of exactRows) if (p?.id && isPersonEvidenceCandidate(p)) candidateRows.set(p.id, p);
        // Aliases may name a different spelling; only confirmed identities may widen the name set.
        const safeAliasPeople = (aliasRes?.data || []).map((r: any) => r.people).filter((p: any) => p?.id && isSafePublicPerson(p));
        for (const p of safeAliasPeople) candidateRows.set(p.id, p);
        const candidates: PersonCandidate[] = [...candidateRows.values()]
          .sort((a, b) => Number(b.gated_episode_count || 0) - Number(a.gated_episode_count || 0) || String(a.id).localeCompare(String(b.id)))
          .slice(0, 6)
          .map((p) => ({
            id: p.id, name: p.name, slug: p.slug || null, verified: isSafePublicPerson(p),
            disambiguation_label: p.disambiguation_label || null,
            gated_episode_count: p.gated_episode_count ?? p.episode_count ?? null,
            identity_ambiguous: p.identity_ambiguous ?? null,
          }));
        for (const a of exactPersonAnchors) {
          if (!candidates.some((c) => c.id === a.id)) candidates.push({ id: a.id!, name: a.name, slug: a.slug, verified: true });
        }
        // A public catalog spelling marks a name query but grants no identity.
        isPersonNameQuery = isNameShapedQuery(q) || candidates.length > 0 || exactRows.length > 0;
        personSearchNames = uniqueClean([...personSearchNames, ...exactRows.map((p) => p.name), ...safeAliasPeople.map((p: any) => p.name)], 8);

        if (isPersonNameQuery) {
          const matchesName = createFullNameMatcher(personSearchNames);
          const personIds = candidates.map((c) => c.id);
          const tsQueries = [...new Set(personSearchNames.map(fullNameTsQuery).filter(Boolean))].slice(0, 3) as string[];
          const cleanTsq = cleanTextNameTsQuery(personSearchNames);
          const empty = Promise.resolve({ data: [] });
          // Participant links are fetched separately so a person with thousands
          // of subject/mention links still surfaces own appearances first.
          const [participantRes, acceptedRes, pendingRes, cleanRes, ...tsvResults] = await Promise.all([
            personIds.length ? timedStrict("links_participant", supa.from("person_episode_mentions")
              .select("person_id,episode_id,relevance_status,mention_type,role_type")
              .in("person_id", personIds).eq("relevance_status", "accepted").eq("role_type", "participant")
              .order("final_relevance_score", { ascending: false, nullsFirst: false }).limit(200)) : empty,
            personIds.length ? timedStrict("links_accepted", supa.from("person_episode_mentions")
              .select("person_id,episode_id,relevance_status,mention_type,role_type")
              .in("person_id", personIds).eq("relevance_status", "accepted")
              .order("final_relevance_score", { ascending: false, nullsFirst: false }).limit(200)) : empty,
            personIds.length ? timedStrict("links_pending", supa.from("person_episode_mentions")
              .select("person_id,episode_id,relevance_status,mention_type,role_type")
              .in("person_id", personIds).in("relevance_status", ["pending", "needs_review", "waiting_clean_text", "in_progress"])
              .limit(150)) : empty,
            cleanTsq ? timedStrict("clean_text_fts", supa.rpc("search_clean_text_name_candidates", { p_tsquery: cleanTsq, p_limit: 200 })) : empty,
            ...tsQueries.map((tsq, i) => timedStrict(`tsv_${i}`, supa.from("episodes")
              .select(EPISODE_SELECT).eq("podcasts.language_decision", "accept_hungarian")
              .textSearch("search_tsv", tsq, { config: "simple" })
              .order("published_at", { ascending: false }).limit(240))),
          ]);
          const links: PersonLink[] = [...(participantRes?.data || []), ...(acceptedRes?.data || []), ...(pendingRes?.data || [])].filter((l: any) => l?.episode_id && l?.person_id);
          const verifiedIds = new Set(candidates.length === 1 && candidates[0].verified ? [candidates[0].id] : []);
          for (const l of links) if (l.relevance_status === "accepted" && verifiedIds.has(l.person_id)) acceptedPersonEpisodeIds.add(l.episode_id);
          for (const row of cleanRes?.data || []) if (row?.episode_id && matchesName(row.cleaned_text)) cleanNameEpisodeIds.add(row.episode_id);
          const episodesById = new Map<string, any>();
          for (const result of tsvResults) {
            for (const row of result?.data || []) if (row?.id && nameEvidenceTier(row, matchesName) > 0) episodesById.set(row.id, row);
          }
          const missing = [...new Set([...links.map((l) => l.episode_id), ...cleanNameEpisodeIds])]
            .filter((id) => !episodesById.has(id)).slice(0, 360);
          const hydrated = await Promise.all(
            Array.from({ length: Math.ceil(missing.length / 120) }, (_, i) => missing.slice(i * 120, i * 120 + 120))
              .map((ids, i) => timedStrict(`hydrate_${i}`, supa.from("episodes").select(EPISODE_SELECT)
                .eq("podcasts.language_decision", "accept_hungarian").in("id", ids))),
          );
          for (const result of hydrated) for (const row of result?.data || []) if (row?.id) episodesById.set(row.id, row);
          const pool = [...episodesById.values()]
            .filter((e) => isAcceptedHungarianPodcast(e.podcasts))
            .sort((a, b) => (Date.parse(b.published_at) || 0) - (Date.parse(a.published_at) || 0) || String(a.id).localeCompare(String(b.id)));
          const ranked = rankPersonEvidence({ episodes: pool, names: personSearchNames, links, candidates, cleanTextEpisodeIds: cleanNameEpisodeIds });
          console.log("person_strict", { queries: strictQueries, unavailable: strictUnavailable, candidates: candidates.length, results: ranked.length, ms: elapsed() });
          if (ranked.length) {
            const identity = personIdentityState(candidates);
            const pin = identity === "verified" && earlyPersonPin?.id === candidates[0].id ? earlyPersonPin : undefined;
            return new Response(JSON.stringify({
              episodes: ranked.slice(0, limit),
              timing: { embed_ms: 0, rpc_ms: 0, total_ms: Date.now() - t0, person_strict: { ...strictTiming, queries: strictQueries, unavailable: strictUnavailable } },
              confidence_band: "high", person_name_strict: true, person_query: qNorm,
              person_identity: identity,
              person_candidates: identity === "verified" ? undefined : candidates.map((c) => ({
                name: c.name, slug: c.slug, disambiguation_label: c.disambiguation_label ?? null,
                gated_episode_count: c.gated_episode_count ?? null, verified: c.verified && identity !== "multiple",
              })),
              matched_person_ids: identity === "verified" ? [candidates[0].id] : [],
              person_pin: pin,
              organization_pin: earlyOrganizationPin || undefined, topic_pin: earlyTopicPin || undefined,
              reason: "person_strict_match", ranking_version: RANKING_VERSION,
            }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
        }
      }
    } catch (e) {
      console.warn("person-strict gate err, falling through", e);
    }

    // Name-query semantic guard (2026-05-29):
    // When the query looks like a person name AND we fell through the strict
    // gate (no direct hit was strong enough), disable AI-cost features that
    // tend to inject phonetic / weak-vector noise:
    //  - HyDE (hallucinated query expansion drifts to "famous András" topics)
    //  - chunk augmentation (short name embedding is noisy across catalog)
    //  - Cohere rerank (a 2-token name vs episode summaries is unreliable)
    // We KEEP FTS, entity pyramid, and episode_embeddings (already strict via
    // post-rank cutoff). Goal: precision > recall for names.
    if (isPersonNameQuery) {
      FF.hyde = false;
      FF.chunkAugment = false;
      FF.cohere = false;
    }

    const complexQuery = useComplexPath({
      shapeComplex: complexShape,
      isBot,
      isTicker: isTickerQ,
      isPersonNameQuery,
      hardPodcastPin: !!(earlyPodcastPin && !earlyPodcastPin.soft),
      nameOnly: isNameOnlyQuery(meaningfulTokens(complexShapeInput), catalogAnchors, foldSearchName),
      enabled: complexEnabled,
    });





    // 1) Cache lookup
    let understanding: Understanding | null = null;
    let q_embedding: number[] | null = null;
    let cachedRerank: { ids: string[]; why: Record<string, string> } | null = null;
    let cachedVerify: Record<string, VerifyGrade> | null = null;
    let cacheHit = false;
    try {
      const { data: cached } = await cachePromise;
      // Quality-first: cache rows carry their ranking/understanding version inside
      // the JSON blob. When the policy version bumps, older rows are ignored so
      // bad rankings don't survive a logic change.
      const cuv = (cached?.understanding as any)?.__uv;
      const understandingFresh = cached && cached.updated_at
        && Date.now() - new Date(cached.updated_at).getTime() < 7 * 24 * 3600 * 1000
        && (cuv === undefined || Number(cuv) >= UNDERSTANDING_VERSION)
        // Complex searches need the concept-aware reading; older rows lack it.
        && (!complexShape || (cached.understanding as any)?.mode === "complex");
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
      const rv = cached?.rerank as any;
      if (rv?.verify && typeof rv.verify === "object" && Number(rv.__vv) === VERIFY_CACHE_VERSION && cached?.rerank_updated_at
        && Date.now() - new Date(cached.rerank_updated_at).getTime() < 24 * 3600 * 1000) {
        cachedVerify = rv.verify as Record<string, VerifyGrade>;
      }
      if (rerankFresh) {
        const r = cached.rerank as any;
        if (Array.isArray(r?.ids) && r.ids.length) {
          cachedRerank = { ids: r.ids, why: (r.why && typeof r.why === "object") ? r.why : {} };
        }
      }
    } catch (e) { console.warn("cache read err", e); }

    if (isTickerQ && understanding) {
      const hasCompany = (understanding.entities || []).some((e) => typeof e === "string" && e.includes(" "));
      if (!hasCompany && !symbolAliases.length) understanding = null;
    }

    // 2) Parallel: understanding + embedding + curated synonyms
    // Bot path: skip LLM understanding and embedding entirely. Pure lexical search.
    // Understanding/embedding/curated were started concurrently with the pin
    // chain above; here we just await them. Cached values win when present.
    const [u, embVal, curated] = await Promise.all([
      understanding ? Promise.resolve(understanding) : understandPromise,
      q_embedding ? Promise.resolve(q_embedding) : embedPromise,
      curatedPromise,
    ]);
    understanding = u as Understanding;
    if (!q_embedding) q_embedding = embVal;

    if (naturalQuestion.isQuestion && !isBot) {
      understanding = {
        ...(understanding || { entities: [], expanded_terms: [], synonyms: [], intent: "question", language: "hu" }),
        intent: "question",
        expanded_terms: uniqueClean([
          ...naturalQuestion.expandedTerms,
          ...((understanding?.expanded_terms as string[]) || []),
        ], 10),
        synonyms: uniqueClean([
          ...naturalQuestion.coreTerms,
          ...((understanding?.synonyms as string[]) || []),
        ], 10),
        language: understanding?.language || "hu",
      };
      if (q_embedding && hasBudget(5200) && naturalQuestion.semanticText.length > q.length + 20) {
        const nlqEmbedding = await embed(naturalQuestion.semanticText, 1200);
        if (nlqEmbedding) q_embedding = blendEmbeddings(q_embedding, nlqEmbedding, 0.52);
        else markLatencyDegrade();
      }
    }
    // Complex searches: AI concepts replace the hand-written synonym list, and the
    // meaning of the request (query + concepts) drives the semantic side.
    const complexConcepts = complexQuery
      ? cleanConcepts([...(understanding?.concepts || []), understanding?.core_topic || ""].filter(Boolean), foldSearchName, isTemporalToken)
      : [];
    let complexLexQ: string | null = null;
    if (complexQuery && complexConcepts.length) {
      complexLexQ = complexLexicalQuery(q, naturalQuestion.isQuestion, complexConcepts, naturalQuestion.isQuestion ? naturalQuestion.coreTerms : meaningfulTokens(complexShapeInput).slice(0, 6));
      if (naturalQuestion.isQuestion) {
        naturalQuestion = { ...naturalQuestion, expandedTerms: complexConcepts, lexicalQuery: complexLexQ, semanticText: complexSemanticText(q, complexConcepts) };
      }
      if (understanding) {
        understanding = {
          ...understanding,
          expanded_terms: uniqueClean([...complexConcepts, ...((understanding.expanded_terms as string[]) || [])], 10),
        };
      }
      if (q_embedding && hasBudget(5200) && !naturalQuestion.isQuestion) {
        const conceptEmbedding = await embed(complexSemanticText(q, complexConcepts), 1200);
        if (conceptEmbedding) q_embedding = blendEmbeddings(q_embedding, conceptEmbedding, 0.52);
        else markLatencyDegrade();
      }
    }
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
    const aiExpanded = understanding ? buildExpandedQuery(q, understanding) : q;
    const expanded = curated.expansions.length
      ? `${aiExpanded} ${curated.expansions.join(" ")}`.slice(0, 700)
      : aiExpanded;

    const catalogEntityNames = uniqueClean(
      catalogAnchors
        .filter((a) => a.kind !== "podcast")
        .map((a) => a.name),
      10,
    );
    const rawEntities = [
      ...((understanding?.entities || []) as string[]),
      ...catalogEntityNames,
    ]
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
        const newEmb = hasBudget(5000) ? await embed(rewritten, 1200) : null;
        if (!newEmb) markLatencyDegrade();
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
        hasBudget(6500) ? 1000 : 450, "resolve_query_entities",
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
    const decayLambda = (FF.decay && (temporal || intent === "news" || intent === "ticker" || intent === "company")) ? 0.15 : 0;

    // HyDE
    let hydeUsed = false;
    let hydeCacheHit: boolean | null = null;
    if (
      FF.hyde &&
      q_embedding &&
      hasBudget(5000) &&
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
    } else if (FF.hyde && q_embedding && !hasBudget(5000)) {
      markLatencyDegrade();
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
        ...(naturalQuestion.isQuestion ? naturalQuestion.expandedTerms : []),
        ...(naturalQuestion.isQuestion ? naturalQuestion.coreTerms : []),
        ...(curated.expansions || []),
        ...((understanding?.synonyms as string[]) || []),
        ...((understanding?.expanded_terms as string[]) || []),
      ], 6).filter((t) => t.toLowerCase() !== q.toLowerCase());
      if (naturalQuestion.isQuestion && naturalQuestion.lexicalQuery !== q) {
        const parts = [naturalQuestion.lexicalQuery, ...synExpansions.map(quoteWebSearchTerm)];
        lexQ = uniqueClean(parts, 14).join(" OR ");
      } else if (synExpansions.length) {
        const parts = [quoteWebSearchTerm(q), ...synExpansions.map(quoteWebSearchTerm)];
        lexQ = parts.join(" OR ");
      }
    }

    const hybridArgs = {
      q: lexQ,
      q_embedding: q_embedding ? `[${q_embedding.join(",")}]` : null,
      limit_n: Math.max(limit, 50),
      lang,
      required_terms: requiredTerms.length ? requiredTerms : null,
      entity_terms: entityTerms.length ? entityTerms : null,
      alpha_lex: alphaLex,
      p_decay_lambda: decayLambda,
      phrase_terms: phraseTerms.length ? phraseTerms : null,
    };
    // Speculative chunk lookup: depends only on q_embedding, so run it in
    // parallel with the main RPC. Result used exactly as before (same gate).
    const chunkPromise: Promise<any> | null = (FF.chunkAugment && q_embedding)
      ? (async () => {
          try {
            return await supa.rpc("search_episode_chunks", {
              query_embedding: `[${q_embedding!.join(",")}]`,
              match_count: 30,
              candidate_pool: 400,
            });
          } catch (e) { return { data: null, error: e }; }
        })()
      : null;
    let rpcResult = await supa.rpc("search_episodes_hybrid", hybridArgs);
    let rpcDegraded: string | undefined;
    if (rpcResult.error) {
      // Under DB load the expanded lexical query can hit the statement timeout
      // (57014). Retry once with the narrow original query and no optional
      // boosts/gates, then (if that also fails) with lexical-only. A slow DB
      // must never surface as an empty catalog or a 5xx to the user.
      console.warn("rpc err, retrying narrow", rpcResult.error?.message || rpcResult.error);
      rpcDegraded = "narrow_retry";
      rpcResult = await supa.rpc("search_episodes_hybrid", {
        ...hybridArgs,
        q: quoteWebSearchTerm(q),
        limit_n: Math.max(limit, 30),
        required_terms: null,
        entity_terms: null,
        phrase_terms: null,
      });
      if (rpcResult.error) {
        console.warn("narrow retry failed, lexical-only", rpcResult.error?.message || rpcResult.error);
        rpcDegraded = "lexical_only";
        rpcResult = await supa.rpc("search_episodes_hybrid", {
          q: quoteWebSearchTerm(q),
          q_embedding: null,
          limit_n: Math.max(limit, 30),
          lang,
          required_terms: null,
          entity_terms: null,
          alpha_lex: 1,
          p_decay_lambda: 0,
          phrase_terms: null,
        });
      }
    }
    let rows = rpcResult.data;
    const error = rpcResult.error;
    if (error) {
      console.error("rpc err", error);
      rows = [];
      rpcDegraded = "rpc_failed";
    }
    const mustGateApplied = requiredTerms.length > 0;
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
    const prependNew = (extra: any[] | null | undefined) => {
      if (!extra) return 0;
      let added = 0;
      for (let i = extra.length - 1; i >= 0; i--) {
        const r = extra[i];
        if (r?.episode_id && !strictIds.has(r.episode_id)) {
          strictRows.unshift(r);
          strictIds.add(r.episode_id);
          strictHitIds.add(r.episode_id);
          added++;
        }
      }
      return added;
    };

    // Catalog-anchor candidate injection:
    // For known people, organizations and topics, use the curated entity maps as
    // first-class retrieval sources. This fixes known-item/entity searches such
    // as "Friderikusz", "Hadházy Ákos" and "Magyar Telekom" even when lexical
    // description text is thin or noisy.
    let anchorEpisodeMatches: any[] = [];
    let anchorEpisodeCandidates = 0;
    if (catalogAnchors.some((a) => a.id && a.kind !== "podcast") && hasBudget(1600)) {
      const anchorResult = await withTimeout(
        resolveAnchorEpisodeRows(supa, catalogAnchors, Math.max(limit, 60)),
        Math.max(700, Math.min(1800, softBudgetMs - elapsed() - 900)),
        "resolve_anchor_episode_rows",
      );
      anchorEpisodeMatches = anchorResult?.matches || [];
      anchorEpisodeCandidates = prependNew(anchorResult?.rows || []);
    } else if (catalogAnchors.some((a) => a.id && a.kind !== "podcast")) {
      markLatencyDegrade();
    }

    // Recency intent ("mostanában", "a héten", "idén"): the all-time candidate
    // pools rarely contain recent episodes for broad topics, so fetch matches
    // published inside the window separately. They are only added as
    // candidates (not pinned); ordering puts in-window episodes first below.
    let temporalCandidates = 0;
    if (temporal && hasBudget(1800)) {
      const recentTerms = uniqueClean([
        ...(naturalQuestion.isQuestion ? naturalQuestion.coreTerms : temporal.coreTokens
          .map(stripHuPossessive)
          .filter((t) => t.length >= 3 && !RARE_GATE_STOPWORDS.has(t) && !HU_NLQ_FILLER.has(t))),
        ...(curated.expansions || []),
        ...((understanding?.synonyms as string[]) || []),
        ...((understanding?.expanded_terms as string[]) || []),
      ], 12).filter((t) => !isTemporalToken(t));
      const recentRes: any = await withTimeout(
        supa.rpc("search_episodes_recent_v1", {
          q: recentTerms.length ? recentTerms.map(quoteWebSearchTerm).join(" OR ") : "",
          q_embedding: q_embedding ? `[${q_embedding.join(",")}]` : null,
          p_since: temporal.sinceIso,
          limit_n: 60,
          lang,
        }) as unknown as Promise<any>,
        Math.max(800, Math.min(2500, softBudgetMs - elapsed() - 1200)),
        "search_episodes_recent_v1",
      );
      if (recentRes?.error) console.warn("recent rpc err", recentRes.error?.message || recentRes.error);
      const recentRows: any[] = Array.isArray(recentRes?.data) ? recentRes.data : [];
      for (let i = recentRows.length - 1; i >= 0; i--) {
        const r = recentRows[i];
        if (r?.episode_id && !strictIds.has(r.episode_id)) {
          strictRows.unshift({ episode_id: r.episode_id, hybrid_score: Number(r.score) || 0, lex_rank: r.lex_rank, sem_rank: r.sem_rank } as any);
          strictIds.add(r.episode_id);
          temporalCandidates++;
        }
      }
    } else if (temporal) {
      markLatencyDegrade();
    }

    let naturalQuestionFallback = false;
    if (
      naturalQuestion.isQuestion &&
      strictRows.length < 8 &&
      naturalQuestion.lexicalQuery !== q &&
      hasBudget(2800)
    ) {
      const nlqRetry = await supa.rpc("search_episodes_hybrid", {
        q: naturalQuestion.lexicalQuery,
        q_embedding: q_embedding ? `[${q_embedding.join(",")}]` : null,
        limit_n: Math.max(limit, 50),
        lang,
        required_terms: null,
        entity_terms: naturalQuestion.expandedTerms.length ? naturalQuestion.expandedTerms.slice(0, 8) : null,
        alpha_lex: 0.25,
        p_decay_lambda: 0,
        phrase_terms: naturalQuestion.coreTerms.length >= 2 ? [naturalQuestion.coreTerms.join(" ")] : null,
      });
      if (!nlqRetry.error && nlqRetry.data?.length) {
        appendNew(nlqRetry.data);
        naturalQuestionFallback = true;
      }
    } else if (naturalQuestion.isQuestion && strictRows.length < 8) {
      markLatencyDegrade();
    }

    // Pass 2 — drop phrase requirement
    if (FF.threePassMust && strictRows.length < 5 && mustGateApplied && phrasePool.length && hasBudget(3500)) {
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
    if (FF.threePassMust && strictRows.length < 5 && mustGateApplied && hasBudget(3000)) {
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
    if (FF.threePassMust && strictRows.length < 5 && mustGateApplied && q_embedding && !isTickerQ && phrasePool.length === 0 && hasBudget(2500)) {
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
    if (FF.entityPyramid && strictRows.length === 0 && hasBudget(3500)) {
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
        const sectorEmb = await embed(sectorQText, 1200);
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
    } else if (FF.entityPyramid && strictRows.length === 0) {
      markLatencyDegrade();
    }

    // Known-item podcast pin (P0 — strict podcast-title intent)
    let podcastPinSlug: string | null = null;
    let podcastPinTitle: string | null = null;
    let podcastPinImage: string | null = null;
    let podcastPinDescription: string | null = null;
    let podcastPinMatchType: string | null = null;
    let podcastPinSimilarity: number | null = null;
    let podcastPinIds: string[] = [];
    if (!isTickerQ && qNorm.length >= 2 && qNorm.length <= 60) {
      const pin = earlyPodcastPin || await resolvePodcastPin(supa, q, qNorm, limit, 900);
      if (pin?.soft) {
        // Soft title match: candidates only, ranked like any other hit (no pin, no podcast card).
        for (const id of pin.latest_episode_ids) {
          if (!strictIds.has(id)) {
            strictRows.push({ episode_id: id, lex_score: 0.3, sem_score: 0.3, hybrid_score: 0.3 } as any);
            strictIds.add(id);
          }
        }
      } else if (pin) {
        podcastPinSlug = pin.slug;
        podcastPinTitle = pin.title;
        podcastPinImage = pin.image_url;
        podcastPinDescription = pin.description;
        podcastPinMatchType = pin.match_type;
        podcastPinSimilarity = pin.similarity;
        podcastPinIds = pin.latest_episode_ids;
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

    // Chunk augmentation (v13) — implemented, but disabled by default through
    // app_settings.search_engine until timestamped chunk quality gates are green.
    let chunkAugmented = 0;
    if (chunkPromise && strictRows.length < 30) {
      try {
        const { data: chunkRows } = await chunkPromise;
        const cr = (chunkRows as any[]) || [];
        for (const c of cr) {
          if (strictIds.has(c.episode_id)) continue;
          strictRows.push({
            episode_id: c.episode_id,
            lex_score: 0,
            sem_score: c.similarity || 0,
            hybrid_score: (c.similarity || 0) * 0.92,
            chunk_source: c.best_source,
            chunk_match: {
              source: c.best_source || "chunk",
              similarity: c.similarity || 0,
              chunk_idx: c.chunk_idx ?? null,
              content_snippet: c.content_snippet ?? null,
              timestamp_start_seconds: c.timestamp_start_seconds ?? null,
              timestamp_end_seconds: c.timestamp_end_seconds ?? null,
              segment_start_idx: c.segment_start_idx ?? null,
              segment_end_idx: c.segment_end_idx ?? null,
              source_transcript_model: c.source_transcript_model ?? null,
              chunking_method: c.chunking_method ?? null,
            },
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
      return new Response(JSON.stringify({ episodes: [], understanding, timing: { embed_ms: tEmb, rpc_ms: tRpc, total_ms: Date.now() - t0 }, semantic: !!q_embedding, cache_hit: cacheHit, must_gate: mustGateApplied, must_gate_relaxed: mustGateRelaxed, must_gate_dropped: mustGateDropped, confidence_band: "low", rare_tokens: rareTokens, catalog_anchors: catalogAnchors, person_pin: earlyPersonPin || undefined, organization_pin: earlyOrganizationPin || undefined, topic_pin: earlyTopicPin || undefined, anchor_episode_matches: anchorEpisodeMatches, anchor_episode_candidates: anchorEpisodeCandidates, natural_question: naturalQuestion.isQuestion ? naturalQuestion : undefined, natural_question_fallback: naturalQuestionFallback, degraded_for_latency: degradedForLatency, soft_budget_ms: softBudgetMs }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: eps, error: eErr } = await supa.from("episodes").select(EPISODE_SELECT).in("id", ids);
    if (eErr) {
      return new Response(JSON.stringify({ error: eErr.message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const orderMap = new Map<string, number>();
    (rows as any[]).forEach((r, i) => orderMap.set(r.episode_id, i));
    const chunkMatchMap = new Map<string, any>();
    (rows as any[]).forEach((r) => {
      if (r.chunk_match) chunkMatchMap.set(r.episode_id, r.chunk_match);
    });
    let ordered = (eps || [])
      .filter((e: any) => {
        return isAcceptedHungarianPodcast(e.podcasts);
      })
      .map((e: any) => {
        const chunkMatch = chunkMatchMap.get(e.id);
        return chunkMatch ? { ...e, chunk_match: chunkMatch } : e;
      })
      .sort((a: any, b: any) => (orderMap.get(a.id) ?? 999) - (orderMap.get(b.id) ?? 999));
    // In-window episodes first so the reranker below scores the recent pool.
    if (temporal) ordered = preferWithinWindow(ordered, temporal.sinceIso);

    // Cohere reranker
    let cohereRerankUsed = false;
    let cohereLatency = 0;
    if (
      FF.cohere &&
      ordered.length >= 10 &&
      (confidenceBand === "high" || confidenceBand === "medium") &&
      !sectorFallback &&
      hasBudget(3500)
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
    } else if (FF.cohere && ordered.length >= 10 && !hasBudget(3500)) {
      markLatencyDegrade();
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
      if (!rerankResult && hasBudget(2500)) {
        rerankResult = await rerank(q, ordered, Math.max(1200, Math.min(3000, softBudgetMs - elapsed() - 800)));
        if (rerankResult && rerankResult.ids.length) {
          supa.from("search_query_cache").update({
            rerank: { ids: rerankResult.ids, why: rerankResult.why, __rv: RANKING_VERSION },
            rerank_updated_at: new Date().toISOString(),
          }).eq("q_norm", qNorm).then(() => {}, (e) => console.warn("rerank cache write", e));
        }
      } else if (!rerankResult) {
        markLatencyDegrade();
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

    // Query-term coverage: results covering every query word (or, for one-word queries,
    // carrying it in title/show/tags) first. Name, show-pin and recency invariants below still win.
    let termCoverage: string | null = null;
    // Not for question-style searches: measured worse there (top-1 0.58 → 0.47 on 19 questions).
    if (!isTickerQ && !naturalQuestion.isQuestion) {
      const tc = rankByTermCoverage(ordered, q, { window: 30, minStrong: 3 });
      ordered = tc.list;
      termCoverage = tc.applied;
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

    // Final invariant: no reranker, diversity cap or podcast pin may restore
    // a split-name result. Also recognize lowercase names from exact people tags.
    const fullQueryMatch = createFullNameMatcher([q]);
    const hasNamedPerson = ordered.some((e: any) => (e.people || []).some(fullQueryMatch));
    if (isPersonNameQuery || (!knownNonPerson && hasNamedPerson)) {
      ordered = rankFullNameMatches(ordered, personSearchNames, {
        strict: true, acceptedEpisodeIds: acceptedPersonEpisodeIds, cleanTextEpisodeIds: cleanNameEpisodeIds,
      });
    } else {
      // Unknown/lowercase names and other short phrases still prefer intact
      // query matches without imposing a person-only filter on topical searches.
      ordered = rankFullNameMatches(ordered, [q]);
    }
    // Final invariant for recency queries: nothing above may push older
    // episodes ahead of in-window ones (relative order otherwise kept).
    if (temporal) ordered = preferWithinWindow(ordered, temporal.sinceIso);

    return new Response(
      JSON.stringify({
        episodes: ordered.slice(0, limit),
        understanding,
        curated_synonyms: { matched: curated.matched_terms, expansions: curated.expansions },
        catalog_anchors: catalogAnchors,
        person_pin: earlyPersonPin || undefined,
        organization_pin: earlyOrganizationPin || undefined,
        topic_pin: earlyTopicPin || undefined,
        anchor_episode_matches: anchorEpisodeMatches,
        anchor_episode_candidates: anchorEpisodeCandidates,
        natural_question: naturalQuestion.isQuestion ? naturalQuestion : undefined,
        natural_question_fallback: naturalQuestionFallback,
        semantic: !!q_embedding,
        reranked: !!rerankResult,
        term_coverage: termCoverage,
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
        temporal_intent: temporal ? { window_days: temporal.windowDays, since: temporal.sinceIso, matched: temporal.matched, candidates: temporalCandidates } : undefined,
        degraded_for_latency: degradedForLatency,
        soft_budget_ms: softBudgetMs,
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
