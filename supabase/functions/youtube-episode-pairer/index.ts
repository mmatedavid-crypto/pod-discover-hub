// youtube-episode-pairer: for podcasts with youtube_channel_id, list channel
// uploads playlist, fuzzy-match against RSS episodes, write episode_youtube_links.
//
// Quota:
//  - channels.list?part=contentDetails  => 1 unit (get uploads playlist ID)
//  - playlistItems.list?part=snippet&max=50 => 1 unit per page
//  - videos.list?part=contentDetails,statistics,snippet => 1 unit per 50 videos
// So a 200-video channel = ~9 units. Still cheap vs channel scout (100 units).
//
// Pilot: ?pilot=N&dry=1 -> only N podcasts, no DB writes.
// Auto-pair only when independent evidence agrees: title, publish date,
// episode number, name/keyword overlap, duration and ambiguity gap.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { titleSim } from "../_shared/title-similarity.ts";
import { callLovableAI } from "../_shared/lovable-ai.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const YT_KEY = Deno.env.get("YOUTUBE_API_KEY");

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

async function hydrateVideoDetails(items: any[]): Promise<Map<string, any>> {
  const ids = items
    .map((it) => it.contentDetails?.videoId || it.snippet?.resourceId?.videoId)
    .filter((id): id is string => !!id);
  const out = new Map<string, any>();
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    const params = new URLSearchParams({
      part: "contentDetails,statistics,snippet",
      id: chunk.join(","),
      key: YT_KEY!,
    });
    const r = await fetch(`https://www.googleapis.com/youtube/v3/videos?${params}`);
    if (!r.ok) throw new Error(`yt_videos_${r.status}`);
    const j = await r.json();
    for (const item of j.items || []) out.set(item.id, item);
  }
  return out;
}

function parseIsoDurationSeconds(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/i.exec(value);
  if (!m) return null;
  return Number(m[1] || 0) * 86400 + Number(m[2] || 0) * 3600 + Number(m[3] || 0) * 60 + Number(m[4] || 0);
}

function daysBetween(a?: string | null, b?: string | null): number | null {
  if (!a || !b) return null;
  const at = Date.parse(String(a).slice(0, 10) + "T00:00:00Z");
  const bt = Date.parse(String(b).slice(0, 10) + "T00:00:00Z");
  if (!Number.isFinite(at) || !Number.isFinite(bt)) return null;
  return Math.round(Math.abs(at - bt) / 86400000);
}

function dateScore(days: number | null): number {
  if (days === null) return 0.45;
  if (days <= 1) return 1;
  if (days <= 3) return 0.9;
  if (days <= 7) return 0.72;
  if (days <= 14) return 0.45;
  if (days <= 30) return 0.18;
  return 0;
}

function extractEpisodeNumbers(text: string): number[] {
  const normalized = text.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const out = new Set<number>();
  const patterns = [
    /(?:#|ep(?:izod)?\.?\s*|e)(\d{1,4})\b/g,
    /\b(\d{1,4})\s*(?:resz|adas|epizod)\b/g,
    /\b(?:resz|adas|epizod)\s*(\d{1,4})\b/g,
  ];
  for (const rx of patterns) {
    let m: RegExpExecArray | null;
    while ((m = rx.exec(normalized))) {
      const n = Number(m[1]);
      if (n > 0 && n < 3000 && (n < 1900 || n > 2099)) out.add(n);
    }
  }
  return [...out].slice(0, 5);
}

function overlapCount<T>(a: T[], b: T[]): number {
  const bSet = new Set(b);
  return new Set(a.filter((x) => bSet.has(x))).size;
}

function sequenceEvidence(epText: string, ytText: string): { score: number; match: boolean; mismatch: boolean; ep_numbers: number[]; yt_numbers: number[] } {
  const ep = extractEpisodeNumbers(epText);
  const yt = extractEpisodeNumbers(ytText);
  if (!ep.length || !yt.length) return { score: 0.5, match: false, mismatch: false, ep_numbers: ep, yt_numbers: yt };
  const matches = overlapCount(ep, yt);
  return {
    score: matches > 0 ? 1 : 0,
    match: matches > 0,
    mismatch: matches === 0,
    ep_numbers: ep,
    yt_numbers: yt,
  };
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !["podcast", "adas", "resz", "epizod", "youtube", "spotify", "magyar", "teljes"].includes(w));
}

function keywordOverlap(a: string, b: string): number {
  const A = [...new Set(words(a))].slice(0, 80);
  const B = [...new Set(words(b))].slice(0, 120);
  if (!A.length || !B.length) return 0;
  return Math.min(1, overlapCount(A, B) / Math.min(12, Math.max(4, A.length * 0.35)));
}

function extractNames(text: string): string[] {
  const out = new Set<string>();
  const rx = /\b(?:dr\.?\s+)?[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]{2,}(?:\s+[A-ZÁÉÍÓÖŐÚÜŰ][a-záéíóöőúüű]{2,}){1,3}\b/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text))) {
    const n = m[0].toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim();
    if (!/\b(podcast|youtube|spotify|facebook|instagram|apple|google)\b/.test(n)) out.add(n);
  }
  return [...out].slice(0, 20);
}

function nameOverlap(a: string, b: string): { score: number; matches: string[] } {
  const A = extractNames(a);
  const B = extractNames(b);
  if (!A.length || !B.length) return { score: 0.35, matches: [] };
  const bSet = new Set(B);
  const matches = A.filter((n) => bSet.has(n));
  return { score: Math.min(1, matches.length / Math.min(3, A.length)), matches };
}

function durationScore(epDurationMs: number | null, ytDurationSeconds: number | null): { score: number; ratio: number | null } {
  if (!epDurationMs || !ytDurationSeconds) return { score: 0.5, ratio: null };
  const ep = epDurationMs / 1000;
  const ratio = Math.abs(ep - ytDurationSeconds) / Math.max(ep, ytDurationSeconds);
  if (ratio <= 0.08) return { score: 1, ratio };
  if (ratio <= 0.15) return { score: 0.85, ratio };
  if (ratio <= 0.25) return { score: 0.55, ratio };
  if (ratio <= 0.4) return { score: 0.2, ratio };
  return { score: 0, ratio };
}

function evaluatePair(ep: any, scored: Array<{ item: any; score: number }>, idx: number): any {
  const candidate = scored[idx];
  const item = candidate.item;
  const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId || item.id;
  const ytTitle = item.snippet?.title || "";
  const ytDesc = item.snippet?.description || "";
  const ytPublished = item.snippet?.publishedAt || item.contentDetails?.videoPublishedAt || null;
  const ytDuration = parseIsoDurationSeconds(item.videoDetails?.contentDetails?.duration);
  const ytViews = Number(item.videoDetails?.statistics?.viewCount || 0) || null;
  const second = idx === 0 ? scored[1] : scored[0];
  const ambiguityGap = Number((candidate.score - Number(second?.score || 0)).toFixed(4));
  const dayDiff = daysBetween(ep.published_at, ytPublished);
  const seq = sequenceEvidence(`${ep.title || ""} ${ep.description || ""}`, `${ytTitle} ${ytDesc}`);
  const names = nameOverlap(`${ep.title || ""} ${ep.description || ""}`, `${ytTitle} ${ytDesc}`);
  const kw = keywordOverlap(`${ep.title || ""} ${ep.description || ""}`, `${ytTitle} ${ytDesc}`);
  const dur = durationScore(ep.spotify_duration_ms || null, ytDuration);

  const finalScore = Math.max(0, Math.min(1,
    candidate.score * 0.40
    + dateScore(dayDiff) * 0.18
    + seq.score * 0.14
    + names.score * 0.10
    + kw * 0.10
    + dur.score * 0.08
  ));

  const blockers: string[] = [];
  if (seq.mismatch && candidate.score < 0.92) blockers.push("episode_number_mismatch");
  if (dayDiff !== null && dayDiff > 45 && candidate.score < 0.92) blockers.push("date_too_far");
  if (dur.ratio !== null && dur.ratio > 0.45 && candidate.score < 0.92) blockers.push("duration_mismatch");
  if (idx === 0 && ambiguityGap < 0.04 && finalScore < 0.9) blockers.push("ambiguous_top_candidates");
  if (candidate.score < 0.55) blockers.push("title_too_weak");

  return {
    item,
    videoId,
    ytDuration,
    ytViews,
    finalScore,
    blockers,
    evidence: {
      title_score: Number(candidate.score.toFixed(4)),
      final_score: Number(finalScore.toFixed(4)),
      date_days_abs: dayDiff,
      date_score: Number(dateScore(dayDiff).toFixed(4)),
      sequence_score: seq.score,
      sequence_match: seq.match,
      sequence_mismatch: seq.mismatch,
      ep_numbers: seq.ep_numbers,
      yt_numbers: seq.yt_numbers,
      name_score: Number(names.score.toFixed(4)),
      name_matches: names.matches,
      keyword_overlap: Number(kw.toFixed(4)),
      duration_score: Number(dur.score.toFixed(4)),
      duration_ratio: dur.ratio === null ? null : Number(dur.ratio.toFixed(4)),
      youtube_duration_seconds: ytDuration,
      spotify_duration_ms: ep.spotify_duration_ms || null,
      ambiguity_gap: ambiguityGap,
      blockers,
      policy: "youtube_episode_match_v3",
    },
  };
}

async function aiValidatePair(model: string, ep: any, evaluated: any): Promise<boolean> {
  const item = evaluated.item;
  const inputText = JSON.stringify({
    podcast_episode_title: ep.title,
    podcast_episode_description_excerpt: String(ep.description || "").slice(0, 500),
    podcast_published_at: ep.published_at,
    youtube_title: item.snippet?.title || "",
    youtube_description_excerpt: String(item.snippet?.description || "").slice(0, 700),
    youtube_published_at: item.snippet?.publishedAt || null,
    evidence: evaluated.evidence,
  });
  const ai = await callLovableAI({
    model,
    job_type: "youtube_episode_pairer",
    target_type: "episode",
    prompt_version: "youtube-episode-pair-v3-strict",
    input_text: inputText,
    min_input_chars: 40,
    messages: [
        { role: "system", content: "Decide if the YouTube video is the exact same podcast episode as the RSS episode. Reply JSON only: {\"match\": true|false}. Be strict: false if dates, episode numbers, guest names, topic or duration look uncertain." },
        { role: "user", content: inputText },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });
  if (!ai.ok) return false;
  try {
    const j = ai.data;
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
    const aiModel = String(ctrl.ai_validate_model || "google/gemini-2.5-flash-lite");
    const maxVideos = Number(ctrl.max_videos_per_channel || 500);
    const strictAutoThr = Number(ctrl.strict_auto_pair_threshold || 0.84);
    const strictAiThr = Number(ctrl.strict_ai_pair_threshold || 0.78);
    const minAmbiguityGap = Number(ctrl.min_ambiguity_gap || 0.04);

    // Pick paired podcasts to scan
    let q = admin.from("podcasts")
      .select("id, title, youtube_channel_id, shadow_rank_tier")
      .eq("youtube_pairing_status", "paired")
      .not("youtube_channel_id", "is", null);
    if (podcastIdParam) q = q.eq("id", podcastIdParam);
    else q = q.in("shadow_rank_tier", tiers).eq("is_hungarian", true)
      .order("youtube_last_episode_pair_at", { ascending: true, nullsFirst: true })
      .limit(batch);
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
        const details = await hydrateVideoDetails(items);
        for (const item of items) {
          const videoId = item.contentDetails?.videoId || item.snippet?.resourceId?.videoId;
          item.videoDetails = videoId ? details.get(videoId) : null;
        }
        videos_fetched += items.length;

        // Re-score episodes even if an older, weaker pairer already marked them
        // paired. Downstream text enrichment only trusts v3-confirmed evidence.
        const { data: eps } = await admin.from("episodes")
          .select("id, title, description, published_at, youtube_video_id, youtube_pairing_status")
          .eq("podcast_id", pod.id)
          .limit(2000);
        const epIds = (eps || []).map((e: any) => e.id);
        const spotifyDurationByEp = new Map<string, number>();
        if (epIds.length) {
          for (let i = 0; i < epIds.length; i += 500) {
            const slice = epIds.slice(i, i + 500);
            const { data: spRows } = await admin
              .from("episode_spotify_meta")
              .select("episode_id,duration_ms")
              .in("episode_id", slice);
            for (const row of spRows || []) spotifyDurationByEp.set(row.episode_id, Number(row.duration_ms || 0));
          }
        }

        let podAuto = 0, podAi = 0, podNo = 0;
        const candidatesToInsert: any[] = [];

        for (const rawEp of eps || []) {
          const ep = { ...rawEp, spotify_duration_ms: spotifyDurationByEp.get(rawEp.id) || null };
          // Score every YT video against this episode; take top 3 by score
          const scored = items.map((it: any) => {
            const ytTitle = it.snippet?.title || "";
            return { item: it, score: titleSim(ep.title, ytTitle) };
          }).sort((a, b) => b.score - a.score).slice(0, 3);
          if (!scored.length) { podNo++; continue; }
          const evaluated = scored.map((_, i) => evaluatePair(ep, scored, i));
          const best = evaluated[0];
          let winner: any = null;
          let confidence = "candidate";

          if (
            best.finalScore >= strictAutoThr
            && best.evidence.ambiguity_gap >= minAmbiguityGap
            && best.blockers.length === 0
          ) {
            winner = best;
            confidence = "strict_auto";
          } else if (
            best.finalScore >= strictAiThr
            && best.evidence.ambiguity_gap >= minAmbiguityGap
            && !best.blockers.includes("episode_number_mismatch")
            && !best.blockers.includes("duration_mismatch")
          ) {
            const yes = await aiValidatePair(aiModel, ep, best);
            if (yes) { winner = best; confidence = "ai_validated"; podAi++; }
          }
          if (winner) {
            if (confidence === "strict_auto") podAuto++;
          } else {
            podNo++;
          }

          for (let i = 0; i < evaluated.length; i++) {
            const s = evaluated[i];
            const videoId = s.videoId;
            if (!videoId) continue;
            const isWinner = winner && winner.videoId === videoId;
            candidatesToInsert.push({
              episode_id: ep.id,
              podcast_id: pod.id,
              youtube_video_id: videoId,
              youtube_channel_id: pod.youtube_channel_id,
              youtube_title: s.item.snippet?.title,
              youtube_description: (s.item.snippet?.description || "").slice(0, 1000),
              youtube_published_at: s.item.snippet?.publishedAt,
              youtube_duration_seconds: s.ytDuration,
              youtube_view_count: s.ytViews,
              match_score: s.finalScore,
              confidence: isWinner ? confidence : (s.blockers.length ? "rejected" : "candidate"),
              status: isWinner ? "confirmed" : (s.blockers.length ? "rejected" : "candidate"),
              found_by: "youtube-episode-pairer",
              validated_by: isWinner ? confidence : null,
              validation_reason: { ...s.evidence, rank: i },
              updated_at: new Date().toISOString(),
            });
          }
          if (winner && !dry) {
            const videoId = winner.videoId;
            await admin.from("episodes").update({
              youtube_video_id: videoId,
              youtube_url: `https://www.youtube.com/watch?v=${videoId}`,
              youtube_pairing_status: "paired",
              youtube_paired_at: new Date().toISOString(),
              youtube_match_score: winner.finalScore,
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

        if (!dry) {
          await admin.from("podcasts").update({
            youtube_last_episode_pair_at: new Date().toISOString(),
            youtube_episode_count: items.length,
          }).eq("id", pod.id);
        }

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
