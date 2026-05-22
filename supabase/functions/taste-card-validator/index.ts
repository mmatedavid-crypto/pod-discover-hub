// Admin: validate taste_cards by finding nearest episodes (catalog fit).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const batch = Math.max(1, Math.min(200, Number(body.batch) || 50));

    const { data: cards, error } = await admin
      .from("taste_cards")
      .select("id,card_embedding,validation_status")
      .eq("active", true)
      .not("card_embedding", "is", null)
      .in("validation_status", body.force ? ["pending", "ok", "weak", "broken"] : ["pending"])
      .limit(batch);
    if (error) throw error;

    let ok = 0, weak = 0, broken = 0;
    for (const card of (cards || [])) {
      // Use the RPC to fetch top-20 nearest episodes
      const { data: matches, error: mErr } = await admin.rpc("match_episodes_by_taste_vector" as any, {
        p_user_vector: card.card_embedding as any,
        p_negative_vector: null,
        p_exclude_episode_ids: [],
        p_limit: 20,
      });
      if (mErr) continue;
      const list = (matches || []) as Array<{ similarity: number; podcast_id: string }>;
      const avgSim = list.length ? list.reduce((s, m) => s + Number(m.similarity || 0), 0) / list.length : 0;
      const distinctPodcasts = new Set(list.map(m => m.podcast_id)).size;
      const fit = avgSim * 0.7 + (Math.min(distinctPodcasts, 10) / 10) * 0.3;
      let status: "ok" | "weak" | "broken";
      if (avgSim >= 0.55 && distinctPodcasts >= 5) { status = "ok"; ok++; }
      else if (avgSim >= 0.4) { status = "weak"; weak++; }
      else { status = "broken"; broken++; }
      await admin
        .from("taste_cards")
        .update({
          top_episode_similarity: avgSim,
          catalog_fit_score: fit,
          validation_status: status,
        })
        .eq("id", card.id);
    }
    return json({ ok: true, processed: cards?.length || 0, ok_count: ok, weak, broken });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message) }, 500);
  }
});
