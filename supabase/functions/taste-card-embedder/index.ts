// Admin: embed taste_cards.hidden_embedding_prompt -> taste_cards.card_embedding (768D)
// Uses google/gemini-embedding-001 (same as episode_embeddings) for vector-space parity.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

async function embed(text: string): Promise<number[]> {
  const apiKey = Deno.env.get("GEMINI_API_KEY_TIER1")
    || Deno.env.get("GEMINI_API_KEY")
    || Deno.env.get("GEMINI_API_KEY_FREE");
  if (!apiKey) throw new Error("missing_gemini_api_key");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "models/gemini-embedding-001",
      content: { parts: [{ text }] },
      taskType: "SEMANTIC_SIMILARITY",
      outputDimensionality: 768,
    }),
  });
  if (!res.ok) throw new Error(`gemini_${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  const vec = j.embedding?.values as number[] | undefined;
  if (!vec || vec.length !== 768) throw new Error("bad_embedding");
  return vec;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const batch = Math.max(1, Math.min(100, Number(body.batch) || 40));
    const force = body.force === true;

    let q = admin.from("taste_cards").select("id,hidden_embedding_prompt,card_embedding").eq("active", true).limit(batch);
    if (!force) q = q.is("card_embedding", null);
    const { data, error } = await q;
    if (error) throw error;

    let ok = 0, fail = 0;
    const errors: any[] = [];
    for (const row of (data || [])) {
      try {
        const vec = await embed(String(row.hidden_embedding_prompt || "").slice(0, 4000));
        const literal = `[${vec.join(",")}]`;
        const { error: upErr } = await admin
          .from("taste_cards")
          .update({ card_embedding: literal as any, validation_status: "pending" })
          .eq("id", row.id);
        if (upErr) throw upErr;
        ok++;
      } catch (e) {
        fail++;
        errors.push({ id: row.id, err: String((e as Error).message) });
      }
    }
    return json({ ok: true, processed: data?.length || 0, success: ok, failed: fail, errors: errors.slice(0, 5) });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message) }, 500);
  }
});
