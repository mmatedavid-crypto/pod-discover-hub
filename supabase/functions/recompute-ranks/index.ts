// Recompute Podiverzum Rank for podcasts (and optionally episodes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Reason = { delta: number; note: string };

function labelFor(score: number, broken: boolean) {
  if (broken) return "Broken";
  if (score >= 10) return "Elite";
  if (score >= 8) return "Excellent";
  if (score >= 6) return "Strong";
  if (score >= 4) return "Medium";
  if (score >= 2) return "Weak";
  return "Poor";
}

function scorePodcast(p: any, eps: { count: number; latest: number | null }) {
  const reasons: Reason[] = [];
  let s = 1;
  reasons.push({ delta: 1, note: "base" });

  // Feed health
  const status = p.rss_status;
  const httpErr = (p.last_fetch_error || "").toLowerCase();
  if (status === "active") { s += 2; reasons.push({ delta: 2, note: "RSS active" }); }
  if (status === "failed") { s -= 3; reasons.push({ delta: -3, note: "RSS failed" }); }
  if (httpErr.includes("404")) { s -= 4; reasons.push({ delta: -4, note: "HTTP 404" }); }

  // Freshness
  const now = Date.now();
  if (eps.latest) {
    const ageDays = (now - eps.latest) / 86400000;
    if (ageDays <= 14) { s += 2; reasons.push({ delta: 2, note: "fresh ≤14d" }); }
    else if (ageDays <= 30) { s += 1; reasons.push({ delta: 1, note: "fresh ≤30d" }); }
    else if (ageDays > 180) { s -= 1; reasons.push({ delta: -1, note: "stale >180d" }); }
  }

  // Content depth
  if (eps.count >= 100) { s += 2; reasons.push({ delta: 2, note: "100+ episodes" }); }
  else if (eps.count >= 30) { s += 1; reasons.push({ delta: 1, note: "30+ episodes" }); }

  // Metadata
  if (p.image_url) { s += 1; reasons.push({ delta: 1, note: "has image" }); }
  if (p.description) { s += 1; reasons.push({ delta: 1, note: "has description" }); }
  if (p.website_url || p.apple_url || p.spotify_url) { s += 1; reasons.push({ delta: 1, note: "has external link" }); }

  // Language
  const lang = (p.language || "").toLowerCase();
  if (lang.startsWith("en")) { s += 1; reasons.push({ delta: 1, note: "English" }); }
  else if (lang && lang !== "hu") { s -= 2; reasons.push({ delta: -2, note: "non-English" }); }

  // Authority proxy
  if (eps.count >= 200) { s += 2; reasons.push({ delta: 2, note: "high catalog (200+)" }); }
  else if (eps.count >= 50) { s += 1; reasons.push({ delta: 1, note: "established catalog" }); }

  // Manual boost
  const boost = Math.max(-3, Math.min(3, p.manual_rank_boost || 0));
  if (boost !== 0) { s += boost; reasons.push({ delta: boost, note: "manual boost" }); }

  const broken = status === "failed" || httpErr.includes("404");
  const final = Math.max(1, Math.min(10, Math.round(s)));
  return { score: final, label: labelFor(final, broken), reasons, broken };
}

function scoreEpisode(e: any, podcastRank: number) {
  const reasons: Reason[] = [];
  let s = Math.max(1, Math.round(podcastRank * 0.6));
  reasons.push({ delta: s, note: "podcast baseline" });

  if (e.published_at) {
    const ageDays = (Date.now() - new Date(e.published_at).getTime()) / 86400000;
    if (ageDays <= 7) { s += 2; reasons.push({ delta: 2, note: "≤7d" }); }
    else if (ageDays <= 30) { s += 1; reasons.push({ delta: 1, note: "≤30d" }); }
    else if (ageDays > 365) { s -= 1; reasons.push({ delta: -1, note: ">1y" }); }
  }
  if (e.image_url) { s += 1; reasons.push({ delta: 1, note: "image" }); }
  if (e.description && e.description.length > 200) { s += 1; reasons.push({ delta: 1, note: "rich desc" }); }
  if (e.audio_url) { s += 1; reasons.push({ delta: 1, note: "audio" }); }

  const final = Math.max(1, Math.min(10, Math.round(s)));
  return { score: final, label: labelFor(final, false), reasons };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const onlyPodcastId: string | undefined = body.podcast_id;
    const includeEpisodes: boolean = body.episodes !== false;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let pq = supabase.from("podcasts").select("*");
    if (onlyPodcastId) pq = pq.eq("id", onlyPodcastId);
    const { data: pods, error: pErr } = await pq;
    if (pErr) throw pErr;

    // Aggregate episode counts/latest per podcast
    const ids = (pods || []).map((p: any) => p.id);
    const epsByPod: Record<string, { count: number; latest: number | null; rows: any[] }> = {};
    for (const id of ids) epsByPod[id] = { count: 0, latest: null, rows: [] };

    if (ids.length) {
      // batch in chunks of 50 ids to avoid query size
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const { data: eps } = await supabase
          .from("episodes")
          .select("id,podcast_id,published_at,image_url,description,audio_url")
          .in("podcast_id", chunk);
        (eps || []).forEach((e: any) => {
          const bucket = epsByPod[e.podcast_id];
          if (!bucket) return;
          bucket.count++;
          const t = e.published_at ? new Date(e.published_at).getTime() : 0;
          if (t && (!bucket.latest || t > bucket.latest)) bucket.latest = t;
          bucket.rows.push(e);
        });
      }
    }

    let podcastsUpdated = 0, episodesUpdated = 0;
    for (const p of pods || []) {
      const eps = epsByPod[p.id] || { count: 0, latest: null, rows: [] };
      const r = scorePodcast(p, { count: eps.count, latest: eps.latest });
      const { error } = await supabase.from("podcasts").update({
        podiverzum_rank: r.score,
        rank_label: r.label,
        rank_reason: { delta_total: r.score, broken: r.broken, factors: r.reasons },
        rank_updated_at: new Date().toISOString(),
      }).eq("id", p.id);
      if (!error) podcastsUpdated++;

      if (includeEpisodes && eps.rows.length) {
        for (const e of eps.rows) {
          const er = scoreEpisode(e, r.score);
          const { error: eErr } = await supabase.from("episodes").update({
            episode_rank: er.score,
            episode_rank_label: er.label,
            episode_rank_reason: { factors: er.reasons },
            episode_rank_updated_at: new Date().toISOString(),
          }).eq("id", e.id);
          if (!eErr) episodesUpdated++;
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, podcasts: podcastsUpdated, episodes: episodesUpdated }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
