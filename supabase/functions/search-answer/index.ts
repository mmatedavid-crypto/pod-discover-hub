// search-answer: streams a 2-3 sentence Hungarian AI summary of the top episodes for a query.
// POST { q: string, episodes: [{title,podcast,summary}] }  -> SSE stream
// HU-only on podiverzum.hu — uses hu-language-guard for non-stream fallback when stream fails.
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

async function nonStreamHu(q: string, compact: any[]): Promise<string> {
  const user = `Kérdés: ${q}\n\nLegjobb epizódok:\n${compact.map((c) => `[${c.i}] ${c.title} — ${c.podcast}\n  ${c.summary}`).join("\n")}\n\nÍrd meg a magyar nyelvű összefoglalót MOST.`;
  const attempt = async (extra?: string) => {
    const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYS + (extra ? `\n${extra}` : "") },
          { role: "user", content: user },
        ],
      }),
    });
    if (!r.ok) return "";
    const j = await r.json();
    return String(j?.choices?.[0]?.message?.content || "").trim();
  };
  const first = await attempt();
  if (first && isHungarianish(first)) return first;
  const second = await attempt("FIGYELEM: A KORÁBBI válaszod nem magyar volt. KIZÁRÓLAG MAGYARUL válaszolj.");
  if (second && isHungarianish(second)) return second;
  return huFallback(q);
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
    const user = `Kérdés: ${q}\n\nLegjobb epizódok:\n${compact.map((c) => `[${c.i}] ${c.title} — ${c.podcast}\n  ${c.summary}`).join("\n")}\n\nÍrd meg a magyar nyelvű összefoglalót MOST.`;

    const upstream = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [{ role: "system", content: SYS }, { role: "user", content: user }],
        stream: true,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      // Non-stream HU fallback path with guard.
      const text = await nonStreamHu(q, compact);
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          // Emit as a single SSE chunk so the client renders it identically.
          const payload = JSON.stringify({ choices: [{ delta: { content: text } }] });
          controller.enqueue(enc.encode(`data: ${payload}\n\n`));
          controller.enqueue(enc.encode(`data: [DONE]\n\n`));
          controller.close();
        },
      });
      return new Response(stream, { headers: { ...corsHeaders, "Content-Type": "text/event-stream" } });
    }

    // Tee stream — pass through to client while we also accumulate to language-check.
    const [a, b] = upstream.body.tee();

    // Background language-check; if non-HU, log only (we cannot rewind the user's stream).
    (async () => {
      try {
        const reader = b.getReader();
        const dec = new TextDecoder();
        let buf = "", acc = "", done = false;
        while (!done) {
          const { done: d, value } = await reader.read();
          if (d) break;
          buf += dec.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, nl).replace(/\r$/, ""); buf = buf.slice(nl + 1);
            if (!line.startsWith("data: ")) continue;
            const js = line.slice(6).trim();
            if (js === "[DONE]") { done = true; break; }
            try {
              const p = JSON.parse(js);
              const c = p?.choices?.[0]?.delta?.content;
              if (c) acc += c;
            } catch { /* ignore */ }
          }
        }
        if (acc && !isHungarianish(acc)) {
          console.warn("search-answer non-HU output detected", { q, sample: acc.slice(0, 80) });
        }
      } catch (e) { console.warn("hu guard tee", e); }
    })();

    return new Response(a, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("search-answer err", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
