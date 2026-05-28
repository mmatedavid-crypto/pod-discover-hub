// Returns Netflix-style personalized rows for a logged-in user.
// Main rail: vector-averaged "Mert hallgattad" recommendations from user_listen_history.
// Plus up to 3 per-seed rails: similar to each of the user's 3 most-recent unique episodes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) {
      return json({ error: "unauthorized" }, 401);
    }

    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) {
      return json({ error: "unauthorized" }, 401);
    }
    const userId = userData.user.id;

    const admin = createClient(url, service);

    // 1) Main rail: centroid of last ~20 listened episodes
    const { data: mainRows } = await admin.rpc("match_episodes_by_user_history", {
      p_user_id: userId,
      p_limit: 12,
    });

    // 2) Per-seed rails: 3 most-recent distinct seed episodes
    const { data: history } = await admin
      .from("user_listen_history")
      .select("episode_id, played_at, episodes:episode_id(id,title,display_title,slug,image_url,podcasts:podcast_id(slug,title,display_title,image_url))")
      .eq("user_id", userId)
      .order("played_at", { ascending: false })
      .limit(50);

    const seenIds = new Set<string>();
    const seeds: Array<{ id: string; title: string }> = [];
    for (const r of history || []) {
      const id = (r as any).episode_id as string;
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      const ep = (r as any).episodes;
      if (!ep) continue;
      seeds.push({ id, title: ep.display_title || ep.title });
      if (seeds.length >= 3) break;
    }

    const rails: Array<{ key: string; label: string; items: any[] }> = [];
    for (const s of seeds) {
      const { data: sim } = await admin.rpc("similar_episodes", {
        p_episode_id: s.id,
        p_limit: 8,
      });
      if (sim && sim.length) {
        rails.push({
          key: `seed:${s.id}`,
          label: `Mert hallgattad: ${s.title}`,
          items: sim,
        });
      }
    }

    return json({
      main: { label: "Neked ajánljuk", items: mainRows || [] },
      rails,
    });
  } catch (e) {
    console.error("personalized-home-rails error", e);
    return json({ error: "internal_error", message: String((e as Error)?.message || e) }, 500);
  }
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
