// Spotify matcher + chart builder.
// 1) Take current HU Apple + YouTube chart podcasts (matched ones)
// 2) For each podcast without spotify_id, search Spotify (market=HU) and pick best title match
// 3) Update podcasts with spotify metadata
// 4) Insert a synthetic "spotify" chart ranked by popularity into podcast_charts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SPOTIFY_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID")!;
const SPOTIFY_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;

async function getToken(): Promise<string> {
  const r = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`),
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`spotify token ${r.status}`);
  const j = await r.json();
  return j.access_token as string;
}

function norm(s: string): string {
  return (s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSim(a: string, b: string): number {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

async function searchShow(token: string, query: string): Promise<any[]> {
  const url = `https://api.spotify.com/v1/search?type=show&market=HU&limit=10&q=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  const j = await r.json();
  return j?.shows?.items ?? [];
}

async function getShow(token: string, id: string): Promise<any | null> {
  const r = await fetch(`https://api.spotify.com/v1/shows/${id}?market=HU`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Number(body.limit) || 100, 200);
    const dryRun = body.dry_run === true;
    const writeChart = body.write_chart !== false; // default true

    const token = await getToken();

    // 1) Collect candidate podcasts: union of Apple+YouTube chart entries (HU, latest snapshot, matched)
    const { data: chartRows, error: chartErr } = await supabase
      .from("podcast_charts")
      .select("podcast_id, source, snapshot_at")
      .eq("country", "hu")
      .in("source", ["apple", "youtube"])
      .not("podcast_id", "is", null)
      .gt("snapshot_at", new Date(Date.now() - 7 * 86400000).toISOString());
    if (chartErr) throw chartErr;

    const candidateIds = [...new Set((chartRows || []).map((r: any) => r.podcast_id))];
    if (!candidateIds.length) {
      return new Response(JSON.stringify({ ok: true, message: "no chart candidates" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: pods, error: podErr } = await supabase
      .from("podcasts")
      .select("id, title, display_title, spotify_id, spotify_url, spotify_match_status, image_url")
      .in("id", candidateIds)
      .limit(limit);
    if (podErr) throw podErr;

    const results: any[] = [];
    let matched = 0;
    let noMatch = 0;
    let alreadyHad = 0;

    for (const p of pods || []) {
      try {
        let spotifyId: string | null = p.spotify_id || null;
        let method = "existing";
        let confidence = 1.0;

        // Try to extract id from existing spotify_url if no spotify_id
        if (!spotifyId && p.spotify_url) {
          const m = p.spotify_url.match(/show\/([A-Za-z0-9]+)/);
          if (m) {
            spotifyId = m[1];
            method = "url_parse";
          }
        }

        // Search Spotify by title
        if (!spotifyId) {
          const title = p.display_title || p.title || "";
          const hits = await searchShow(token, title);
          let best: any = null;
          let bestScore = 0;
          for (const h of hits) {
            const score = tokenSim(title, h.name);
            if (score > bestScore) {
              bestScore = score;
              best = h;
            }
          }
          if (best && bestScore >= 0.6) {
            spotifyId = best.id;
            confidence = bestScore;
            method = "title_search";
          } else {
            noMatch++;
            results.push({ podcast_id: p.id, title: p.title, status: "no_match", best_score: bestScore });
            if (!dryRun) {
              await supabase
                .from("podcasts")
                .update({ spotify_match_status: "no_match", spotify_last_synced_at: new Date().toISOString() })
                .eq("id", p.id);
            }
            continue;
          }
        } else {
          alreadyHad++;
        }

        // Fetch fresh show details (always — for popularity/followers refresh)
        const show = await getShow(token, spotifyId);
        if (!show) {
          results.push({ podcast_id: p.id, title: p.title, status: "fetch_failed", spotify_id: spotifyId });
          continue;
        }

        matched++;
        const update = {
          spotify_id: show.id,
          spotify_url: show.external_urls?.spotify || p.spotify_url,
          spotify_publisher: show.publisher || null,
          spotify_image_url: show.images?.[0]?.url || null,
          spotify_languages: show.languages || null,
          spotify_total_episodes: show.total_episodes ?? null,
          spotify_popularity: show.popularity ?? null,
          spotify_match_status: "matched",
          spotify_match_method: method,
          spotify_match_confidence: confidence,
          spotify_last_synced_at: new Date().toISOString(),
        };
        results.push({
          podcast_id: p.id,
          title: p.title,
          status: "matched",
          spotify_id: show.id,
          popularity: show.popularity,
          method,
          confidence,
        });
        if (!dryRun) {
          await supabase.from("podcasts").update(update).eq("id", p.id);
          // snapshot
          await supabase.from("podcast_spotify_snapshots").upsert(
            {
              podcast_id: p.id,
              spotify_id: show.id,
              snapshot_date: new Date().toISOString().slice(0, 10),
              followers: null, // shows endpoint doesn't return followers; reserved
              popularity: show.popularity ?? null,
              total_episodes: show.total_episodes ?? null,
            },
            { onConflict: "podcast_id,snapshot_date" },
          );
        }
      } catch (e) {
        results.push({ podcast_id: p.id, title: p.title, status: "error", error: String(e) });
      }
    }

    // 2) Build synthetic Spotify chart by popularity DESC (only matched podcasts)
    let chartInserted = 0;
    if (writeChart && !dryRun) {
      const { data: ranked } = await supabase
        .from("podcasts")
        .select("id, title, spotify_id, spotify_popularity, spotify_image_url, spotify_url")
        .in("id", candidateIds)
        .eq("spotify_match_status", "matched")
        .not("spotify_popularity", "is", null)
        .order("spotify_popularity", { ascending: false })
        .limit(50);

      const snapshotAt = new Date().toISOString();
      const rows = (ranked || []).map((r: any, idx: number) => ({
        source: "spotify",
        country: "hu",
        rank: idx + 1,
        podcast_id: r.id,
        raw_name: r.title,
        raw_external_id: r.spotify_id,
        raw_url: r.spotify_url,
        image_url: r.spotify_image_url,
        matched_via: "spotify_matcher",
        snapshot_at: snapshotAt,
      }));
      if (rows.length) {
        const { error: insErr } = await supabase.from("podcast_charts").insert(rows);
        if (insErr) throw insErr;
        chartInserted = rows.length;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        candidates: candidateIds.length,
        processed: (pods || []).length,
        matched,
        no_match: noMatch,
        already_had_id: alreadyHad,
        chart_inserted: chartInserted,
        dry_run: dryRun,
        sample: results.slice(0, 10),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
