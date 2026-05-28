// On-demand chapter generator for a single episode.
// Reads episode_chunks (text + char offsets approximating order), asks Lovable AI
// for 4-8 chapters with rough start_sec (interpolated from chunk order if no timings),
// and stores them in episode_chapters. Safe to call repeatedly: skips if chapters exist.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const { episode_id } = await req.json().catch(() => ({}));
    if (!episode_id || typeof episode_id !== "string") {
      return json({ error: "episode_id required" }, 400);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const aiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!aiKey) return json({ error: "ai_key_missing" }, 500);

    const admin = createClient(url, service);

    // Already generated?
    const { data: existing } = await admin
      .from("episode_chapters")
      .select("id")
      .eq("episode_id", episode_id)
      .limit(1);
    if (existing && existing.length) {
      const { data: rows } = await admin
        .from("episode_chapters")
        .select("idx,start_sec,title,summary")
        .eq("episode_id", episode_id)
        .order("idx");
      return json({ status: "cached", chapters: rows || [] });
    }

    // Pull chunks
    const { data: chunks } = await admin
      .from("episode_chunks")
      .select("chunk_idx, content")
      .eq("episode_id", episode_id)
      .order("chunk_idx");

    if (!chunks || chunks.length < 2) {
      return json({ status: "insufficient_chunks", chapters: [] });
    }

    // Estimate episode duration so we can map chunk_idx → start_sec.
    const { data: epRow } = await admin
      .from("episodes")
      .select("duration_seconds, audio_duration_seconds")
      .eq("id", episode_id)
      .maybeSingle();
    const dur =
      (epRow as any)?.duration_seconds ||
      (epRow as any)?.audio_duration_seconds ||
      Math.max(900, chunks.length * 60); // fallback ~1 min/chunk

    // Build compact prompt — cap content per chunk to keep tokens sane.
    const lines = chunks.slice(0, 60).map((c: any) => {
      const text = (c.content || "").replace(/\s+/g, " ").trim().slice(0, 400);
      return `[${c.chunk_idx}] ${text}`;
    });

    const system = `Magyar podcast epizódhoz fejezeteket írsz. Csak a megadott szövegrészletekre támaszkodj. NE találj ki tartalmat. Válaszolj kizárólag valid JSON-nal a megadott séma szerint.`;
    const user = `A következő számozott szövegblokkok egy podcast epizód időrendben sorba rendezett részletei. Adj vissza 4–8 fejezetet az epizódhoz.

Mindegyik fejezethez:
- "start_chunk": az első chunk_idx szám, ahol a fejezet kezdődik (a [szám] alapján)
- "title": rövid, érdekes magyar fejezetcím (max 60 karakter)
- "summary": 1 mondatos magyar összefoglaló (max 140 karakter)

Az első fejezet "start_chunk" értéke legyen a legkisebb chunk_idx. A fejezetek időben szigorúan növekvő sorrendben legyenek.

Szövegblokkok:
${lines.join("\n")}

Válaszolj így (csak JSON, semmi más):
{"chapters":[{"start_chunk":0,"title":"…","summary":"…"}, ...]}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!aiRes.ok) {
      const txt = await aiRes.text();
      return json({ error: "ai_error", status: aiRes.status, body: txt.slice(0, 500) }, 502);
    }
    const aiJson = await aiRes.json();
    let parsed: any = {};
    try {
      parsed = JSON.parse(aiJson?.choices?.[0]?.message?.content || "{}");
    } catch {
      return json({ error: "parse_error" }, 502);
    }
    const items = Array.isArray(parsed.chapters) ? parsed.chapters : [];
    if (!items.length) return json({ status: "empty", chapters: [] });

    const totalChunks = Math.max(...chunks.map((c: any) => c.chunk_idx)) + 1;
    const rows: Array<{
      episode_id: string;
      idx: number;
      start_sec: number;
      title: string;
      summary: string | null;
    }> = [];
    items.forEach((it: any, i: number) => {
      const startChunk = Math.max(0, Math.min(totalChunks - 1, Number(it.start_chunk) || 0));
      const startSec = Math.round((startChunk / totalChunks) * dur);
      const title = String(it.title || "").trim().slice(0, 80);
      if (!title) return;
      rows.push({
        episode_id,
        idx: i,
        start_sec: startSec,
        title,
        summary: it.summary ? String(it.summary).trim().slice(0, 200) : null,
      });
    });

    if (!rows.length) return json({ status: "empty", chapters: [] });

    // Force monotonically increasing start_sec
    for (let i = 1; i < rows.length; i++) {
      if (rows[i].start_sec <= rows[i - 1].start_sec) {
        rows[i].start_sec = rows[i - 1].start_sec + 1;
      }
    }

    const { error: insErr } = await admin.from("episode_chapters").insert(rows);
    if (insErr) {
      console.error("insert error", insErr);
      return json({ error: "insert_failed", message: insErr.message }, 500);
    }

    return json({ status: "generated", chapters: rows.map((r) => ({
      idx: r.idx, start_sec: r.start_sec, title: r.title, summary: r.summary,
    })) });
  } catch (e) {
    console.error("episode-chapters-generator error", e);
    return json({ error: "internal", message: String((e as Error)?.message || e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
