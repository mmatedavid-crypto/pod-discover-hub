// Shared query-understanding helper used by search-hybrid + search-suggest.
// Calls Lovable AI Gateway (gemini-2.5-flash-lite) with tool calling for structured output.
// Returns: { entities[], expanded_terms[], synonyms[], intent, language }

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

export type Understanding = {
  entities: string[];
  expanded_terms: string[];
  synonyms: string[];
  intent: string;
  language: string;
};

const EMPTY: Understanding = { entities: [], expanded_terms: [], synonyms: [], intent: "topic", language: "hu" };

// In-memory circuit breaker. If the AI gateway times out or 5xx's repeatedly,
// short-circuit subsequent calls for COOLDOWN_MS so we don't waste latency on
// known-bad upstream. Resets automatically.
const CB_FAIL_THRESHOLD = 3;
const CB_WINDOW_MS = 60_000;
const CB_COOLDOWN_MS = 60_000;
const cbFails: number[] = [];
let cbOpenUntil = 0;

function cbAllow(): boolean {
  const now = Date.now();
  if (now < cbOpenUntil) return false;
  while (cbFails.length && now - cbFails[0] > CB_WINDOW_MS) cbFails.shift();
  return true;
}

function cbRecordFail() {
  const now = Date.now();
  cbFails.push(now);
  while (cbFails.length && now - cbFails[0] > CB_WINDOW_MS) cbFails.shift();
  if (cbFails.length >= CB_FAIL_THRESHOLD) {
    cbOpenUntil = now + CB_COOLDOWN_MS;
    cbFails.length = 0;
    console.warn("understand circuit_breaker_open for", CB_COOLDOWN_MS, "ms");
  }
}

export async function understandQuery(q: string, timeoutMs = 1500): Promise<Understanding> {
  if (!LOVABLE_API_KEY || !q) return EMPTY;
  if (!cbAllow()) return EMPTY;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-lite",
        messages: [
          { role: "system", content: "You expand a Hungarian-language podcast search query for hybrid search. Return concise, plain synonyms and entity names in the SAME language as the query (default Hungarian). Never invent facts.\n\nIMPORTANT — Stock tickers: If the query looks like a US stock ticker symbol (2-5 uppercase letters, optionally with a class suffix like .B), you MUST include BOTH the symbol AND the full company name in `entities`. Examples: ASTS → [\"ASTS\", \"AST SpaceMobile\"], NVDA → [\"NVDA\", \"Nvidia\"], TSLA → [\"TSLA\", \"Tesla\"], BRK.B → [\"BRK.B\", \"Berkshire Hathaway\"], PLTR → [\"PLTR\", \"Palantir\"], RIVN → [\"RIVN\", \"Rivian\"], COIN → [\"COIN\", \"Coinbase\"]. Set intent=\"ticker\". Also add the company's industry to expanded_terms. If you don't recognize the ticker symbol, still return the symbol itself in entities and intent=\"ticker\" — do NOT guess company names." },
          { role: "user", content: `Query: "${q}"\nReturn entities (people/companies/topics named in the query — for tickers include both symbol AND company name), 3-6 expanded_terms (closely related keywords), 3-6 synonyms, intent (one of: topic, person, company, ticker, episode, question, news), and language (ISO code).` },
        ],
        tools: [{
          type: "function",
          function: {
            name: "understand",
            parameters: {
              type: "object",
              additionalProperties: false,
              properties: {
                entities: { type: "array", items: { type: "string" }, maxItems: 8 },
                expanded_terms: { type: "array", items: { type: "string" }, maxItems: 8 },
                synonyms: { type: "array", items: { type: "string" }, maxItems: 8 },
                intent: { type: "string" },
                language: { type: "string" },
              },
              required: ["entities", "expanded_terms", "synonyms", "intent", "language"],
            },
          },
        }],
        tool_choice: { type: "function", function: { name: "understand" } },
      }),
    });
    clearTimeout(t);
    if (!r.ok) {
      if (r.status >= 500 || r.status === 429) cbRecordFail();
      return EMPTY;
    }
    const j = await r.json();
    const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return EMPTY;
    const p = typeof args === "string" ? JSON.parse(args) : args;
    return {
      entities: Array.isArray(p?.entities) ? p.entities.slice(0, 8) : [],
      expanded_terms: Array.isArray(p?.expanded_terms) ? p.expanded_terms.slice(0, 8) : [],
      synonyms: Array.isArray(p?.synonyms) ? p.synonyms.slice(0, 8) : [],
      intent: typeof p?.intent === "string" ? p.intent : "topic",
      language: typeof p?.language === "string" ? p.language.toLowerCase().slice(0, 5) : "hu",
    };
  } catch (e) {
    clearTimeout(t);
    cbRecordFail();
    console.warn("understand err", e);
    return EMPTY;
  }
}

export function buildExpandedQuery(q: string, u: Understanding): string {
  // websearch_to_tsquery treats spaces as AND. Expansion terms must be OR-joined.
  const extras = [...u.expanded_terms, ...u.synonyms, ...u.entities]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  if (!extras.length) return q;
  const orParts = extras.map((t) => (t.includes(" ") ? `"${t.replace(/"/g, "")}"` : t));
  return `${q} or ${orParts.join(" or ")}`.slice(0, 500);
}
