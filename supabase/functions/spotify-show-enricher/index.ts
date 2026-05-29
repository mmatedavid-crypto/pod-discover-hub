// Spotify SHOW enricher — runs against the WHOLE catalog (HU podcasts).
// Two passes:
//   A) Match unknown podcasts via /v1/search (1 req per podcast, ~3 req/s safe)
//   B) Refresh rich metadata via /v1/shows/{id} (per-show, client_credentials)
//
// Rate-limit hardened: max 60s Retry-After, global cooldown_until in app_settings,
// per-pass time budget (90s wall), early-return when cooldown active.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SPOTIFY_CLIENT_ID = Deno.env.get("SPOTIFY_CLIENT_ID")!;
const SPOTIFY_CLIENT_SECRET = Deno.env.get("SPOTIFY_CLIENT_SECRET")!;

const MAX_RETRY_AFTER_MS = 60_000; // hard cap — never block longer than this in-process
const WALL_BUDGET_MS = 90_000;     // per-invocation time budget

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

// Returns { response | null, cooldownMs | null }. If 429 with Retry-After > cap,
// returns cooldownMs (the server-requested wait) so the caller can persist it.
async function spFetch(url: string, token: string): Promise<{ res: Response | null; cooldownMs: number | null }> {
  for (let i = 0; i < 2; i++) {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (r.status !== 429) return { res: r, cooldownMs: null };
    const retryAfterSec = Number(r.headers.get("Retry-After") || "2");
    const waitMs = retryAfterSec * 1000;
    if (waitMs > MAX_RETRY_AFTER_MS) {
      // Too long — surface it so the runner can persist a cooldown and bail
      return { res: null, cooldownMs: waitMs };
    }
    await new Promise((res) => setTimeout(res, waitMs));
  }
  return { res: null, cooldownMs: 30_000 };
}

function pickImages(images: any[] | undefined): { i640: string | null; i300: string | null; i64: string | null } {
  if (!images?.length) return { i640: null, i300: null, i64: null };
  const sorted = [...images].sort((a, b) => (b.width || 0) - (a.width || 0));
  return {
    i640: sorted.find((x) => (x.width || 0) >= 500)?.url || sorted[0]?.url || null,
    i300: sorted.find((x) => (x.width || 0) >= 200 && (x.width || 0) < 500)?.url || sorted[Math.floor(sorted.length / 2)]?.url || null,
    i64: sorted.find((x) => (x.width || 0) < 200)?.url || sorted[sorted.length - 1]?.url || null,
  };
}

async function getCooldown(supabase: any): Promise<number> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", "spotify_enricher_state").maybeSingle();
  const until = data?.value?.cooldown_until ? Date.parse(data.value.cooldown_until) : 0;
  return until > Date.now() ? until : 0;
}
async function setCooldown(supabase: any, ms: number, reason: string) {
  const until = new Date(Date.now() + ms).toISOString();
  await supabase.from("app_settings").upsert({
    key: "spotify_enricher_state",
    value: { cooldown_until: until, reason, set_at: new Date().toISOString() },
    updated_at: new Date().toISOString(),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const startedAt = Date.now();
  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.min(Number(body.limit) || 200, 500);
    const matchOnly = body.match_only === true;
    const refreshOnly = body.refresh_only === true;
    const force = body.force === true;

    // Cooldown gate — skip entire run if Spotify told us to back off
    if (!body.ignore_cooldown) {
      const cooldownUntil = await getCooldown(supabase);
      if (cooldownUntil) {
        return new Response(JSON.stringify({
          ok: true, skipped: "cooldown_active",
          cooldown_until: new Date(cooldownUntil).toISOString(),
          minutes_left: Math.round((cooldownUntil - Date.now()) / 60000),
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    }

    const token = await getToken();
    const summary: any = { matched: 0, no_match: 0, refreshed: 0, errors: 0 };
    let cooldownTriggered = false;

    const overBudget = () => Date.now() - startedAt > WALL_BUDGET_MS;

    // ---- PASS A: match unknown HU podcasts ----
    if (!refreshOnly && !cooldownTriggered) {
      const { data: unmatched, error } = await supabase
        .from("podcasts")
        .select("id, title, display_title, language, spotify_match_status")
        .ilike("language", "hu%")
        .is("spotify_id", null)
        .or("spotify_match_status.is.null,spotify_match_status.neq.no_match")
        .limit(limit);
      if (error) throw error;

      for (const p of unmatched || []) {
        if (overBudget() || cooldownTriggered) break;
        try {
          const title = (p.display_title || p.title || "").trim();
          if (!title) continue;
          const q = encodeURIComponent(title);
          const { res, cooldownMs } = await spFetch(`https://api.spotify.com/v1/search?type=show&market=HU&limit=10&q=${q}`, token);
          if (cooldownMs) {
            await setCooldown(supabase, Math.min(cooldownMs, 6 * 3600_000), `429 search (${cooldownMs}ms)`);
            cooldownTriggered = true;
            break;
          }
          if (!res || !res.ok) { summary.errors++; continue; }
          const j = await res.json();
          const hits = j?.shows?.items || [];
          let best: any = null, bestScore = 0;
          for (const h of hits) {
            const s = tokenSim(title, h.name);
            if (s > bestScore) { bestScore = s; best = h; }
          }
          if (best && bestScore >= 0.6) {
            await supabase.from("podcasts").update({
              spotify_id: best.id,
              spotify_url: best.external_urls?.spotify || null,
              spotify_match_status: "matched",
              spotify_match_method: "title_search",
              spotify_match_confidence: bestScore,
              spotify_last_synced_at: new Date().toISOString(),
            }).eq("id", p.id);
            summary.matched++;
          } else {
            await supabase.from("podcasts").update({
              spotify_match_status: "no_match",
              spotify_last_synced_at: new Date().toISOString(),
            }).eq("id", p.id);
            summary.no_match++;
          }
          await new Promise((r) => setTimeout(r, 300));
        } catch (e) {
          summary.errors++;
        }
      }
    }

    // ---- PASS B: refresh rich metadata ----
    if (!matchOnly && !cooldownTriggered) {
      const freshCutoff = new Date(Date.now() - 7 * 86400 * 1000).toISOString();
      let q = supabase
        .from("podcasts")
        .select("id, spotify_id")
        .ilike("language", "hu%")
        .not("spotify_id", "is", null);
      if (!force) {
        q = q.or(`spotify_show_enriched_at.is.null,spotify_show_enriched_at.lt.${freshCutoff}`);
      }
      const { data: pods, error } = await q.limit(limit);
      if (error) throw error;

      for (const pod of pods || []) {
        if (overBudget() || cooldownTriggered) break;
        try {
          const { res, cooldownMs } = await spFetch(`https://api.spotify.com/v1/shows/${pod.spotify_id}?market=HU`, token);
          if (cooldownMs) {
            await setCooldown(supabase, Math.min(cooldownMs, 6 * 3600_000), `429 show (${cooldownMs}ms)`);
            cooldownTriggered = true;
            break;
          }
          if (!res || !res.ok) {
            const txt = res ? await res.text().catch(() => "") : "";
            console.error("show fetch failed", pod.spotify_id, res?.status, txt.slice(0, 200));
            summary.errors++;
            continue;
          }
          const show = await res.json();
          const imgs = pickImages(show.images);
          await supabase.from("podcasts").update({
            spotify_publisher: show.publisher || null,
            spotify_description: show.description || null,
            spotify_html_description: show.html_description || null,
            spotify_image_url: imgs.i640,
            spotify_image_url_640: imgs.i640,
            spotify_image_url_300: imgs.i300,
            spotify_image_url_64: imgs.i64,
            spotify_explicit: show.explicit ?? null,
            spotify_media_type: show.media_type || null,
            spotify_copyrights: show.copyrights || null,
            spotify_available_markets: show.available_markets || null,
            spotify_is_externally_hosted: show.is_externally_hosted ?? null,
            spotify_languages: show.languages || null,
            spotify_total_episodes: show.total_episodes ?? null,
            spotify_show_enriched_at: new Date().toISOString(),
            spotify_last_synced_at: new Date().toISOString(),
          }).eq("id", pod.id);
          summary.refreshed++;
          await new Promise((r) => setTimeout(r, 320));
        } catch (e) {
          summary.errors++;
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true, ...summary, cooldown_triggered: cooldownTriggered,
      elapsed_ms: Date.now() - startedAt,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message || e?.error_description || JSON.stringify(e);
    console.error("spotify-show-enricher error", msg, e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
