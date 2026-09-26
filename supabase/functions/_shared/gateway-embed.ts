// deno-lint-ignore-file no-explicit-any
declare const Deno: { env: { get(key: string): string | undefined } };
// Shared 768-dim embedding helper.
//
// 2026-09-22: embeddings run on the Lovable AI Gateway. The legacy direct
// Google Generative Language key stays only as a fallback for the transition,
// so a gateway hiccup cannot stall the pipelines.

const GATEWAY_EMBEDDINGS_URL = "https://ai.gateway.lovable.dev/v1/embeddings";
const NATIVE_URL = (model: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:embedContent`;

export const EMBED_DIM = 768;

function bareModel(model: string): string {
  return String(model || "gemini-embedding-001").replace(/^google\//, "").replace(/^models\//, "");
}

/**
 * Returns a 768-dim embedding, or null when neither route produced one.
 * `taskType` is only used by the legacy fallback route.
 */
export async function embedText(
  text: string,
  opts?: { model?: string; taskType?: string },
): Promise<number[] | null> {
  const bare = bareModel(opts?.model || "gemini-embedding-001");
  const lovableKey = Deno.env.get("LOVABLE_API_KEY");

  if (lovableKey) {
    if (await creditBreakerOpen()) return null;
    try {
      const res = await fetch(GATEWAY_EMBEDDINGS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${lovableKey}` },
        body: JSON.stringify({ model: `google/${bare}`, input: text, dimensions: EMBED_DIM }),
      });
      if (res.ok) {
        const j = await res.json();
        const vec = j?.data?.[0]?.embedding as number[] | undefined;
        if (vec && vec.length === EMBED_DIM) return vec;
        console.warn("[gateway-embed] unexpected gateway payload");
      } else {
        console.warn(`[gateway-embed] gateway HTTP ${res.status}`);
        if (res.status === 402) { await tripCreditBreaker("gateway-embed"); return null; }
      }
    } catch (e) {
      console.warn("[gateway-embed] gateway error", String(e).slice(0, 200));
    }
  }

  const legacyKey = Deno.env.get("GEMINI_API_KEY_TIER1")
    || Deno.env.get("GEMINI_API_KEY")
    || Deno.env.get("GEMINI_API_KEY_FREE");
  if (!legacyKey) return null;
  try {
    const res = await fetch(`${NATIVE_URL(bare)}?key=${legacyKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: `models/${bare}`,
        content: { parts: [{ text }] },
        taskType: opts?.taskType || "SEMANTIC_SIMILARITY",
        outputDimensionality: EMBED_DIM,
      }),
    });
    if (!res.ok) {
      console.warn(`[gateway-embed] legacy HTTP ${res.status}`);
      return null;
    }
    const j = await res.json();
    const vec = j?.embedding?.values as number[] | undefined;
    return vec && vec.length === EMBED_DIM ? vec : null;
  } catch (e) {
    console.warn("[gateway-embed] legacy error", String(e).slice(0, 200));
    return null;
  }
}
