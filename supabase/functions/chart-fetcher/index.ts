// chart-fetcher: daily snapshots of Apple HU / Spotify HU / YouTube proxy
// top podcasts. Writes to public.podcast_charts so the homepage
// "Felkapott műsorok" rail can compute a cumulated trending score
// (reciprocal-rank fusion across sources).
//
// Body: { sources?: ('apple'|'spotify'|'youtube')[], country?: 'hu', dryRun?: bool }
// Default: all three sources, country='hu', dryRun=false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APPLE_LIMIT = 100;
const SPOTIFY_LIMIT = 50;

// ---------- helpers ----------
async function sha1Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normTitle(s: string) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

async function piByItunesId(itunesId: string) {
  const apiKey = Deno.env.get("PODCAST_INDEX_API_KEY");
  const apiSecret = Deno.env.get("PODCAST_INDEX_API_SECRET");
  if (!apiKey || !apiSecret) return null;
  const date = Math.floor(Date.now() / 1000).toString();
  const auth = await sha1Hex(apiKey + apiSecret + date);
  const url = `https://api.podcastindex.org/api/1.0/podcasts/byitunesid?id=${encodeURIComponent(itunesId)}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Podiverzum/1.0 chart-fetcher",
      "X-Auth-Date": date, "X-Auth-Key": apiKey, "Authorization": auth,
    },
  });
  if (!res.ok) return null;
  const j = await res.json();
  return j?.feed && j.feed.url ? j.feed : null;
}

// ---------- Apple ----------
async function fetchAppleHU(): Promise<any[]> {
  const url = `https://rss.applemarketingtools.com/api/v2/hu/podcasts/top/${APPLE_LIMIT}/podcasts.json`;
  const res = await fetch(url, { headers: { "User-Agent": "Podiverzum/1.0" }, redirect: "follow" });
  if (!res.ok) throw new Error(`apple http ${res.status}`);
  const j = await res.json();
  return j?.feed?.results || [];
}

// ---------- Spotify (Firecrawl scrape) ----------
// ---------- Spotify (Firecrawl scrape) ----------
// NOTE: Spotify does NOT publish a Hungarian podcast chart on
// podcastcharts.byspotify.com (HU returns 404). Supported markets include
// se/gb/us/de/fr/nl/pl/at. We try the requested market and bail out gracefully
// if it isn't supported. When that happens the trending score falls back to
// Apple + YouTube only.
async function fetchSpotifyMarket(market: string): Promise<{ rank: number; name: string; show_id: string | null; image_url: string | null }[]> {
  const apiKey = Deno.env.get("FIRECRAWL_API_KEY");
  if (!apiKey) throw new Error("FIRECRAWL_API_KEY missing");
  const target = `https://podcastcharts.byspotify.com/${market}/top-podcasts`;
  const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      url: target,
      formats: ["html", "markdown"],
      onlyMainContent: false,
      waitFor: 3500,
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`spotify scrape ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  const html: string = j?.data?.html || j?.html || "";
  const md: string = j?.data?.markdown || j?.markdown || "";

  const out: { rank: number; name: string; show_id: string | null; image_url: string | null }[] = [];
  const seen = new Set<string>();
  const linkRe = /href="https:\/\/open\.spotify\.com\/show\/([A-Za-z0-9]+)[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html))) {
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);
    const text = m[2].replace(/<[^>]+>/g, "").trim();
    if (!text) continue;
    out.push({ rank: out.length + 1, name: text, show_id: id, image_url: null });
    if (out.length >= SPOTIFY_LIMIT) break;
  }
  if (out.length === 0 && md) {
    const lines = md.split(/\n+/);
    for (const ln of lines) {
      const mm = /\[([^\]]{2,120})\]\(https:\/\/open\.spotify\.com\/show\/([A-Za-z0-9]+)/.exec(ln);
      if (mm) {
        const id = mm[2];
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({ rank: out.length + 1, name: mm[1].trim(), show_id: id, image_url: null });
        if (out.length >= SPOTIFY_LIMIT) break;
      }
    }
  }
  return out;
}



// ---------- YouTube proxy ----------
async function fetchYouTubeStats(channelIds: string[]): Promise<Map<string, { sub: number; views: number; videos: number }>> {
  const apiKey = Deno.env.get("YOUTUBE_API_KEY");
  if (!apiKey) throw new Error("YOUTUBE_API_KEY missing");
  const out = new Map<string, { sub: number; views: number; videos: number }>();
  for (let i = 0; i < channelIds.length; i += 50) {
    const chunk = channelIds.slice(i, i + 50);
    const url = `https://www.googleapis.com/youtube/v3/channels?part=statistics&maxResults=50&id=${chunk.join(",")}&key=${apiKey}`;
    const res = await fetch(url);
    if (!res.ok) { console.warn("yt http", res.status); continue; }
    const j = await res.json();
    for (const it of (j.items || [])) {
      const s = it.statistics || {};
      out.set(it.id, {
        sub: Number(s.subscriberCount || 0),
        views: Number(s.viewCount || 0),
        videos: Number(s.videoCount || 0),
      });
    }
  }
  return out;
}

// ---------- main ----------
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const t0 = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const sources: string[] = Array.isArray(body.sources) && body.sources.length
      ? body.sources : ["apple", "spotify", "youtube"];
    const country = String(body.country || "hu");
    const dryRun = !!body.dryRun;
    const snapshotAt = new Date().toISOString();

    const result: any = { ok: true, country, snapshot_at: snapshotAt, sources: {} };

    // Pull HU podcast catalog once for matching (title + apple_url + spotify_url + youtube_channel_id)
    const { data: pods } = await supabase
      .from("podcasts")
      .select("id,title,display_title,normalized_title,rss_url,rss_url_norm,apple_url,spotify_url,youtube_channel_id,language")
      .ilike("language", "hu%");
    const podsArr = (pods || []) as any[];
    const byRss = new Map<string, any>(); podsArr.forEach((p) => p.rss_url && byRss.set(p.rss_url, p));
    const byRssNorm = new Map<string, any>(); podsArr.forEach((p) => p.rss_url_norm && byRssNorm.set(p.rss_url_norm, p));
    const byTitle = new Map<string, any>(); podsArr.forEach((p) => {
      const t = p.normalized_title || normTitle(p.display_title || p.title);
      if (t && !byTitle.has(t)) byTitle.set(t, p);
    });
    const byYt = new Map<string, any>(); podsArr.forEach((p) => p.youtube_channel_id && byYt.set(p.youtube_channel_id, p));
    const appleIdRe = /\/id(\d+)/;

    const inserts: any[] = [];

    // ===== APPLE =====
    if (sources.includes("apple")) {
      try {
        const items = await fetchAppleHU();
        let matched = 0, backfilled = 0;
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const rank = i + 1;
          const itunesId = String(it.id || "");
          let matchedPod: any = null;
          let matchedVia: string | null = null;

          // Strategy 1: PodcastIndex byItunesId → RSS URL → match podcast.rss_url
          if (itunesId) {
            const feed = await piByItunesId(itunesId).catch(() => null);
            const feedUrl: string | undefined = feed?.url;
            if (feedUrl) {
              matchedPod = byRss.get(feedUrl) || null;
              if (matchedPod) matchedVia = "rss_url";
              if (!matchedPod) {
                // normalized RSS check
                const stripped = feedUrl.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/$/, "");
                for (const [k, p] of byRssNorm) {
                  if (k && (k === stripped || stripped.endsWith(k))) { matchedPod = p; matchedVia = "rss_url_norm"; break; }
                }
              }
            }
          }
          // Strategy 2: title fuzzy
          if (!matchedPod) {
            const t = normTitle(it.name);
            matchedPod = byTitle.get(t) || null;
            if (matchedPod) matchedVia = "title_fuzzy";
          }
          if (matchedPod) {
            matched++;
            // Backfill apple_url on canonical podcast if missing
            if (!matchedPod.apple_url && it.url) {
              await supabase.from("podcasts").update({ apple_url: it.url }).eq("id", matchedPod.id);
              backfilled++;
              matchedPod.apple_url = it.url;
            }
          }
          inserts.push({
            source: "apple",
            country,
            rank,
            podcast_id: matchedPod?.id || null,
            raw_name: it.name || "",
            raw_artist: it.artistName || null,
            raw_external_id: itunesId || null,
            raw_url: it.url || null,
            image_url: it.artworkUrl100 || null,
            matched_via: matchedVia,
            snapshot_at: snapshotAt,
          });
          // small throttle for PI
          if ((i + 1) % 4 === 0) await new Promise((r) => setTimeout(r, 60));
        }
        result.sources.apple = { fetched: items.length, matched, apple_url_backfilled: backfilled };
      } catch (e) {
        result.sources.apple = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    // ===== SPOTIFY =====
    // Spotify doesn't publish a HU podcast chart (podcastcharts.byspotify.com/hu → 404).
    // We skip it for HU and rely on Apple + YouTube. If country is a supported market
    // (se/gb/us/de/fr/nl/pl/at), the scrape runs.
    const SPOTIFY_SUPPORTED = new Set(["se","gb","us","de","fr","nl","pl","at"]);
    if (sources.includes("spotify") && SPOTIFY_SUPPORTED.has(country)) {
      try {
        const items = await fetchSpotifyMarket(country);

        let matched = 0, backfilled = 0;
        for (const it of items) {
          let matchedPod: any = null;
          let matchedVia: string | null = null;
          // Strategy 1: existing spotify_url match
          if (it.show_id) {
            const url = `https://open.spotify.com/show/${it.show_id}`;
            matchedPod = podsArr.find((p) => p.spotify_url && p.spotify_url.includes(it.show_id!)) || null;
            if (matchedPod) matchedVia = "spotify_id";
          }
          // Strategy 2: title fuzzy
          if (!matchedPod) {
            const t = normTitle(it.name);
            matchedPod = byTitle.get(t) || null;
            if (matchedPod) matchedVia = "title_fuzzy";
          }
          if (matchedPod) {
            matched++;
            if (!matchedPod.spotify_url && it.show_id) {
              const url = `https://open.spotify.com/show/${it.show_id}`;
              await supabase.from("podcasts").update({ spotify_url: url }).eq("id", matchedPod.id);
              backfilled++;
              matchedPod.spotify_url = url;
            }
          }
          inserts.push({
            source: "spotify",
            country,
            rank: it.rank,
            podcast_id: matchedPod?.id || null,
            raw_name: it.name,
            raw_artist: null,
            raw_external_id: it.show_id,
            raw_url: it.show_id ? `https://open.spotify.com/show/${it.show_id}` : null,
            image_url: it.image_url,
            matched_via: matchedVia,
            snapshot_at: snapshotAt,
          });
        }
        result.sources.spotify = { fetched: items.length, matched, spotify_url_backfilled: backfilled };
      } catch (e) {
        result.sources.spotify = { error: e instanceof Error ? e.message : String(e) };
      }
    } else if (sources.includes("spotify")) {
      result.sources.spotify = { skipped: `country '${country}' not supported by Spotify chart` };
    }


    // ===== YOUTUBE =====
    if (sources.includes("youtube")) {
      try {
        const paired = podsArr.filter((p) => p.youtube_channel_id);
        const channelIds = paired.map((p) => p.youtube_channel_id);
        const stats = await fetchYouTubeStats(channelIds);

        // Snapshot stats
        const statRows = [];
        for (const [cid, s] of stats) {
          statRows.push({
            channel_id: cid,
            subscriber_count: s.sub,
            view_count: s.views,
            video_count: s.videos,
            snapshot_at: snapshotAt,
          });
        }
        if (!dryRun && statRows.length) {
          for (let i = 0; i < statRows.length; i += 500) {
            await supabase.from("youtube_channel_stats").insert(statRows.slice(i, i + 500));
          }
        }

        // Compute 7d view delta vs the snapshot closest to 7 days ago.
        const sevenAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
        const { data: prior } = await supabase
          .from("youtube_channel_stats")
          .select("channel_id,view_count,snapshot_at")
          .lt("snapshot_at", snapshotAt)
          .gte("snapshot_at", new Date(Date.now() - 14 * 86400_000).toISOString())
          .order("snapshot_at", { ascending: true });
        const priorByCh = new Map<string, number>();
        for (const r of (prior || [])) {
          // keep oldest within window per channel
          if (!priorByCh.has(r.channel_id)) priorByCh.set(r.channel_id, Number(r.view_count || 0));
        }

        const scored = paired.map((p) => {
          const s = stats.get(p.youtube_channel_id);
          if (!s) return null;
          const prev = priorByCh.get(p.youtube_channel_id);
          const delta = prev !== undefined ? Math.max(0, s.views - prev) : 0;
          return { pod: p, sub: s.sub, views: s.views, delta };
        }).filter(Boolean) as { pod: any; sub: number; views: number; delta: number }[];

        // Rank by delta when we have priors; else by subscriber count.
        const haveDelta = scored.some((s) => s.delta > 0);
        scored.sort((a, b) => haveDelta ? (b.delta - a.delta) : (b.sub - a.sub));
        const top = scored.slice(0, 50);
        top.forEach((s, idx) => {
          inserts.push({
            source: "youtube",
            country,
            rank: idx + 1,
            podcast_id: s.pod.id,
            raw_name: s.pod.display_title || s.pod.title,
            raw_artist: null,
            raw_external_id: s.pod.youtube_channel_id,
            raw_url: `https://www.youtube.com/channel/${s.pod.youtube_channel_id}`,
            image_url: null,
            matched_via: "youtube_channel",
            snapshot_at: snapshotAt,
          });
        });
        result.sources.youtube = {
          paired_channels: paired.length,
          stats_fetched: stats.size,
          ranking_basis: haveDelta ? "7d_view_delta" : "subscriber_count",
          ranked: top.length,
        };
      } catch (e) {
        result.sources.youtube = { error: e instanceof Error ? e.message : String(e) };
      }
    }

    if (dryRun) {
      result.would_insert = inserts.length;
      result.sample = inserts.slice(0, 15);
    } else if (inserts.length) {
      for (let i = 0; i < inserts.length; i += 200) {
        const { error } = await supabase.from("podcast_charts").insert(inserts.slice(i, i + 200));
        if (error) throw error;
      }
      result.inserted = inserts.length;
    }
    result.elapsed_ms = Date.now() - t0;
    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("chart-fetcher error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
