// Spotify EPISODE matcher — paginates /v1/shows/{id}/episodes for each matched podcast
// and pairs Spotify episodes with our episodes by (release_date + fuzzy title).
// Writes into episode_spotify_meta (upsert by episode_id).
//
// Body: { limit?: number, force?: boolean, podcast_id?: string }

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
  return (await r.json()).access_token as string;
}

async function spFetch(url: string, token: string, retries = 3): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status !== 429) return r;
    const wait = Number(r.headers.get("Retry-After") || "2") * 1000;
    await new Promise((res) => setTimeout(res, wait));
  }
  return await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
}

function norm(s: string): string {
  return (s || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}
function tokenSim(a: string, b: string): number {
  const A = new Set(norm(a).split(" ").filter(Boolean));
  const B = new Set(norm(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / Math.max(A.size, B.size);
}

function pickImages(images: any[] | undefined): { i640: string | null; i300: string | null; i64: string | null } {
  if (!images?.length) return { i640: null, i300: null, i64: null };
  const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
  return {
    i640: sorted.find((x) => (x.width || 0) >= 500)?.url || sorted[0]?.url || null,
    i300: sorted.find((x) => (x.width || 0) >= 200 && (x.width || 0) < 500)?.url || null,
    i64: sorted.find((x) => (x.width || 0) < 200)?.url || sorted[sorted.length - 1]?.url || null,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Number(body.limit) || 20, 100); // podcasts per run
    const force = body.force === true;
    const requestedPodcast = body.podcast_id as string | undefined;

    const token = await getToken();
    const summary = { podcasts_processed: 0, episodes_seen: 0, matched: 0, upserted: 0, errors: 0 };

    let query = supabase
      .from("podcasts")
      .select("id, spotify_id, spotify_episodes_last_synced_at, spotify_total_episodes")
      .ilike("language", "hu%")
      .not("spotify_id", "is", null);

    if (requestedPodcast) {
      query = query.eq("id", requestedPodcast);
    } else if (!force) {
      const cutoff = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
      query = query.or(`spotify_episodes_last_synced_at.is.null,spotify_episodes_last_synced_at.lt.${cutoff}`);
    }
    query = query.order("spotify_episodes_last_synced_at", { ascending: true, nullsFirst: true }).limit(limit);

    const { data: pods, error } = await query;
    if (error) throw error;

    for (const pod of pods || []) {
      try {
        // Load all our episodes for this podcast (released within 30 years, indexed by release_date)
        const { data: ours } = await supabase
          .from("episodes")
          .select("id, title, published_at")
          .eq("podcast_id", pod.id);
        const oursByDate = new Map<string, any[]>();
        for (const e of ours || []) {
          if (!e.published_at) continue;
          const d = String(e.published_at).slice(0, 10);
          const bucket = oursByDate.get(d) || [];
          bucket.push(e);
          oursByDate.set(d, bucket);
        }

        // Page through Spotify episodes
        let url: string | null = `https://api.spotify.com/v1/shows/${pod.spotify_id}/episodes?market=HU&limit=50&offset=0`;
        let pageGuard = 0;
        while (url && pageGuard < 60) {
          pageGuard++;
          const r = await spFetch(url, token);
          if (!r.ok) { summary.errors++; break; }
          const j = await r.json();
          const items = j?.items || [];
          for (const sp of items) {
            if (!sp || !sp.id) continue;
            summary.episodes_seen++;
            const spDate = (sp.release_date || "").slice(0, 10);
            const sameDay = oursByDate.get(spDate) || [];
            // Also try ±1 day buckets for timezone wobble
            const neighbors = [
              ...sameDay,
              ...(oursByDate.get(shiftDate(spDate, -1)) || []),
              ...(oursByDate.get(shiftDate(spDate, +1)) || []),
            ];
            let best: any = null, bestScore = 0;
            for (const ours of neighbors) {
              const s = tokenSim(sp.name, ours.title);
              if (s > bestScore) { bestScore = s; best = ours; }
            }
            const method = best && bestScore >= 0.55 ? (spDate === (best.published_at || "").slice(0, 10) ? "name_date" : "name_neardate") : null;
            if (!best || !method) continue;
            summary.matched++;

            const imgs = pickImages(sp.images);
            const { error: upErr } = await supabase.from("episode_spotify_meta").upsert({
              episode_id: best.id,
              podcast_id: pod.id,
              spotify_episode_id: sp.id,
              spotify_url: sp.external_urls?.spotify || null,
              duration_ms: sp.duration_ms ?? null,
              release_date: sp.release_date || null,
              release_date_precision: sp.release_date_precision || null,
              spotify_description: sp.description || null,
              spotify_html_description: sp.html_description || null,
              spotify_image_url_640: imgs.i640,
              spotify_image_url_300: imgs.i300,
              spotify_image_url_64: imgs.i64,
              spotify_explicit: sp.explicit ?? null,
              audio_preview_url: sp.audio_preview_url || null,
              spotify_language: sp.language || null,
              spotify_languages: sp.languages || null,
              is_playable: sp.is_playable ?? null,
              restrictions: sp.restrictions || null,
              match_method: method,
              match_confidence: bestScore,
              last_synced_at: new Date().toISOString(),
            }, { onConflict: "episode_id" });
            if (upErr) summary.errors++;
            else summary.upserted++;
          }
          url = j?.next || null;
          await new Promise((r) => setTimeout(r, 300));
        }

        await supabase.from("podcasts")
          .update({ spotify_episodes_last_synced_at: new Date().toISOString() })
          .eq("id", pod.id);
        summary.podcasts_processed++;
      } catch (e) {
        summary.errors++;
      }
    }

    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function shiftDate(d: string, days: number): string {
  if (!d || d.length < 10) return "";
  const dt = new Date(d + "T00:00:00Z");
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}
