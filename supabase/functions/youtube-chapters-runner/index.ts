// YouTube chapters runner: extracts timestamped chapters from confirmed
// YouTube descriptions and stores them in episode_chapters. Cost: $0.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

type LinkRow = {
  episode_id: string;
  youtube_video_id: string | null;
  youtube_description: string | null;
  youtube_duration_seconds: number | null;
  match_score: number | null;
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
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/www\.\S+/gi, "")
    .replace(/[⁠\u200b\u200c\u200d]/g, "")
    .replace(/^\s*[-–—•|)\].:]+\s*/, "")
    .replace(/\s*[:：]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function extractChapters(description: string, durationSeconds: number | null): Array<{ start_sec: number; title: string }> {
  const lines = String(description || "").split(/\r?\n/);
  const out: Array<{ start_sec: number; title: string }> = [];
  const seen = new Set<number>();
  const lineRe = /^\s*(?:(?:\[|\()?((?:\d{1,2}:)?\d{1,2}:\d{2})(?:\]|\))?\s*[-–—|:.)]?\s*(.{0,180})|(.{0,140}?)\s+((?:\d{1,2}:)?\d{1,2}:\d{2})\s*)$/;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length > 260) continue;
    const m = trimmed.match(lineRe);
    if (!m) continue;
    const start = parseTime(m[1] || m[4]);
    if (start === null || seen.has(start)) continue;
    if (durationSeconds && start > durationSeconds + 120) continue;
    const title = cleanTitle(m[2] || m[3] || "") || (start === 0 ? "Bevezető" : "Fejezet");
    seen.add(start);
    out.push({ start_sec: start, title });
  }

  return out
    .sort((a, b) => a.start_sec - b.start_sec)
    .filter((c, idx, arr) => idx === 0 || c.start_sec > arr[idx - 1].start_sec + 5)
    .slice(0, 40);
}

async function loadExistingEpisodeIds(admin: any): Promise<Set<string>> {
  const set = new Set<string>();
  for (let offset = 0; offset < 500000; offset += 1000) {
    const { data, error } = await admin.from("episode_chapters").select("episode_id").range(offset, offset + 999);
    if (error) throw error;
    if (!data?.length) break;
    for (const row of data) set.add(String(row.episode_id));
    if (data.length < 1000) break;
  }
  return set;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "youtube-chapters-runner");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "youtube_chapters_controls").maybeSingle();
    const ctrl = ctrlRow?.value || {};
    const force = body.force === true;
    if (ctrl.enabled === false && !force) return json({ ok: true, paused: true });

    const limit = Math.max(1, Math.min(500, Number(body.limit || ctrl.batch || 200)));
    const dry = body.dry === true;
    const minChapters = Math.max(2, Math.min(12, Number(body.min_chapters || ctrl.min_chapters || 3)));
    const minMatchScore = Math.max(0, Math.min(1, Number(body.min_match_score || ctrl.min_match_score || 0.84)));
    const pageSize = Math.max(100, Math.min(1000, Number(body.page_size || ctrl.page_size || 1000)));
    const maxPages = Math.max(1, Math.min(80, Number(body.max_pages || ctrl.max_pages || 20)));

    const existing = await loadExistingEpisodeIds(admin);
    const rows: any[] = [];
    const samples: any[] = [];
    let scanned = 0;
    let eligible = 0;
    let pages = 0;

    for (let offset = 0; pages < maxPages && eligible < limit; offset += pageSize) {
      pages++;
      const { data: links, error } = await admin
        .from("episode_youtube_links")
        .select("episode_id,youtube_video_id,youtube_description,youtube_duration_seconds,match_score")
        .eq("status", "confirmed")
        .contains("validation_reason", { policy: "youtube_episode_match_v3" })
        .not("youtube_description", "is", null)
        .gte("match_score", minMatchScore)
        .order("updated_at", { ascending: false, nullsFirst: false })
        .range(offset, offset + pageSize - 1);
      if (error) throw error;
      if (!links?.length) break;

      for (const link of links as LinkRow[]) {
        scanned++;
        if (existing.has(link.episode_id)) continue;
        const chapters = extractChapters(link.youtube_description || "", link.youtube_duration_seconds);
        if (chapters.length < minChapters) continue;
        eligible++;
        existing.add(link.episode_id);
        chapters.forEach((c, idx) => rows.push({
          episode_id: link.episode_id,
          idx,
          start_sec: c.start_sec,
          title: c.title,
          summary: null,
          generated_at: new Date().toISOString(),
        }));
        if (samples.length < 5) samples.push({ episode_id: link.episode_id, youtube_video_id: link.youtube_video_id, chapter_count: chapters.length, first: chapters.slice(0, 3) });
        if (eligible >= limit) break;
      }
      if (links.length < pageSize) break;
    }

    if (!dry && rows.length) {
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await admin.from("episode_chapters").upsert(rows.slice(i, i + 500), { onConflict: "episode_id,idx" });
        if (error) throw error;
      }
    }

    await admin.from("app_settings").upsert({
      key: "youtube_chapters_progress",
      value: { last_run_at: new Date().toISOString(), scanned, eligible_episodes: eligible, chapter_rows: rows.length, dry, pages, runtime_ms: Date.now() - startedAt },
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({ ok: true, dry, pages, scanned, eligible_episodes: eligible, chapter_rows: rows.length, inserted_rows: dry ? 0 : rows.length, elapsed_ms: Date.now() - startedAt, samples });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("youtube-chapters-runner error", msg);
    return json({ ok: false, error: msg }, 500);
  }
});