// youtube-views-backfill — refreshes youtube_view_count on confirmed episode_youtube_links
// Batches 50 video IDs per YouTube Data API videos.list call (very cheap on quota: 1 unit/call).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const YT_KEY = Deno.env.get("YOUTUBE_API_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Number(body.limit) || 2000, 5000);
    const mode: "missing" | "refresh" | "all" = body.mode || "missing";
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);

    // Pick rows to update
    let q = sb
      .from("episode_youtube_links")
      .select("id, youtube_video_id, youtube_view_count, updated_at")
      .eq("status", "confirmed")
      .not("youtube_video_id", "is", null);
    if (mode === "missing") q = q.is("youtube_view_count", null);
    else if (mode === "refresh") {
      const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
      q = q.or(`youtube_view_count.is.null,updated_at.lt.${cutoff}`);
    }
    const { data: rows, error } = await q.limit(limit);
    if (error) throw error;
    if (!rows?.length) {
      return json({ ok: true, processed: 0, updated: 0, mode });
    }

    // Dedupe by video_id
    const byVid = new Map<string, string>(); // videoId -> link id (last one wins)
    for (const r of rows) byVid.set(r.youtube_video_id!, r.id);
    const videoIds = [...byVid.keys()];

    let updated = 0;
    let notFound = 0;

    for (let i = 0; i < videoIds.length; i += 50) {
      const chunk = videoIds.slice(i, i + 50);
      const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${chunk.join(",")}&key=${YT_KEY}`;
      const r = await fetch(url);
      if (!r.ok) {
        const txt = await r.text();
        console.error("yt videos.list failed", r.status, txt.slice(0, 300));
        if (r.status === 403) {
          return json({ ok: false, error: "youtube_quota_or_auth", status: 403, body: txt.slice(0, 300) }, 500);
        }
        continue;
      }
      const j = await r.json();
      const items: any[] = j?.items || [];
      const seen = new Set<string>();
      const updates: Array<{ id: string; views: number }> = [];
      for (const it of items) {
        seen.add(it.id);
        const views = Number(it.statistics?.viewCount || 0);
        updates.push({ id: byVid.get(it.id)!, views });
      }
      // batch update
      for (const u of updates) {
        const { error: upErr } = await sb
          .from("episode_youtube_links")
          .update({ youtube_view_count: u.views, updated_at: new Date().toISOString() })
          .eq("id", u.id);
        if (!upErr) updated++;
      }
      // Mark not-found videos (deleted/private) so we don't refetch forever
      for (const vid of chunk) {
        if (!seen.has(vid)) {
          notFound++;
          await sb
            .from("episode_youtube_links")
            .update({ youtube_view_count: 0, updated_at: new Date().toISOString() })
            .eq("id", byVid.get(vid)!);
        }
      }
    }

    return json({ ok: true, processed: videoIds.length, updated, not_found: notFound, mode });
  } catch (e: any) {
    console.error("youtube-views-backfill error", e);
    return json({ ok: false, error: String(e?.message || e) }, 500);
  }
});

function json(b: unknown, status = 200) {
  return new Response(JSON.stringify(b), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
