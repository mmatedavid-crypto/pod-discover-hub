// Selects the best available processing text for each episode.
// Sources are conservative: YouTube is eligible only from confirmed episode links.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { heuristicClean } from "../_shared/episode-text-cleaner.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

type EpisodeRow = {
  id: string;
  podcast_id: string;
  title: string | null;
  description: string | null;
  updated_at?: string | null;
};

function textQuality(text: string): { score: number; dirty: string[]; len: number } {
  const raw = String(text || "").trim();
  const dirty: string[] = [];
  if (/https?:\/\/|www\.|(?:open\.)?spotify\.com|podcasts\.apple\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|patreon\.com|linktr\.ee/i.test(raw)) dirty.push("links");
  if (/@[A-Za-z0-9_.-]+/.test(raw)) dirty.push("handles");
  if (/^\s*(?:instagram|facebook|youtube|spotify|apple podcasts?|tiktok)\s*[:：-]/im.test(raw)) dirty.push("platform_lines");
  const len = raw.length;
  const lengthScore = len >= 900 ? 1 : len >= 500 ? 0.85 : len >= 220 ? 0.62 : len >= 80 ? 0.35 : len > 0 ? 0.15 : 0;
  return { score: Math.max(0, lengthScore - dirty.length * 0.12), dirty, len };
}

function pickBest(ep: EpisodeRow, spotify: any | null, youtube: any | null, ctrl: any) {
  const gain = Number(ctrl.prefer_external_gain_chars ?? 150);
  const ytMin = Number(ctrl.youtube_min_confidence ?? 0.78);
  const spMin = Number(ctrl.spotify_min_confidence ?? 0.55);
  const rssText = String(ep.description || "").trim();
  const rssQ = textQuality(rssText);
  const candidates: any[] = [];

  if (rssText) {
    candidates.push({
      source_type: "rss",
      source_ref_id: null,
      raw_text: rssText,
      source_confidence: 0.65 + rssQ.score * 0.25,
      reasons: ["rss_description"],
      quality: rssQ,
      evidence: { rss_len: rssQ.len, dirty: rssQ.dirty },
    });
  }

  const spText = String(spotify?.spotify_description || spotify?.spotify_html_description || "").trim();
  const spConfidence = Number(spotify?.match_confidence || 0);
  const spQ = textQuality(spText);
  if (
    spText
    && spConfidence >= spMin
    && (spQ.len >= rssQ.len + gain || rssQ.len < 120)
  ) {
    candidates.push({
      source_type: "spotify",
      source_ref_id: spotify.id,
      raw_text: spText,
      source_confidence: Math.min(0.92, 0.58 + spConfidence * 0.25 + spQ.score * 0.15),
      reasons: ["spotify_longer_or_rss_short"],
      quality: spQ,
      evidence: {
        spotify_match_confidence: spConfidence,
        spotify_len: spQ.len,
        rss_len: rssQ.len,
        match_method: spotify.match_method,
        dirty: spQ.dirty,
      },
    });
  }

  const ytText = String(youtube?.youtube_description || "").trim();
  const ytConfidence = Number(youtube?.match_score || 0);
  const ytQ = textQuality(ytText);
  if (
    ytText
    && youtube?.status === "confirmed"
    && youtube?.validation_reason?.policy === "youtube_episode_match_v3"
    && ytConfidence >= ytMin
    && (ytQ.len >= rssQ.len + gain || rssQ.len < 160)
  ) {
    candidates.push({
      source_type: "youtube",
      source_ref_id: youtube.id,
      raw_text: ytText,
      source_confidence: Math.min(0.98, 0.62 + ytConfidence * 0.25 + ytQ.score * 0.13),
      reasons: ["confirmed_youtube_longer_or_rss_short"],
      quality: ytQ,
      evidence: {
        youtube_match_score: ytConfidence,
        youtube_confidence: youtube.confidence,
        youtube_status: youtube.status,
        youtube_len: ytQ.len,
        rss_len: rssQ.len,
        validation_reason: youtube.validation_reason || {},
        dirty: ytQ.dirty,
      },
    });
  }

  if (!candidates.length) return null;
  return candidates.sort((a, b) => {
    const scoreA = a.source_confidence + Math.min(0.12, a.quality.len / 12000);
    const scoreB = b.source_confidence + Math.min(0.12, b.quality.len / 12000);
    return scoreB - scoreA;
  })[0];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "episode-best-text-source-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "episode_best_text_source_controls").maybeSingle();
    const ctrl = ctrlRow?.value || {};
    if (ctrl.enabled === false && !body.force) return json({ ok: true, paused: true });

    const limit = Math.max(1, Math.min(5000, Number(body.limit || ctrl.batch_limit || 1000)));
    const ids = Array.isArray(body.ids) ? body.ids.map(String).filter(Boolean).slice(0, limit) : [];

    let targetIds = ids;
    let usedYtPriority = false;
    if (!targetIds.length) {
      // Load already-processed set once so we can skip episodes already done.
      // Supabase default cap is 1000 rows/select → paginate via .range().
      const doneSet = new Set<string>();
      for (let offset = 0; offset < 500000; offset += 1000) {
        const { data: chunk, error: doneErr } = await admin
          .from("episode_best_text_source")
          .select("episode_id")
          .range(offset, offset + 999);
        if (doneErr) throw doneErr;
        if (!chunk || chunk.length === 0) break;
        for (const r of chunk) doneSet.add(String((r as any).episode_id));
        if (chunk.length < 1000) break;
      }

      // 1) YouTube-confirmed-first priority, but only episodes not yet done.
      const { data: ytPriority, error: ytPriorityErr } = await admin
        .from("episode_youtube_links")
        .select("episode_id,updated_at")
        .eq("status", "confirmed")
        .contains("validation_reason", { policy: "youtube_episode_match_v3" })
        .not("youtube_description", "is", null)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .limit(Math.max(limit * 4, 5000));
      if (ytPriorityErr) throw ytPriorityErr;
      const ytIds = Array.from(new Set((ytPriority || []).map((row: any) => String(row.episode_id)).filter(Boolean)))
        .filter((id) => !doneSet.has(id))
        .slice(0, limit);

      if (ytIds.length) {
        targetIds = ytIds;
        usedYtPriority = true;
      } else {
        // 2) Drain remaining episodes that don't have a best_text_source yet.
        const fetchLimit = Math.min(limit * 4, 20000);
        const { data, error } = await admin
          .from("episodes")
          .select("id,podcast_id,title,description,updated_at")
          .order("updated_at", { ascending: false, nullsFirst: false })
          .limit(fetchLimit);
        if (error) throw error;
        targetIds = (data || []).filter((r: any) => !doneSet.has(String(r.id))).slice(0, limit).map((r: any) => String(r.id));
      }
    }

    let episodes: any[] = [];
    if (targetIds.length) {
      for (let i = 0; i < targetIds.length; i += 150) {
        const slice = targetIds.slice(i, i + 150);
        const { data, error } = await admin
          .from("episodes")
          .select("id,podcast_id,title,description,updated_at")
          .in("id", slice);
        if (error) throw error;
        if (data) episodes.push(...data);
      }
    }
    const eps = episodes as EpisodeRow[];
    if (!eps.length) return json({ ok: true, processed: 0 });

    const epIds = eps.map((e) => e.id);
    const spotifyByEp = new Map<string, any>();
    const youtubeByEp = new Map<string, any>();

    for (let i = 0; i < epIds.length; i += 500) {
      const slice = epIds.slice(i, i + 500);
      const { data: spRows } = await admin
        .from("episode_spotify_meta")
        .select("id,episode_id,spotify_description,spotify_html_description,match_confidence,match_method")
        .in("episode_id", slice);
      for (const row of spRows || []) {
        const prev = spotifyByEp.get(row.episode_id);
        const currentLen = String(row.spotify_description || row.spotify_html_description || "").length;
        const prevLen = String(prev?.spotify_description || prev?.spotify_html_description || "").length;
        if (!prev || currentLen > prevLen) spotifyByEp.set(row.episode_id, row);
      }

      const { data: ytRows } = await admin
        .from("episode_youtube_links")
        .select("id,episode_id,youtube_description,match_score,confidence,status,validation_reason")
        .in("episode_id", slice)
        .eq("status", "confirmed")
        .contains("validation_reason", { policy: "youtube_episode_match_v3" })
        .order("match_score", { ascending: false });
      for (const row of ytRows || []) {
        const prev = youtubeByEp.get(row.episode_id);
        const currentScore = Number(row.match_score || 0);
        const prevScore = Number(prev?.match_score || 0);
        const currentLen = String(row.youtube_description || "").length;
        const prevLen = String(prev?.youtube_description || "").length;
        if (!prev || currentScore > prevScore || (currentScore === prevScore && currentLen > prevLen)) {
          youtubeByEp.set(row.episode_id, row);
        }
      }
    }

    const rows: any[] = [];
    const sourceCounts: Record<string, number> = {};
    for (const ep of eps) {
      const best = pickBest(ep, spotifyByEp.get(ep.id) || null, youtubeByEp.get(ep.id) || null, ctrl);
      if (!best) continue;
      const cleaned = heuristicClean(best.raw_text).text.trim();
      rows.push({
        episode_id: ep.id,
        podcast_id: ep.podcast_id,
        source_type: best.source_type,
        source_ref_id: best.source_ref_id,
        source_confidence: Number(best.source_confidence.toFixed(4)),
        source_reason: best.reasons,
        raw_text: best.raw_text,
        cleaned_preview: cleaned.slice(0, 4000),
        raw_len: best.raw_text.length,
        cleaned_len: cleaned.length,
        evidence: best.evidence,
        selected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      sourceCounts[best.source_type] = (sourceCounts[best.source_type] || 0) + 1;
    }

    let upserted = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const { error } = await admin.from("episode_best_text_source").upsert(chunk, { onConflict: "episode_id" });
      if (error) throw error;
      upserted += chunk.length;
    }

    await admin.from("app_settings").upsert({
      key: "episode_best_text_source_progress",
      value: {
        last_run_at: new Date().toISOString(),
        scanned: eps.length,
        upserted,
        source_counts: sourceCounts,
        runtime_ms: Date.now() - startedAt,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({ ok: true, scanned: eps.length, upserted, source_counts: sourceCounts, elapsed_ms: Date.now() - startedAt });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}${e.stack ? ` :: ${e.stack.split('\n').slice(0,3).join(' | ')}` : ''}` : (typeof e === "string" ? e : JSON.stringify(e));
    console.error("episode-best-text-source-runner error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
