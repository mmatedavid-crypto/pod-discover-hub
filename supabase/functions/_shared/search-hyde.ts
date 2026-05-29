// HyDE (Hypothetical Document Embeddings) helper.
// For conceptual topic/question queries, ask a small LLM to write a 2-sentence
// hypothetical podcast episode description that would perfectly answer the
// query. We embed that text and use it as a SECOND query embedding alongside
// the user's raw query embedding.
//
// Cached in `search_hyde_cache` for 7 days per normalized query.

import { callLovableAI } from "./lovable-ai.ts";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");

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
    console.warn("hyde circuit_breaker_open for", CB_COOLDOWN_MS, "ms");
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | null> {
  return await new Promise<T | null>((resolve) => {
    const t = setTimeout(() => { console.warn(`${label} timeout ${ms}ms`); resolve(null); }, ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch((e) => { clearTimeout(t); console.warn(`${label} err`, e); resolve(null); });
  });
}

async function generateHydeText(q: string): Promise<string | null> {
  if (!cbAllow()) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2300);
  try {
    const ai = await Promise.race([
      callLovableAI({
        model: "google/gemini-2.5-flash-lite",
        job_type: "search_hyde",
        target_type: "search_query",
        prompt_version: "search-hyde-v2",
        input_text: q,
        min_input_chars: 2,
        messages: [
          { role: "system", content: "Írj egyetlen 2 mondatos hipotetikus podcast-epizód leírást magyarul, amely tökéletesen megválaszolja a felhasználó keresését. Természetes, konkrét nyelvezet, ahogy egy igazi podcast leírás szólna. Nincs bevezető, idézőjel vagy markdown — csak a leírás." },
          { role: "user", content: q.slice(0, 200) },
        ],
        max_tokens: 200,
      }),
      new Promise<null>((resolve) => {
        ctrl.signal.addEventListener("abort", () => resolve(null), { once: true });
      }),
    ]);
    clearTimeout(t);
    if (!ai || !ai.ok) {
      if ((ai?.status || 0) >= 500 || ai?.status === 429) cbRecordFail();
      return null;
    }
    const j = ai.data;
    const txt = j?.choices?.[0]?.message?.content;
    if (typeof txt !== "string" || txt.length < 20) return null;
    return txt.trim().slice(0, 600);
  } catch (e) {
    clearTimeout(t);
    cbRecordFail();
    console.warn("hyde gen err", e);
    return null;
  }
}

async function embedHyde(text: string): Promise<number[] | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text }] },
        taskType: "RETRIEVAL_DOCUMENT",
        outputDimensionality: 768,
      }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    const v = j?.embedding?.values as number[] | undefined;
    return v && v.length === 768 ? v : null;
  } catch (e) { console.warn("hyde embed err", e); return null; }
}

export type HydeResult = {
  hyde_text: string;
  embedding: number[];
  cache_hit: boolean;
};

export async function getHydeExpansion(supa: any, qNorm: string, q: string): Promise<HydeResult | null> {
  try {
    const { data: cached } = await supa
      .from("search_hyde_cache")
      .select("hyde_text, embedding, created_at")
      .eq("q_norm", qNorm)
      .maybeSingle();
    if (cached && cached.created_at && Date.now() - new Date(cached.created_at).getTime() < 7 * 24 * 3600 * 1000) {
      let emb: number[] | null = null;
      if (typeof cached.embedding === "string") {
        try { const arr = JSON.parse(cached.embedding); if (Array.isArray(arr) && arr.length === 768) emb = arr; } catch { /* ignore */ }
      } else if (Array.isArray(cached.embedding) && cached.embedding.length === 768) {
        emb = cached.embedding as number[];
      }
      if (emb && cached.hyde_text) {
        return { hyde_text: cached.hyde_text, embedding: emb, cache_hit: true };
      }
    }
  } catch (e) { console.warn("hyde cache read err", e); }

  // Quality-first: HyDE materially improves conceptual topic queries; give it room.
  const hydeText = await withTimeout(generateHydeText(q), 2500, "hyde-gen");
  if (!hydeText) return null;
  const emb = await withTimeout(embedHyde(hydeText), 2500, "hyde-embed");
  if (!emb) return null;

  supa.from("search_hyde_cache").upsert({
    q_norm: qNorm,
    hyde_text: hydeText,
    embedding: `[${emb.join(",")}]`,
    created_at: new Date().toISOString(),
  }, { onConflict: "q_norm" }).then(() => {}, (e: unknown) => console.warn("hyde cache write", e));

  return { hyde_text: hydeText, embedding: emb, cache_hit: false };
}

export function blendEmbeddings(orig: number[], hyde: number[], wOrig = 0.6): number[] {
  if (orig.length !== hyde.length) return orig;
  const wH = 1 - wOrig;
  const out = new Array<number>(orig.length);
  for (let i = 0; i < orig.length; i++) out[i] = orig[i] * wOrig + hyde[i] * wH;
  let s = 0;
  for (let i = 0; i < out.length; i++) s += out[i] * out[i];
  const n = Math.sqrt(s) || 1;
  for (let i = 0; i < out.length; i++) out[i] = out[i] / n;
  return out;
}
