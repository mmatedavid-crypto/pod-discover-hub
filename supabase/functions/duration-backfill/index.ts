// duration-backfill: fills episodes.duration_seconds for HU episodes
// using existing enrichment data — Spotify first (episode_spotify_meta.duration_ms),
// YouTube second (episode_youtube_links.youtube_duration_seconds). $0 cost.
//
// Body: { limit?: number, source?: 'spotify'|'youtube'|'all' }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let body: { limit?: number; source?: string } = {};
  try { body = await req.json(); } catch { /* */ }
  const limit = Math.max(1, Math.min(5000, body.limit ?? 2000));
  const source = body.source ?? "all";

  let spotifyFilled = 0;
  let ytFilled = 0;

  if (source === "all" || source === "spotify") {
    // HU episodes missing duration, with Spotify duration_ms available
    const { data: rows } = await supa.rpc("__noop_unused__", {}).then(() => ({ data: null as any }))
      .catch(() => ({ data: null }));
    // Direct query via PostgREST: join via two-step (fetch ids missing duration, then map)
    const { data: ep } = await supa
      .from("episodes")
      .select("id, podcasts!inner(language), episode_spotify_meta!inner(duration_ms)")
      .is("duration_seconds", null)
      .ilike("podcasts.language", "hu%")
      .not("episode_spotify_meta.duration_ms", "is", null)
      .limit(limit);
    for (const r of (ep as any[] ?? [])) {
      const ms = r.episode_spotify_meta?.duration_ms ?? r.episode_spotify_meta?.[0]?.duration_ms;
      const secs = ms ? Math.round(ms / 1000) : null;
      if (!secs || secs < 5 || secs > 86400) continue;
      const { error } = await supa.from("episodes").update({ duration_seconds: secs }).eq("id", r.id).is("duration_seconds", null);
      if (!error) spotifyFilled++;
    }
  }

  if (source === "all" || source === "youtube") {
    const ytLimit = source === "all" ? Math.max(500, limit - spotifyFilled) : limit;
    const { data: ep } = await supa
      .from("episodes")
      .select("id, podcasts!inner(language), episode_youtube_links!inner(youtube_duration_seconds)")
      .is("duration_seconds", null)
      .ilike("podcasts.language", "hu%")
      .not("episode_youtube_links.youtube_duration_seconds", "is", null)
      .limit(ytLimit);
    for (const r of (ep as any[] ?? [])) {
      const secs = r.episode_youtube_links?.youtube_duration_seconds ?? r.episode_youtube_links?.[0]?.youtube_duration_seconds;
      if (!secs || secs < 5 || secs > 86400) continue;
      const { error } = await supa.from("episodes").update({ duration_seconds: secs }).eq("id", r.id).is("duration_seconds", null);
      if (!error) ytFilled++;
    }
  }

  return new Response(JSON.stringify({ ok: true, spotify_filled: spotifyFilled, youtube_filled: ytFilled }), {
    headers: { ...cors, "Content-Type": "application/json" },
  });
});
