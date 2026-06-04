// YouTube chapter/timestamp PoC: extracts timestamped chapters from confirmed
// YouTube descriptions. No database writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type LinkRow = {
  id: string;
  episode_id: string;
  podcast_id: string;
  youtube_video_id: string | null;
  youtube_title: string | null;
  youtube_description: string | null;
  youtube_duration_seconds: number | null;
  match_score: number | null;
  validation_reason: any;
};

function parseTime(raw: string): number | null {
  const parts = raw.split(":").map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function cleanTitle(raw: string): string {
  return raw
    .replace(/^\s*[-–—•|)\].:]+\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}

function extractChapters(description: string, durationSeconds: number | null): Array<{ start_sec: number; title: string; raw: string }> {
  const lines = String(description || "").split(/\r?\n/);
  const chapters: Array<{ start_sec: number; title: string; raw: string }> = [];
  const seen = new Set<number>();
  const lineRe = /^\s*(?:(?:\[|\()?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\]|\))?\s*[-–—|:.)]?\s*(.{0,180})|(.{0,140}?)\s+((?:\d{1,2}:)?\d{1,2}:\d{2})\s*)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 260) continue;
    const m = trimmed.match(lineRe);
    if (!m) continue;
    const timeRaw = m[1] || m[4];
    const titleRaw = m[2] || m[3] || "";
    const start = parseTime(timeRaw);
    if (start === null || seen.has(start)) continue;
    if (durationSeconds && start > durationSeconds + 120) continue;
    const title = cleanTitle(titleRaw) || (start === 0 ? "Bevezető" : "Fejezet");
    seen.add(start);
    chapters.push({ start_sec: start, title, raw: trimmed });
  }

  return chapters
    .sort((a, b) => a.start_sec - b.start_sec)
    .filter((c, idx, arr) => idx === 0 || c.start_sec > arr[idx - 1].start_sec + 5);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(200, Number(body.limit || 50)));
    const minChapters = Math.max(2, Math.min(12, Number(body.min_chapters || 3)));
    const minMatchScore = Math.max(0, Math.min(1, Number(body.min_match_score || 0.84)));
    const episodeIds = Array.isArray(body.episode_ids) ? body.episode_ids.map(String).filter(Boolean).slice(0, limit) : [];

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let q = admin
      .from("episode_youtube_links")
      .select("id,episode_id,podcast_id,youtube_video_id,youtube_title,youtube_description,youtube_duration_seconds,match_score,validation_reason")
      .eq("status", "confirmed")
      .contains("validation_reason", { policy: "youtube_episode_match_v3" })
      .not("youtube_description", "is", null)
      .gte("match_score", minMatchScore)
      .order("match_score", { ascending: false })
      .limit(Math.max(limit * 8, 400));
    if (episodeIds.length) q = q.in("episode_id", episodeIds);

    const { data: rows, error } = await q;
    if (error) throw error;
    const links = (rows || []) as LinkRow[];
    const hits: any[] = [];
    let scanned = 0;

    for (const link of links) {
      scanned++;
      const chapters = extractChapters(link.youtube_description || "", link.youtube_duration_seconds);
      if (chapters.length < minChapters) continue;
      hits.push({
        episode_id: link.episode_id,
        podcast_id: link.podcast_id,
        youtube_video_id: link.youtube_video_id,
        youtube_title: link.youtube_title,
        match_score: link.match_score,
        duration_seconds: link.youtube_duration_seconds,
        chapter_count: chapters.length,
        chapters: chapters.slice(0, 12).map((c, idx) => ({ idx, start_sec: c.start_sec, title: c.title, raw: c.raw })),
      });
      if (hits.length >= limit) break;
    }

    const episodeIdsOut = [...new Set(hits.map((h) => h.episode_id))];
    const podcastIdsOut = [...new Set(hits.map((h) => h.podcast_id))];
    const { data: eps } = episodeIdsOut.length
      ? await admin.from("episodes").select("id,title,published_at").in("id", episodeIdsOut)
      : { data: [] as any[] };
    const { data: pods } = podcastIdsOut.length
      ? await admin.from("podcasts").select("id,title").in("id", podcastIdsOut)
      : { data: [] as any[] };
    const epById = new Map((eps || []).map((e: any) => [e.id, e]));
    const podById = new Map((pods || []).map((p: any) => [p.id, p]));

    return json({
      ok: true,
      mode: "youtube_chapters_poc_no_db_writes",
      summary: {
        candidate_links_scanned: scanned,
        hits: hits.length,
        hit_rate: scanned ? Number((hits.length / scanned).toFixed(4)) : 0,
        min_chapters: minChapters,
        min_match_score: minMatchScore,
      },
      results: hits.map((h) => ({
        ...h,
        podcast: podById.get(h.podcast_id)?.title || null,
        episode_title: epById.get(h.episode_id)?.title || null,
        published_at: epById.get(h.episode_id)?.published_at || null,
      })),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("youtube-chapters-poc error", msg);
    return json({ ok: false, error: msg }, 500);
  }
});