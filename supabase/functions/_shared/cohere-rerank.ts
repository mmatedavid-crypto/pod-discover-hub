// Cohere Rerank v3.5 cross-encoder reranker.
// Takes top-30 episode candidates from hybrid search and re-orders them.
//
// Defenses:
// - Daily $ budget (app_settings.cohere_rerank_daily_spent)
// - In-memory circuit breaker (3 fails / 60s → 60s cooldown)
// - 1500ms timeout
// - Skip-on-fail (caller falls back to pre-rerank order)

const COHERE_API_KEY = Deno.env.get("COHERE_API_KEY");
const DAILY_BUDGET_CENTS = 200; // $2/day cap

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
    console.warn("cohere rerank circuit_breaker_open for", CB_COOLDOWN_MS, "ms");
  }
}

async function checkAndIncrementBudget(supa: any): Promise<boolean> {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const { data } = await supa
      .from("app_settings")
      .select("value")
      .eq("key", "cohere_rerank_daily_spent")
      .maybeSingle();
    const cur = (data?.value && typeof data.value === "object") ? data.value : null;
    const sameDay = cur?.date === today;
    const spent = sameDay ? Number(cur?.spent_cents || 0) : 0;
    if (spent >= DAILY_BUDGET_CENTS) return false;
    const next = { date: today, spent_cents: spent + 1 };
    await supa.from("app_settings").upsert(
      { key: "cohere_rerank_daily_spent", value: next },
      { onConflict: "key" },
    );
    return true;
  } catch (e) {
    console.warn("cohere budget check err", e);
    return true;
  }
}

export type CohereRerankInput = {
  id: string;
  text: string;
};

export async function cohereRerank(
  supa: any,
  q: string,
  candidates: CohereRerankInput[],
  topN = 10,
): Promise<{ ids: string[]; latency_ms: number } | null> {
  if (!COHERE_API_KEY) return null;
  if (!cbAllow()) return null;
  if (candidates.length < 5) return null;

  const ok = await checkAndIncrementBudget(supa);
  if (!ok) {
    console.log("cohere rerank: daily budget exhausted");
    return null;
  }

  const docs = candidates.map((c) => c.text.slice(0, 600));
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 1500);
  const t0 = Date.now();
  try {
    const r = await fetch("https://api.cohere.com/v2/rerank", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${COHERE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "rerank-v3.5",
        query: q.slice(0, 200),
        documents: docs,
        top_n: Math.min(topN, candidates.length),
      }),
    });
    clearTimeout(t);
    const latency = Date.now() - t0;
    if (!r.ok) {
      cbRecordFail();
      console.warn("cohere rerank http", r.status, await r.text().catch(() => ""));
      return null;
    }
    const j = await r.json();
    const results = Array.isArray(j?.results) ? j.results : [];
    const ids: string[] = [];
    for (const item of results) {
      const idx = typeof item?.index === "number" ? item.index : null;
      if (idx !== null && idx >= 0 && idx < candidates.length) {
        ids.push(candidates[idx].id);
      }
    }
    if (!ids.length) return null;
    return { ids, latency_ms: latency };
  } catch (e) {
    clearTimeout(t);
    cbRecordFail();
    console.warn("cohere rerank err", e);
    return null;
  }
}
