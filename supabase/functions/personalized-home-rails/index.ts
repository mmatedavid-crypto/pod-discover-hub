// Returns Netflix-style personalized rows for a logged-in user.
// Main rail: vector-averaged "Mert hallgattad" recommendations from user_listen_history.
// Plus up to 3 per-seed rails: similar to each of the user's 3 most-recent unique episodes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const MIN_DIAGNOSTIC_REASON_CHARS = 12;
const MIN_MAIN_RAIL_SIMILARITY = 0.18;
type DropReason = "low_similarity" | "missing_related_reason";
type RecommendationDiagnostics = {
  candidate_count: number;
  kept_count: number;
  dropped: Record<DropReason, number>;
};
type PersonalizedRail = {
  key: string;
  label: string;
  items: any[];
  diagnostics?: RecommendationDiagnostics;
};

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
    const mainCandidateRows = ((mainRows || []) as any[]);
    const mainDiagnostics = recommendationDiagnostics(mainCandidateRows, true);
    const safeMainRows = filterExplainableRecommendations(mainCandidateRows, true).slice(0, 12);

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

    const rails: PersonalizedRail[] = [];
    for (const s of seeds) {
      const { data: sim } = await admin.rpc("similar_episodes", {
        p_episode_id: s.id,
        p_limit: 8,
      });
      const seedCandidateRows = ((sim || []) as any[]);
      const seedDiagnostics = recommendationDiagnostics(seedCandidateRows, false);
      const safeItems = filterExplainableRecommendations(seedCandidateRows, false).slice(0, 8);
      if (safeItems.length) {
        rails.push({
          key: `seed:${s.id}`,
          label: `Mert hallgattad: ${s.title}`,
          items: safeItems,
          diagnostics: seedDiagnostics,
        });
      }
    }

    return json({
      main: { label: "Neked ajánljuk", items: safeMainRows },
      rails,
      policy: {
        surface: "personalized-home-rails",
        main_rail_source: "match_episodes_by_user_history",
        main_rail_min_similarity: MIN_MAIN_RAIL_SIMILARITY,
        related_reason_required_for_main_rail: true,
        seed_rails_source: "similar_episodes",
        related_reason_required_for_seed_rails: true,
      },
      diagnostics: {
        main: mainDiagnostics,
        seed_count: seeds.length,
        returned_seed_rail_count: rails.length,
      },
    });
  } catch (e) {
    console.error("personalized-home-rails error", e);
    return json({ error: "internal_error", message: String((e as Error)?.message || e) }, 500);
  }
});

function hasDiagnosticRelatedReason(row: any): boolean {
  const reason = String(row?.related_reason || "").trim();
  return reason.length >= MIN_DIAGNOSTIC_REASON_CHARS;
}

function hasMinimumMainRailSimilarity(row: any): boolean {
  return Number(row?.similarity || 0) >= MIN_MAIN_RAIL_SIMILARITY;
}

function filterExplainableRecommendations(rows: any[], requireMainSimilarity: boolean): any[] {
  return rows.filter((row) => {
    if (requireMainSimilarity && !hasMinimumMainRailSimilarity(row)) return false;
    return hasDiagnosticRelatedReason(row);
  });
}

function recommendationDiagnostics(rows: any[], requireMainSimilarity: boolean): RecommendationDiagnostics {
  const dropped: Record<DropReason, number> = {
    low_similarity: 0,
    missing_related_reason: 0,
  };
  let kept = 0;
  for (const row of rows) {
    if (requireMainSimilarity && !hasMinimumMainRailSimilarity(row)) {
      dropped.low_similarity++;
      continue;
    }
    if (!hasDiagnosticRelatedReason(row)) {
      dropped.missing_related_reason++;
      continue;
    }
    kept++;
  }
  return {
    candidate_count: rows.length,
    kept_count: kept,
    dropped,
  };
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
