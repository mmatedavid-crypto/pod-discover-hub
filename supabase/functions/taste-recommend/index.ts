// Personalized "Neked válogatva" recommendations for logged-in users.
// Reads the user's taste_vec from profiles, calls match_user_episodes RPC,
// hydrates episode + podcast metadata, returns 12-24 items.
//
// Fallback: if taste_signal_count < 3, we return recent S/A HU episodes ranked
// by simple topic overlap with the archetype's liked topics.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type EpisodeRow = {
  id: string;
  podcast_id: string;
  title: string;
  display_title: string | null;
  slug: string;
  published_at: string | null;
};

type PodcastRow = {
  id: string;
  slug: string;
  title: string;
  display_title: string | null;
  image_url: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return json({ error: "unauthorized" }, 401);
    }

    // Identify user with their JWT
    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const admin = createClient(url, service);

    // Load profile (taste vector status + archetype)
    const { data: profile } = await admin
      .from("profiles")
      .select("taste_vec, taste_signal_count, archetype_slug, archetype_result")
      .eq("user_id", userId)
      .maybeSingle();

    const signalCount = profile?.taste_signal_count ?? 0;
    const hasVector = !!profile?.taste_vec;

    let episodeIds: string[] = [];
    let mode: "personalized" | "archetype" | "fresh" = "fresh";

    if (hasVector && signalCount >= 0) {
      const { data: matches, error: matchErr } = await admin.rpc("match_user_episodes", {
        p_user: userId,
        p_limit: 24,
        p_freshness_days: 90,
      });
      if (matchErr) console.error("match_user_episodes error", matchErr);
      if (matches && matches.length > 0) {
        episodeIds = matches.map((m: { episode_id: string }) => m.episode_id);
        mode = "personalized";
      }
    }

    // Fallback: archetype topics -> recent HU S/A episodes by topic overlap
    if (episodeIds.length === 0) {
      const likedTopics: string[] = extractLikedTopics(profile?.archetype_result);
      const freshFallback = await admin
        .from("episodes")
        .select("id, podcast_id, topics, published_at, podcasts!inner(language, rank_label)")
        .ilike("podcasts.language", "hu%")
        .in("podcasts.rank_label", ["S", "A", "B"])
        .not("published_at", "is", null)
        .gt("published_at", new Date(Date.now() - 30 * 86400_000).toISOString())
        .order("published_at", { ascending: false })
        .limit(120);

      const rows = freshFallback.data ?? [];
      // exclude seen
      const { data: seenRows } = await admin
        .from("user_episode_interactions")
        .select("episode_id")
        .eq("user_id", userId)
        .gt("created_at", new Date(Date.now() - 60 * 86400_000).toISOString());
      const seen = new Set((seenRows ?? []).map((r) => r.episode_id));

      // score by topic overlap; dedupe podcast (max 2 per podcast)
      const scored: { id: string; podcast_id: string; score: number }[] = [];
      const perPodcast = new Map<string, number>();
      for (const r of rows) {
        if (seen.has(r.id)) continue;
        const topics: string[] = Array.isArray(r.topics) ? r.topics : [];
        const overlap = likedTopics.length
          ? topics.filter((t) => likedTopics.includes(t)).length
          : 0;
        scored.push({ id: r.id, podcast_id: r.podcast_id, score: overlap });
      }
      scored.sort((a, b) => b.score - a.score);
      for (const s of scored) {
        const cnt = perPodcast.get(s.podcast_id) ?? 0;
        if (cnt >= 2) continue;
        perPodcast.set(s.podcast_id, cnt + 1);
        episodeIds.push(s.id);
        if (episodeIds.length >= 24) break;
      }
      mode = likedTopics.length > 0 ? "archetype" : "fresh";
    }

    if (episodeIds.length === 0) {
      return json({ episodes: [], mode, signal_count: signalCount });
    }

    // Hydrate
    const { data: episodes } = await admin
      .from("episodes")
      .select("id, podcast_id, title, display_title, slug, published_at")
      .in("id", episodeIds);

    const podcastIds = Array.from(new Set((episodes ?? []).map((e) => e.podcast_id)));
    const { data: podcasts } = await admin
      .from("podcasts")
      .select("id, slug, title, display_title, image_url")
      .in("id", podcastIds);
    const podById = new Map<string, PodcastRow>((podcasts ?? []).map((p) => [p.id, p as PodcastRow]));

    // Preserve match ordering
    const epById = new Map<string, EpisodeRow>(
      (episodes ?? []).map((e) => [e.id, e as EpisodeRow]),
    );
    const ordered = episodeIds
      .map((id) => epById.get(id))
      .filter((e): e is EpisodeRow => !!e)
      .map((e) => {
        const p = podById.get(e.podcast_id);
        return {
          id: e.id,
          slug: e.slug,
          title: e.display_title || e.title,
          published_at: e.published_at,
          podcast: p
            ? {
                id: p.id,
                slug: p.slug,
                title: p.display_title || p.title,
                image_url: p.image_url,
              }
            : null,
        };
      });

    return json({
      episodes: ordered.slice(0, 12),
      mode,
      signal_count: signalCount,
    });
  } catch (e) {
    console.error("taste-recommend error", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function extractLikedTopics(archetypeResult: unknown): string[] {
  if (!archetypeResult || typeof archetypeResult !== "object") return [];
  const r = archetypeResult as Record<string, unknown>;
  const candidates = [
    r.liked_topics,
    r.likedTopics,
    r.topics,
    (r.preferences as Record<string, unknown> | undefined)?.topics,
  ];
  for (const c of candidates) {
    if (Array.isArray(c)) return c.filter((x) => typeof x === "string") as string[];
  }
  return [];
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
