// youtube-channel-scout: finds the YouTube channel matching each podcast.
//
// Flow:
//  1) Select HU podcasts (tier-filtered, where youtube_pairing_status != 'paired'
//     and not scouted recently)
//  2) For each: YouTube Data API v3 `search.list?type=channel&q=<title> <author>`
//     (cost: 100 units / query)
//  3) Take top 3 results -> channels.list (cost: 1 unit) for full metadata
//  4) Score each (title trigram + author signals + description hints)
//  5) If best >= auto_pair_threshold -> auto pair (write candidate + winner cache)
//  6) Else if 2nd-best gap is small -> Gemini validation (cheap)
//  7) Else mark 'no_match'
//
// Quota guard: hard-stop when units consumed >= daily_api_quota_units.
// Pilot mode: ?pilot=N&dry=1 -> only N podcasts, no DB writes (just logs).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { titleSim, normHu } from "../_shared/title-similarity.ts";
import { callLovableAI } from "../_shared/lovable-ai.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const YT_KEY = Deno.env.get("YOUTUBE_API_KEY");

async function ytSearchChannel(q: string) {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=channel&maxResults=3&q=${encodeURIComponent(q)}&key=${YT_KEY}`;
  const r = await fetch(url);
  if (r.status === 403) throw new Error("yt_quota_or_forbidden");
  if (!r.ok) throw new Error(`yt_search_${r.status}`);
  return await r.json();
}

async function ytChannels(ids: string[]) {
  if (!ids.length) return { items: [] };
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${ids.join(",")}&key=${YT_KEY}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`yt_channels_${r.status}`);
  return await r.json();
}

async function aiValidate(model: string, podcast: any, candidates: any[]): Promise<{ winner_idx: number | null; reason: string }> {
  const userPayload = JSON.stringify({
    podcast: { title: podcast.title, author: podcast.author || podcast.publisher, description: (podcast.description || "").slice(0, 400) },
    candidates: candidates.map((c) => ({
      channel_id: c.id,
      title: c.snippet?.title,
      description: (c.snippet?.description || "").slice(0, 400),
      subs: c.statistics?.subscriberCount,
      videos: c.statistics?.videoCount,
    })),
  });
  const ai = await callLovableAI({
    model,
    job_type: "youtube_channel_scout",
    target_type: "podcast",
    target_id: podcast.id,
    prompt_version: "youtube-channel-scout-v2",
    input_text: userPayload,
    min_input_chars: 80,
    messages: [
      {
        role: "system",
        content:
          "You decide whether any of the YouTube channel candidates is the official channel of the given Hungarian podcast. Reply ONLY in JSON: {\"winner_idx\": <0-based index or null>, \"confidence\": 0..1, \"reason\":\"...\"}. Be strict: if unsure, return null.",
      },
      {
        role: "user",
        content: userPayload,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });
  if (!ai.ok) return { winner_idx: null, reason: ai.error || `ai_${ai.status}` };
  const j = ai.data;
  try {
    const parsed = JSON.parse(j.choices?.[0]?.message?.content || "{}");
    const idx = parsed.winner_idx;
    return {
      winner_idx: (typeof idx === "number" && idx >= 0 && idx < candidates.length) ? idx : null,
      reason: parsed.reason || "",
    };
  } catch { return { winner_idx: null, reason: "parse_err" }; }
}

function scoreChannel(podcast: any, ch: any): number {
  const podTitle = podcast.title || "";
  const author = podcast.author || podcast.publisher || "";
  const chTitle = ch.snippet?.title || "";
  const chDesc = ch.snippet?.description || "";
  const titleScore = titleSim(podTitle, chTitle);
  // author signal: if author tokens appear in channel title/desc
  const authorTokens = normHu(author).split(" ").filter((t: string) => t.length >= 3);
  let authorBoost = 0;
  if (authorTokens.length) {
    const blob = normHu(`${chTitle} ${chDesc}`);
    const hits = authorTokens.filter((t: string) => blob.includes(t)).length;
    authorBoost = Math.min(0.15, (hits / authorTokens.length) * 0.15);
  }
  // size signal: tiny channels (<50 videos & <500 subs) get penalty
  const subs = Number(ch.statistics?.subscriberCount || 0);
  const vids = Number(ch.statistics?.videoCount || 0);
  const sizePenalty = (subs < 200 && vids < 20) ? -0.05 : 0;
  return Math.max(0, Math.min(1, titleScore + authorBoost + sizePenalty));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  try {
    if (!YT_KEY) return json({ error: "missing_YOUTUBE_API_KEY" }, 500);
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "youtube-channel-scout");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const url = new URL(req.url);
    const pilot = Number(url.searchParams.get("pilot") || 0);
    const dry = url.searchParams.get("dry") === "1";

    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "youtube_scout_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    if (ctrl.enabled === false && !pilot) return json({ ok: true, paused: true });

    const tiers: string[] = ctrl.tiers || ["S", "A"];
    const batch = pilot || Number(ctrl.channel_batch || 20);
    const rescoutDays = Number(ctrl.rescout_after_days || 30);
    const quotaCap = Number(ctrl.daily_api_quota_units || 9000);
    const autoThr = Number(ctrl.min_channel_score_auto || 0.85);
    const aiThr = Number(ctrl.ai_validate_threshold || 0.5);
    const aiModel = String(ctrl.ai_validate_model || "google/gemini-2.5-flash-lite");

    // Check today's quota usage from app_settings
    const dayKey = new Date().toISOString().slice(0, 10);
    const { data: usageRow } = await admin.from("app_settings").select("value").eq("key", `youtube_api_usage_${dayKey}`).maybeSingle();
    let unitsUsed = Number((usageRow?.value as any)?.units || 0);
    if (unitsUsed >= quotaCap && !pilot) return json({ ok: true, quota_reached: true, units_used: unitsUsed });

    // Pick podcasts
    const rescoutBefore = new Date(Date.now() - rescoutDays * 86400_000).toISOString();
    const { data: pods, error: pErr } = await admin
      .from("podcasts")
      .select("id, title, description, language, shadow_rank_tier, youtube_channel_id, youtube_pairing_status, youtube_last_scouted_at, source")
      .eq("is_hungarian", true)
      .in("shadow_rank_tier", tiers)
      .neq("youtube_pairing_status", "paired")
      .or(`youtube_last_scouted_at.is.null,youtube_last_scouted_at.lt.${rescoutBefore}`)
      .order("shadow_rank_tier", { ascending: true })
      .limit(batch);
    if (pErr) throw pErr;
    if (!pods?.length) return json({ ok: true, no_candidates: true });

    const results: any[] = [];
    let auto = 0, ai_paired = 0, no_match = 0, errors = 0;

    for (const pod of pods) {
      if (unitsUsed + 101 > quotaCap && !pilot) break;
      const q = `${pod.title}${pod.title ? " podcast" : ""}`.trim();
      try {
        const searchRes = await ytSearchChannel(q);
        unitsUsed += 100;
        const ids = (searchRes.items || []).map((it: any) => it.snippet?.channelId || it.id?.channelId).filter(Boolean).slice(0, 3);
        if (!ids.length) {
          no_match++;
          if (!dry) await admin.from("podcasts").update({
            youtube_pairing_status: "no_match",
            youtube_last_scouted_at: new Date().toISOString(),
          }).eq("id", pod.id);
          results.push({ podcast_id: pod.id, title: pod.title, decision: "no_results" });
          continue;
        }
        const chRes = await ytChannels(ids);
        unitsUsed += 1;
        const channels = chRes.items || [];
        const scored = channels.map((c: any) => ({ ch: c, score: scoreChannel(pod, c) })).sort((a: any, b: any) => b.score - a.score);
        const top = scored[0];
        let winner = null as any;
        let validatedBy = "auto";
        let aiReason = "";

        if (top && top.score >= autoThr) {
          winner = top;
        } else if (top && top.score >= aiThr) {
          const ai = await aiValidate(aiModel, pod, scored.map((s: any) => s.ch));
          if (ai.winner_idx !== null) {
            winner = scored[ai.winner_idx];
            validatedBy = "ai";
            aiReason = ai.reason;
            ai_paired++;
          }
        }

        // Insert all candidates
        if (!dry) {
          await admin.from("podcast_youtube_candidates").upsert(
            scored.map((s: any, idx: number) => ({
              podcast_id: pod.id,
              youtube_channel_id: s.ch.id,
              channel_title: s.ch.snippet?.title,
              channel_description: (s.ch.snippet?.description || "").slice(0, 1000),
              channel_thumbnail_url: s.ch.snippet?.thumbnails?.default?.url,
              subscriber_count: Number(s.ch.statistics?.subscriberCount || 0) || null,
              video_count: Number(s.ch.statistics?.videoCount || 0) || null,
              match_score: s.score,
              confidence: winner && winner.ch.id === s.ch.id ? validatedBy : "auto",
              status: winner && winner.ch.id === s.ch.id ? "confirmed" : "candidate",
              found_by: "youtube-channel-scout",
              validated_by: winner && winner.ch.id === s.ch.id ? validatedBy : null,
              validation_reason: { rank: idx, ai_reason: aiReason },
              updated_at: new Date().toISOString(),
            })),
            { onConflict: "podcast_id,youtube_channel_id" },
          );
        }

        if (winner) {
          if (validatedBy === "auto") auto++;
          if (!dry) await admin.from("podcasts").update({
            youtube_channel_id: winner.ch.id,
            youtube_channel_title: winner.ch.snippet?.title,
            youtube_pairing_status: "paired",
            youtube_paired_at: new Date().toISOString(),
            youtube_last_scouted_at: new Date().toISOString(),
            youtube_episode_count: Number(winner.ch.statistics?.videoCount || 0) || null,
          }).eq("id", pod.id);
          results.push({
            podcast_id: pod.id, title: pod.title, decision: validatedBy,
            score: winner.score, channel_id: winner.ch.id, channel_title: winner.ch.snippet?.title,
            ai_reason: aiReason,
          });
        } else {
          no_match++;
          if (!dry) await admin.from("podcasts").update({
            youtube_pairing_status: "no_match",
            youtube_last_scouted_at: new Date().toISOString(),
          }).eq("id", pod.id);
          results.push({
            podcast_id: pod.id, title: pod.title, decision: "no_match",
            best_score: top?.score, best_title: top?.ch.snippet?.title,
          });
        }
      } catch (e: any) {
        errors++;
        results.push({ podcast_id: pod.id, title: pod.title, error: e?.message || String(e) });
        if (String(e?.message).includes("yt_quota")) break;
      }
    }

    // Persist quota usage
    if (!dry) {
      await admin.from("app_settings").upsert({
        key: `youtube_api_usage_${dayKey}`,
        value: { units: unitsUsed, updated_at: new Date().toISOString() },
        updated_at: new Date().toISOString(),
      });
    }

    return json({
      ok: true, pilot: !!pilot, dry,
      processed: pods.length, auto, ai_paired, no_match, errors,
      units_used_today: unitsUsed, quota_cap: quotaCap,
      elapsed_ms: Date.now() - startedAt,
      results,
    });
  } catch (e: any) {
    console.error("youtube-channel-scout error", e);
    return json({ error: e?.message || "error" }, 500);
  }
});
