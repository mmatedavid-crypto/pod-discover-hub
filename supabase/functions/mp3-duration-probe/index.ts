// mp3-duration-probe v2
// Fills `episodes.duration_seconds` for HU episodes by probing the MP3 file.
//
// v2 changes (2026-06-04): browser User-Agent + no Range header + small GET window.
// This unblocks anchor.fm/Spotify, Megaphone, Podtrac, Podbean, Transistor, Libsyn
// which previously rejected bot-like HEAD/Range probes from server IPs.
//
// Strategy per episode:
//   1) GET first 8 KB with a real browser UA (no Range header — these CDNs 403 on Range).
//      Read Content-Length from response headers; parse first MPEG frame for bitrate.
//   2) duration_seconds = floor(content_length * 8 / bitrate_bps).
//   3) If anything fails, just stamp audio_probe_attempted_at and move on.
//
// Body: { limit?: number, force?: boolean }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// ── MPEG audio frame parser ──────────────────────────────────────────────────
const MPEG_BITRATES: Record<string, number[]> = {
  // [version][layer] → kbps table (index 1..14)
  "1_3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0], // MPEG-1 L3
  "1_2": [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384, 0],
  "1_1": [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448, 0],
  "2_3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],     // MPEG-2/2.5 L3
  "2_2": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0],
  "2_1": [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256, 0],
};

function skipId3(buf: Uint8Array): number {
  // ID3v2: "ID3" + ver(2) + flags(1) + size(4 syncsafe)
  if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size =
      (buf[6] & 0x7f) * 0x200000 +
      (buf[7] & 0x7f) * 0x4000 +
      (buf[8] & 0x7f) * 0x80 +
      (buf[9] & 0x7f);
    return 10 + size;
  }
  return 0;
}

function parseFirstFrameBitrate(buf: Uint8Array): number | null {
  const start = skipId3(buf);
  for (let i = start; i < buf.length - 4; i++) {
    if (buf[i] !== 0xff) continue;
    const b1 = buf[i + 1];
    if ((b1 & 0xe0) !== 0xe0) continue; // sync 11 bits
    const versionBits = (b1 >> 3) & 0x03; // 00=2.5, 10=2, 11=1
    const layerBits = (b1 >> 1) & 0x03;   // 01=L3, 10=L2, 11=L1
    if (versionBits === 0x01 || layerBits === 0x00) continue;
    const b2 = buf[i + 2];
    const bitrateIdx = (b2 >> 4) & 0x0f;
    if (bitrateIdx === 0 || bitrateIdx === 0x0f) continue;
    const version = versionBits === 0x03 ? 1 : 2; // treat 2.5 like 2
    const layer = layerBits === 0x03 ? 1 : layerBits === 0x02 ? 2 : 3;
    const table = MPEG_BITRATES[`${version}_${layer}`];
    if (!table) continue;
    const kbps = table[bitrateIdx];
    if (kbps > 0) return kbps * 1000;
  }
  return null;
}

// ── Per-episode probe ────────────────────────────────────────────────────────
async function probeOne(url: string): Promise<number | null> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12_000);
  try {
    const resp = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctl.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9,hu;q=0.8",
        // intentionally NO Range header — Megaphone/Podtrac/Anchor 403 on Range from server IPs
      },
    });
    if (!resp.ok || !resp.body) return null;

    const lenHeader = resp.headers.get("content-length");
    const totalLen = lenHeader ? parseInt(lenHeader, 10) : null;
    if (!totalLen || totalLen < 10_000) {
      try { await resp.body.cancel(); } catch { /* ignore */ }
      return null;
    }

    // Read up to 8 KB, then abort.
    const reader = resp.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    while (got < 8192) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      got += value.length;
    }
    try { await reader.cancel(); } catch { /* ignore */ }

    const head = new Uint8Array(got);
    let off = 0;
    for (const c of chunks) { head.set(c, off); off += c.length; }

    const bitrate = parseFirstFrameBitrate(head);
    if (!bitrate) return null;

    const seconds = Math.floor((totalLen * 8) / bitrate);
    if (seconds < 5 || seconds > 60 * 60 * 24) return null;
    return seconds;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
  let body: { limit?: number; force?: boolean } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const limit = Math.max(1, Math.min(500, body.limit ?? 250));

  // Pull HU episodes that still need duration (never-probed first; failures get reset separately).
  const { data: rows } = await supabase
    .from("episodes")
    .select("id, audio_url, podcast_id, podcasts!inner(language)")
    .is("duration_seconds", null)
    .not("audio_url", "is", null)
    .ilike("podcasts.language", "hu%")
    .is("audio_probe_attempted_at", null)
    .limit(limit);
  const candidates: { id: string; audio_url: string }[] = (rows as any[] || [])
    .map((r) => ({ id: r.id, audio_url: r.audio_url }));

  if (!candidates.length) {
    return new Response(JSON.stringify({ ok: true, processed: 0, filled: 0, note: "no_candidates" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Run probes with concurrency 8.
  let filled = 0;
  const now = new Date().toISOString();
  const conc = 8;
  let idx = 0;
  async function worker() {
    while (idx < candidates.length) {
      const i = idx++;
      const ep = candidates[i];
      const seconds = await probeOne(ep.audio_url);
      const patch: Record<string, unknown> = { audio_probe_attempted_at: now };
      if (seconds && seconds > 0) {
        patch.duration_seconds = seconds;
        filled++;
      }
      try {
        await supabase.from("episodes").update(patch).eq("id", ep.id);
      } catch { /* ignore */ }
    }
  }
  await Promise.all(Array.from({ length: conc }, () => worker()));

  return new Response(
    JSON.stringify({ ok: true, processed: candidates.length, filled, version: "v2" }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
