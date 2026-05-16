// youtube-episode-pairer: for podcasts with youtube_channel_id, list channel
// uploads playlist, fuzzy-match against RSS episodes, write episode_youtube_links.
//
// Quota:
//  - channels.list?part=contentDetails  => 1 unit (get uploads playlist ID)
//  - playlistItems.list?part=snippet&max=50 => 1 unit per page
// So a 200-episode channel = ~5 units. Very cheap vs channel scout (100 units).
//
// Pilot: ?pilot=N&dry=1 -> only N podcasts, no DB writes.
// Auto-pair if score >= auto_pair_threshold; else AI validate; else skip.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { titleSim } from "../_shared/title-similarity.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const YT_KEY = Deno.env.get("YOUTUBE_API_KEY");
const LOVABLE_KEY = Deno.env.get("LOVABLE_API_KEY");

async function getUploadsPlaylistId(channelId: string): Promise<string | null> {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=${channelId}&key=${YT_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`yt_ch_contentDetails_${r.status}`);
  const j = await r.json();
  return j.items?.[0]?.contentDetails?.relatedPlaylists?.uploads || null;
}

async function listPlaylist(playlistId: string, max: number): Promise<any[]> {
  const all: any[] = [];
  let pageToken: string | undefined = undefined;
  while (all.length < max) {
    const params = new URLSearchParams({
      part: "snippet,contentDetails",
      playlistId, maxResults: "50", key: YT_KEY!,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const r = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`);
    if (!r.ok) throw new Error(`yt_playlist_${r.status}`);
    const j = await r.json();
    for (const it of j.items || []) all.push(it);
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }
  return all.slice(0, max);
}

async function aiValidatePair(model: string, epTitle: string, ytTitle: string, ytDesc: string): Promise<boolean> {
  if (!LOVABLE_KEY) return false;
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${LOVABLE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Decide if the YouTube video is the same Hungarian podcast episode. Reply JSON only: {\"match\": true|false}. Strict: false if unsure." },
        { role: "user", content: JSON.stringify({ podcast_episode_title: epTitle, youtube_title: ytTitle, youtube_description_excerpt: (ytDesc || "").slice(0, 300) }) },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    }),
  });
  if (!r.ok) return false;
  try {
    const j = await r.json();
    const p = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    return p.match === true;
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  try {
    if (!YT_KEY) return json({ error: "missing_YOUTUBE_API_KEY" }, 500);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "youtube-episode-pairer");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const url = new URL(req.url);
    const pilot = Number(url.searchParams.get("pilot") || 0);
    const dry = url.searchParams.get("dry") === "1";
    const podcastIdParam = url.searchParams.get("podcast_id");

    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "youtube_episode_pairer_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false && !pilot && !podcastIdParam) return json({ ok: true, paused: true });

    const tiers: string[] = ctrl.tiers || ["S", "A"];
    const batch = pilot || Number(ctrl.podcast_batch || 10);
    const autoThr = Number(ctrl.auto_pair_threshold || 0.85);
    const aiThr = Number(ctrl.ai_validate_threshold || 0.6);
    const aiModel = String(ctrl.ai_validate_model || "google/gemini-2.5-flash-lite");
    const maxVideos = Number(ctrl.max_videos_per_channel || 500);

    // Pick paired podcasts to scan
    let q = admin.from("podcasts")
      .select("id, title, youtube_channel_id, shadow_rank_tier")
      .eq("youtube_pairing_status", "paired")
      .not("youtube_channel_id", "is", null);
    if (podcastIdParam) q = q.eq("id", podcastIdParam);
    else q = q.in("shadow_rank_tier", tiers).ilike("language", "hu%").limit(batch);
    const { data: pods, error: pErr } = await q;
    if (pErr) throw pErr;
    if (!pods?.length) return json({ ok: true, no_candidates: true });

    let auto = 0, ai_paired = 0, no_match = 0, errors = 0, videos_fetched = 0, candidates_written = 0;
    const results: any[] = [];

    for (const pod of pods) {
      try {
        const uploads = await getUploadsPlaylistId(pod.youtube_channel_id!);
        if (!uploads) { errors++; results.push({ podcast_id: pod.id, error: "no_uploads_playlist" }); continue; }
        const items = await listPlaylist(uploads, maxVideos);
        videos_fetched += items.length;

        // Episodes in DB for this podcast that aren't paired yet
        const { data: eps } = await admin.from("episodes")
          .select("id, title, published_at, youtube_video_id, youtube_pairing_status")
          .eq("podcast_id", pod.id)
          .neq("youtube_pairing_status", "paired")
          .limit(2000);

        let podAuto = 0, podAi = 0, podNo = 0;
        const candidatesToInsert: any[] = [];

        for (const ep of eps || []) {
          // Score every YT video against this episode; take top 3 by score
          const scored = items.map((it: any) => {
            const ytTitle = it.snippet?.title || "";
            return { item: it, score: titleSim(ep.title, ytTitle) };
          }).sort((a, b) => b.score - a.score).slice(0, 3);
          if (!scored.length) { podNo++; continue; }
          const best = scored[0];
          let winner: any = null;
          let confidence = "auto";

          if (best.score >= autoThr) {
            winner = best;
          } else if (best.score >= aiThr) {
            const yes = await aiValidatePair(
              aiModel,
              ep.title,
              best.item.snippet?.title || "",
              best.item.snippet?.description || "",
            );
            if (yes) { winner = best; confidence = "ai_validated"; podAi++; }
          }
          if (winner) {
            if (confidence === "auto") podAuto++;
          } else {
            podNo++;
          }

          for (let i = 0; i < scored.length; i++) {
            const s = scored[i];
            const videoId = s.item.contentDetails?.videoId || s.item.snippet?.resourceId?.videoId;
            if (!videoId) continue;
            candidatesToInsert.push({
              episode_id: ep.id,
              podcast_id: pod.id,
              youtube_video_id: videoId,
              youtube_channel_id: pod.youtube_channel_id,
              youtube_title: s.item.snippet?.title,
              youtube_description: (s.item.snippet?.description || "").slice(0, 1000),
              youtube_published_at: s.item.snippet?.publishedAt,
              match_score: s.score,
              confidence: winner && winner.item === s.item ? confidence : "auto",
              status: winner && winner.item === s.item ? "confirmed" : "candidate",
              found_by: "youtube-episode-pairer",
              validated_by: winner && winner.item === s.item ? confidence : null,
              validation_reason: { rank: i },
              updated_at: new Date().toISOString(),
            });
          }
          if (winner && !dry) {
            const videoId = winner.item.contentDetails?.videoId || winner.item.snippet?.resourceId?.videoId;
            await admin.from("episodes").update({
              youtube_video_id: videoId,
              youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
              youtube_pairing_status: "paired",
              youtube_paired_at: new Date().toISOString(),
              youtube_match_score: winner.score,
            }).eq("id", ep.id);
          }
        }

        if (!dry && candidatesToInsert.length) {
          // Chunk to keep payload small
          for (let i = 0; i < candidatesToInsert.length; i += 200) {
            const chunk = candidatesToInsert.slice(i, i + 200);
            const { error: insErr } = await admin
              .from("episode_youtube_links")
              .upsert(chunk, { onConflict: "episode_id,youtube_video_id" });
            if (insErr) console.error("upsert eyl err", insErr);
          }
        }
        candidates_written += candidatesToInsert.length;
        auto += podAuto; ai_paired += podAi; no_match += podNo;

        results.push({
          podcast_id: pod.id, title: pod.title, channel_id: pod.youtube_channel_id,
          episodes_total: eps?.length || 0, yt_videos: items.length,
          auto: podAuto, ai_paired: podAi, no_match: podNo,
        });
      } catch (e: any) {
        errors++;
        results.push({ podcast_id: pod.id, error: e?.message || String(e) });
      }
    }

    return json({
      ok: true, pilot: !!pilot, dry, processed_podcasts: pods.length,
      auto, ai_paired, no_match, errors,
      videos_fetched, candidates_written,
      elapsed_ms: Date.now() - startedAt,
      results,
    });
  } catch (e: any) {
    console.error("youtube-episode-pairer error", e);
    return json({ error: e?.message || "error" }, 500);
  }
});
