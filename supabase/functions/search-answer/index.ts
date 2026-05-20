// search-answer: returns a 2-3 sentence Hungarian AI summary for the top episodes of a query.
// HU-only on podiverzum.hu — we no longer stream raw model tokens to the browser. The model is
// called once, validated by hu-language-guard, regenerated once if not Hungarian, and finally a
// Hungarian fallback is used. The response is emitted as a single SSE chunk so the client renders
// it identically to the old streamed path. This guarantees no English text ever reaches the user.
import { isHungarianish } from "../_shared/hu-language-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");

const SYS = `Magyar nyelvű podcast-kutatási asszisztens vagy a podiverzum.hu oldalon.
SZABÁLYOK:
- A válaszod KIZÁRÓLAG MAGYAR nyelvű lehet. Soha ne válaszolj angolul, akkor sem, ha a források angolok — fordítsd le természetes magyar nyelvre.
- 2-3 tömör, tényszerű mondat, amely megválaszolja a kérdést.
- Hivatkozz a forrás-epizódokra inline [1], [2] formában.
- Soha ne találj ki tényeket a forrás-leírásokon túl.
- Ne használj angol szavakat, hashtageket, emojikat.
- Ne nevezd magad asszisztensnek vagy MI-nek a szövegben.`;

function huFallback(q: string): string {
  return `A „${q}” kereséshez kapcsolódó magyar podcast epizódokat találtunk. Böngészd a találatokat, vagy pontosítsd a keresést egy témával, névvel vagy műsorcímmel.`;
}

async function callOnce(q: string, compact: any[], extra?: string): Promise<string> {
  const user = `Kérdés: ${q}\n\nLegjobb epizódok:\n${compact.map((c) => `[${c.i}] ${c.title} — ${c.podcast}\n  ${c.summary}`).join("\n")}\n\nÍrd meg a magyar nyelvű összefoglalót MOST.`;
  try {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        // Model policy v1: search_answer -> gemini-2.5-flash (HU user-facing answer).
        model: "google/gemini-2.5-flash",
        max_tokens: 900,
        messages: [
          { role: "system", content: SYS + (extra ? `\n${extra}` : "") },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) return "";
    const j = await r.json();
    return String(j?.choices?.[0]?.message?.content || "").trim();
  } catch (e) {
    console.warn("search-answer callOnce err", e);
    return "";
  }
}

function emitSse(text: string): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const payload = JSON.stringify({ choices: [{ delta: { content: text } }] });
      controller.enqueue(enc.encode(`data: ${payload}\n\n`));
      controller.enqueue(enc.encode(`data: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const q = String(body.q || "").trim();
    const episodes = Array.isArray(body.episodes) ? body.episodes.slice(0, 6) : [];
    if (!q || episodes.length === 0 || !LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: "missing input" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const compact = episodes.map((e: any, i: number) => ({
      i: i + 1,
      title: String(e.title || "").slice(0, 140),
      podcast: String(e.podcast || "").slice(0, 60),
      summary: String(e.summary || "").slice(0, 260),
    }));

    // Attempt 1
    const first = await callOnce(q, compact);
    if (first && isHungarianish(first)) return emitSse(first);

    if (first) console.warn("search-answer non-HU first try", { q, sample: first.slice(0, 80) });

    // Attempt 2 — explicit Hungarian-only reinforcement
    const second = await callOnce(q, compact, "FIGYELEM: A KORÁBBI válaszod nem magyar volt. KIZÁRÓLAG MAGYARUL válaszolj.");
    if (second && isHungarianish(second)) return emitSse(second);

    if (second) console.warn("search-answer non-HU second try", { q, sample: second.slice(0, 80) });

    // Fallback
    return emitSse(huFallback(q));
  } catch (e) {
    console.error("search-answer err", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
