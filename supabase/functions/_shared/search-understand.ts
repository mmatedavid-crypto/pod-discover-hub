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

const EMPTY: Understanding = { entities: [], expanded_terms: [], synonyms: [], intent: "topic", language: "en" };

export async function understandQuery(q: string, timeoutMs = 1500): Promise<Understanding> {
  if (!LOVABLE_API_KEY || !q) return EMPTY;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: "You expand a podcast search query for hybrid search. Return concise, plain-English synonyms and entity names. Never invent facts." },
          { role: "user", content: `Query: "${q}"\nReturn entities (people/companies/topics named in the query), 3-6 expanded_terms (closely related keywords), 3-6 synonyms, intent (one of: topic, person, company, ticker, episode, question), and language (ISO code).` },
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
    if (!r.ok) return EMPTY;
    const j = await r.json();
    const args = j?.choices?.[0]?.message?.tool_calls?.[0]?.function?.arguments;
    if (!args) return EMPTY;
    const p = typeof args === "string" ? JSON.parse(args) : args;
    return {
      entities: Array.isArray(p?.entities) ? p.entities.slice(0, 8) : [],
      expanded_terms: Array.isArray(p?.expanded_terms) ? p.expanded_terms.slice(0, 8) : [],
      synonyms: Array.isArray(p?.synonyms) ? p.synonyms.slice(0, 8) : [],
      intent: typeof p?.intent === "string" ? p.intent : "topic",
      language: typeof p?.language === "string" ? p.language.toLowerCase().slice(0, 5) : "en",
    };
  } catch (e) {
    clearTimeout(t);
    console.warn("understand err", e);
    return EMPTY;
  }
}

export function buildExpandedQuery(q: string, u: Understanding): string {
  // websearch_to_tsquery treats spaces as AND. Expansion terms must be OR-joined,
  // otherwise queries like "Zsiday Viktor" + AI-expanded "Hungarian economist portfolio manager"
  // become an AND of all words and return zero lexical matches — leaving only semantic results,
  // which surface tangentially related content (e.g. other "Viktor" episodes about Hungary).
  const extras = [...u.expanded_terms, ...u.synonyms, ...u.entities]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  if (!extras.length) return q;
  // Keep original q as the primary AND-clause; OR-add each expansion term as a quoted phrase
  // so multi-word expansions ("portfolio manager") stay together instead of ANDing.
  const orParts = extras.map((t) => (t.includes(" ") ? `"${t.replace(/"/g, "")}"` : t));
  return `${q} or ${orParts.join(" or ")}`.slice(0, 500);
}
