// rss-transcript-importer
// One-shot importer: re-fetches RSS feeds listed in `app_settings.rss_transcript_audit.hits`,
// extracts <podcast:transcript url type> per <item>, downloads each transcript, normalizes
// to plain text, and upserts into `episode_transcripts` (model='rss_podcast_transcript_tag', $0).
//
// POST /rss-transcript-importer
//   { dry?: bool, podcast_ids?: string[], max_per_podcast?: number }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TRANSCRIPT_TAG_RE = /<podcast:transcript\b([^>]*?)\/?>/gi;
const ATTR_RE = /(\w+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
const GUID_RE = /<guid[^>]*>([\s\S]*?)<\/guid>/i;
const ENCLOSURE_RE = /<enclosure\b[^>]*url\s*=\s*["']([^"']+)["']/i;

// Format priority: cleanest plain-text first
const FORMAT_PRIORITY = [
  "text/plain",
  "text/vtt",
  "application/x-subrip",
  "application/srt",
  "/application/srt",
  "application/json",
  "text/html",
];

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_RE.lastIndex = 0;
  while ((m = ATTR_RE.exec(raw)) !== null) {
    out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? "").trim();
  }
  return out;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function stripCdata(s: string): string {
  return s.replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1").trim();
}

type ItemHit = { guid: string | null; enclosure: string | null; transcripts: Array<{ url: string; type: string }> };

function parseItems(xml: string): ItemHit[] {
  const items = xml.split(/<item\b/i).slice(1);
  const out: ItemHit[] = [];
  for (const itm of items) {
    const end = itm.indexOf("</item>");
    const body = end >= 0 ? itm.slice(0, end) : itm;
    const guidMatch = body.match(GUID_RE);
    const guid = guidMatch ? decodeEntities(stripCdata(guidMatch[1])) : null;
    const encMatch = body.match(ENCLOSURE_RE);
    const enclosure = encMatch ? decodeEntities(encMatch[1]) : null;
    const transcripts: Array<{ url: string; type: string }> = [];
    TRANSCRIPT_TAG_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TRANSCRIPT_TAG_RE.exec(body)) !== null) {
      const a = parseAttrs(m[1] || "");
      if (a.url) transcripts.push({ url: decodeEntities(a.url), type: (a.type || "").toLowerCase() });
    }
    if (transcripts.length) out.push({ guid, enclosure, transcripts });
  }
  return out;
}

function pickBest(transcripts: Array<{ url: string; type: string }>): { url: string; type: string } | null {
  if (!transcripts.length) return null;
  const sorted = [...transcripts].sort((a, b) => {
    const ai = FORMAT_PRIORITY.indexOf(a.type);
    const bi = FORMAT_PRIORITY.indexOf(b.type);
    return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
  });
  return sorted[0];
}

// --- Normalizers ---
function normalizeSrt(raw: string): string {
  return raw
    .replace(/\r/g, "")
    .split(/\n\n+/)
    .map((block) =>
      block
        .split("\n")
        .filter((l) => !/^\d+$/.test(l.trim()) && !/-->/.test(l))
        .join(" "),
    )
    .join("\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeVtt(raw: string): string {
  return raw
    .replace(/^WEBVTT[^\n]*\n/i, "")
    .replace(/\r/g, "")
    .split(/\n\n+/)
    .map((block) =>
      block
        .split("\n")
        .filter((l) => !/-->/.test(l) && !/^NOTE\b/i.test(l) && !/^STYLE\b/i.test(l) && !/^\d+$/.test(l.trim()))
        .join(" "),
    )
    .join("\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeHtml(raw: string): string {
  return raw
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|h\d|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeJson(raw: string): string {
  try {
    const j = JSON.parse(raw);
    // Buzzsprout transcript JSON: { segments: [{text, ...}] } or array of segments
    const segs = Array.isArray(j) ? j : j.segments || j.results?.segments || [];
    if (Array.isArray(segs) && segs.length) {
      return segs
        .map((s: any) => (typeof s === "string" ? s : s.text || s.transcript || ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (typeof j.transcript === "string") return j.transcript;
    return JSON.stringify(j).slice(0, 200);
  } catch {
    return raw.slice(0, 200);
  }
}

function normalizeByType(raw: string, type: string): string {
  const t = type.toLowerCase();
  if (t.includes("vtt")) return normalizeVtt(raw);
  if (t.includes("srt") || t.includes("subrip")) return normalizeSrt(raw);
  if (t.includes("json")) return normalizeJson(raw);
  if (t.includes("html")) return normalizeHtml(raw);
  // plain
  return raw.replace(/\s+/g, " ").trim();
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const t0 = Date.now();
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dry = body?.dry === true;
    const maxPerPodcast: number = Math.min(Number(body?.max_per_podcast) || 200, 1000);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: auditRow } = await admin.from("app_settings").select("value").eq("key", "rss_transcript_audit").maybeSingle();
    let hits: any[] = (auditRow?.value as any)?.hits || [];
    if (body?.podcast_ids?.length) {
      const set = new Set(body.podcast_ids as string[]);
      hits = hits.filter((h) => set.has(h.podcast_id));
    }
    if (!hits.length) return json({ ok: false, error: "no_hits_in_audit" });

    const perPodcast: any[] = [];
    let totalInserted = 0;
    let totalSkippedExisting = 0;
    let totalUnmatched = 0;
    let totalFetchErrors = 0;
    const samples: any[] = [];

    for (const hit of hits) {
      const podcastId: string = hit.podcast_id;
      const rssUrl: string = hit.rss_url;
      const title: string = hit.title;
      const stat = { podcast_id: podcastId, title, scanned: 0, with_tag: 0, matched: 0, inserted: 0, skipped_existing: 0, unmatched_guid: 0, fetch_errors: 0 };

      let xml = "";
      try {
        const r = await fetch(rssUrl, { headers: { "User-Agent": "Podiverzum/1.0 (transcript-importer)" }, signal: AbortSignal.timeout(20000) });
        if (!r.ok) { stat.fetch_errors++; totalFetchErrors++; perPodcast.push(stat); continue; }
        xml = await r.text();
      } catch {
        stat.fetch_errors++; totalFetchErrors++; perPodcast.push(stat); continue;
      }

      const items = parseItems(xml);
      stat.scanned = items.length;
      stat.with_tag = items.filter((i) => i.transcripts.length).length;

      // Build guid lookup for this podcast
      const guids = [...new Set(items.map((i) => i.guid).filter((g): g is string => Boolean(g)))];
      if (!guids.length) { perPodcast.push(stat); continue; }

      const { data: epRows } = await admin
        .from("episodes")
        .select("id,guid,podcast_id")
        .eq("podcast_id", podcastId)
        .in("guid", guids);
      const guidToEp = new Map<string, string>();
      for (const r of epRows || []) if (r.guid) guidToEp.set(r.guid, r.id);

      // Existing transcripts to skip
      const epIds = [...guidToEp.values()];
      const existing = new Set<string>();
      if (epIds.length) {
        for (let i = 0; i < epIds.length; i += 200) {
          const { data: existRows } = await admin
            .from("episode_transcripts")
            .select("episode_id")
            .in("episode_id", epIds.slice(i, i + 200));
          for (const r of existRows || []) existing.add(r.episode_id);
        }
      }

      let processed = 0;
      for (const it of items) {
        if (processed >= maxPerPodcast) break;
        if (!it.guid) continue;
        const epId = guidToEp.get(it.guid);
        if (!epId) { stat.unmatched_guid++; totalUnmatched++; continue; }
        const best = pickBest(it.transcripts);
        if (!best) continue;
        if (existing.has(epId)) { stat.skipped_existing++; totalSkippedExisting++; continue; }
        stat.matched++;

        if (dry) {
          if (samples.length < 5) samples.push({ podcast: title, ep: epId, guid: it.guid, picked: best });
          continue;
        }

        try {
          const tr = await fetch(best.url, { headers: { "User-Agent": "Podiverzum/1.0 (transcript-importer)" }, signal: AbortSignal.timeout(25000) });
          if (!tr.ok) { stat.fetch_errors++; totalFetchErrors++; continue; }
          const raw = await tr.text();
          const text = normalizeByType(raw, best.type);
          if (text.length < 100) { stat.fetch_errors++; totalFetchErrors++; continue; }
          const hash = await sha256Hex(text);

          const { error: upErr } = await admin.from("episode_transcripts").upsert({
            episode_id: epId,
            podcast_id: podcastId,
            model: `rss_podcast_transcript_tag:${best.type || "unknown"}`,
            language: "hu",
            transcript: text,
            content_hash: hash,
            cost_usd: 0,
          }, { onConflict: "episode_id" });
          if (upErr) { stat.fetch_errors++; totalFetchErrors++; continue; }

          stat.inserted++;
          totalInserted++;
          if (samples.length < 5) samples.push({ podcast: title, ep: epId, picked: best, chars: text.length });
          processed++;
        } catch {
          stat.fetch_errors++; totalFetchErrors++;
        }
      }

      perPodcast.push(stat);
    }

    await admin.from("app_settings").upsert({
      key: "rss_transcript_import_state",
      value: {
        ran_at: new Date().toISOString(),
        dry,
        totals: { inserted: totalInserted, skipped_existing: totalSkippedExisting, unmatched: totalUnmatched, fetch_errors: totalFetchErrors },
        per_podcast: perPodcast,
        elapsed_ms: Date.now() - t0,
      },
    });

    return json({ ok: true, dry, totals: { inserted: totalInserted, skipped_existing: totalSkippedExisting, unmatched: totalUnmatched, fetch_errors: totalFetchErrors }, per_podcast: perPodcast, samples, elapsed_ms: Date.now() - t0 });
  } catch (e) {
    return json({ ok: false, error: String((e as Error).message || e) }, 500);
  }
});
