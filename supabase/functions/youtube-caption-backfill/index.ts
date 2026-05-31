// youtube-caption-backfill: backfills `youtube_caption_available` on
// `episode_youtube_links` rows where it is NULL.
//
// The youtube-episode-pairer already sets this flag for every NEW pairing.
// This runner only exists to fill in legacy confirmed links pair'd before the
// flag was captured — so that youtube-transcript-fetch (which only spends a
// Supadata credit when caption_available=true) can reach them.
//
// Quota: videos.list?part=contentDetails is 1 unit per 50 video IDs. 6500
// legacy videos = ~130 units (default daily quota is 10000).
//
// Invoke:
//   POST /youtube-caption-backfill { "limit": 1000 }  // default 1000
//   POST /youtube-caption-backfill { "limit": 50, "dry": true }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const YT_KEY = Deno.env.get("YOUTUBE_API_KEY");

async function fetchCaptionFlags(videoIds: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (!videoIds.length) return out;
  const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails&id=${videoIds.join(",")}&key=${YT_KEY}`;
  const r = await fetch(url);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`yt_videos_${r.status}: ${text.slice(0, 200)}`);
  }
  const j = await r.json();
  for (const it of j.items || []) {
    const id = it.id;
    const cap = String(it.contentDetails?.caption || "").toLowerCase() === "true";
    if (id) out.set(id, cap);
  }
  // Videos that don't come back (deleted/private) → mark false so we don't retry
  for (const id of videoIds) if (!out.has(id)) out.set(id, false);
  return out;
}

async function drain(limit: number): Promise<{ checked: number; captioned: number; no_caption: number; errors: number; batches: number }> {
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: rows, error } = await admin
    .from("episode_youtube_links")
    .select("youtube_video_id")
    .eq("status", "confirmed")
    .is("youtube_caption_available", null)
    .limit(limit * 2);
  if (error) throw new Error(error.message);

  const uniqueVideoIds = [...new Set((rows || []).map((r: any) => r.youtube_video_id).filter(Boolean))].slice(0, limit);
  let checked = 0, captioned = 0, no_caption = 0, errors = 0, batches = 0;
  const nowIso = new Date().toISOString();

  for (let i = 0; i < uniqueVideoIds.length; i += 50) {
    const batch = uniqueVideoIds.slice(i, i + 50);
    batches++;
    let flags: Map<string, boolean>;
    try {
      flags = await fetchCaptionFlags(batch);
    } catch (e) {
      errors++;
      console.warn("batch_err", String(e));
      continue;
    }
    // Update all rows for each video — run within-batch updates in parallel.
    const updates = [...flags.entries()].map(async ([videoId, hasCaption]) => {
      const { error: upErr } = await admin
        .from("episode_youtube_links")
        .update({
          youtube_caption_available: hasCaption,
          youtube_caption_checked_at: nowIso,
        })
        .eq("youtube_video_id", videoId)
        .is("youtube_caption_available", null);
      if (upErr) return { ok: false, hasCaption };
      return { ok: true, hasCaption };
    });
    const results = await Promise.all(updates);
    for (const r of results) {
      if (!r.ok) { errors++; continue; }
      checked++;
      if (r.hasCaption) captioned++; else no_caption++;
    }
  }
  console.log(`backfill done: checked=${checked} captioned=${captioned} no_caption=${no_caption} errors=${errors} batches=${batches}`);
  return { checked, captioned, no_caption, errors, batches };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!YT_KEY) return json({ error: "missing_YOUTUBE_API_KEY" }, 500);

  let body: any = {};
  try { body = await req.json(); } catch { /* GET ok */ }

  const limit = Math.min(Math.max(Number(body?.limit) || 800, 1), 5000);
  const dry = body?.dry === true;
  const sync = body?.sync === true;

  if (dry) {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: rows } = await admin
      .from("episode_youtube_links")
      .select("youtube_video_id")
      .eq("status", "confirmed")
      .is("youtube_caption_available", null)
      .limit(limit * 2);
    const uniq = [...new Set((rows || []).map((r: any) => r.youtube_video_id).filter(Boolean))].slice(0, limit);
    return json({ ok: true, dry: true, would_check: uniq.length });
  }

  if (sync) {
    const r = await drain(limit);
    return json({ ok: true, mode: "sync", ...r });
  }

  // Background drain so HTTP client doesn't time out.
  // @ts-ignore EdgeRuntime is provided by Supabase edge runtime
  EdgeRuntime.waitUntil(drain(limit).catch((e) => console.error("drain_err", e)));
  return json({ ok: true, mode: "background", started: limit }, 202);
});
