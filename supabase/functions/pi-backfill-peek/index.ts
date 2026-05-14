// PI episode backfill PEEK — dry-run only, NEM ír episodes táblába.
// Lekéri a PI-ből az epizód-listát, megszámolja a meglévő guid+link alapján a duplikátumokat,
// és podcasts.pi_backfill_dry_run JSONB-be cache-eli az eredményt.
//
// Cél: B/C tier podcastek admin-jóváhagyásához mutassa, mennyi új epizód jönne.
//
// POST body:
//   { limit?: number, podcast_ids?: string[], force?: boolean,
//     tier_filter?: ("S"|"A"|"B"|"C")[] }  // default ["B","C"]
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PI_API = "https://api.podcastindex.org/api/1.0";
const TIME_BUDGET_MS = 110_000;
const PER_PODCAST_BUDGET_MS = 15_000;

async function sha1Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function piHeaders() {
  const apiKey = Deno.env.get("PODCAST_INDEX_API_KEY")!;
  const apiSecret = Deno.env.get("PODCAST_INDEX_API_SECRET")!;
  const date = Math.floor(Date.now() / 1000).toString();
  const auth = await sha1Hex(apiKey + apiSecret + date);
  return {
    "User-Agent": "Podiverzum/1.0 pi-backfill-peek",
    "X-Auth-Date": date,
    "X-Auth-Key": apiKey,
    "Authorization": auth,
  };
}

async function piEpisodesByFeedUrl(rssUrl: string, max = 1000) {
  const url = `${PI_API}/episodes/byfeedurl?url=${encodeURIComponent(rssUrl)}&max=${max}&fulltext`;
  const res = await fetch(url, { headers: await piHeaders(), signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`PI http ${res.status}`);
  const j = await res.json();
  return Array.isArray(j?.items) ? j.items : [];
}

async function peekOne(supabase: any, podcast: any) {
  const t0 = Date.now();
  let items: any[] = [];
  try {
    items = await piEpisodesByFeedUrl(podcast.rss_url, 1000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch_err";
    const dry = { ok: false, error: msg, items: 0, new: 0, dup: 0, peeked_at: new Date().toISOString() };
    await supabase.from("podcasts").update({
      pi_backfill_dry_run: dry,
      pi_backfill_peeked_at: dry.peeked_at,
    }).eq("id", podcast.id);
    return { id: podcast.id, title: podcast.title, ...dry };
  }

  const guids = Array.from(new Set(items.map((it: any) => (it.guid || it.id || "").toString().trim()).filter(Boolean)));
  const links = Array.from(new Set(items.map((it: any) => (it.link || "").toString().trim()).filter(Boolean)));

  const existingGuids = new Set<string>();
  const existingLinks = new Set<string>();
  const CHUNK = 200;
  for (let i = 0; i < guids.length; i += CHUNK) {
    const slice = guids.slice(i, i + CHUNK);
    const { data } = await supabase.from("episodes").select("guid")
      .eq("podcast_id", podcast.id).in("guid", slice);
    (data || []).forEach((r: any) => r.guid && existingGuids.add(r.guid));
  }
  for (let i = 0; i < links.length; i += CHUNK) {
    const slice = links.slice(i, i + CHUNK);
    const { data } = await supabase.from("episodes").select("episode_url")
      .eq("podcast_id", podcast.id).in("episode_url", slice);
    (data || []).forEach((r: any) => r.episode_url && existingLinks.add(r.episode_url));
  }

  let newCount = 0, dupCount = 0;
  for (const it of items) {
    const guid = (it.guid || it.id || "").toString().trim();
    const link = (it.link || "").toString().trim();
    const dup = (guid && existingGuids.has(guid)) || (link && existingLinks.has(link));
    if (dup) dupCount++; else newCount++;
  }

  const dry = {
    ok: true,
    items: items.length,
    new: newCount,
    dup: dupCount,
    peeked_at: new Date().toISOString(),
    elapsed_ms: Date.now() - t0,
  };
  await supabase.from("podcasts").update({
    pi_backfill_dry_run: dry,
    pi_backfill_peeked_at: dry.peeked_at,
  }).eq("id", podcast.id);

  return { id: podcast.id, title: podcast.title, ...dry };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const t0 = Date.now();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Math.max(1, Math.min(50, Number(body?.limit) || 15));
    const explicitIds: string[] = Array.isArray(body?.podcast_ids) ? body.podcast_ids : [];
    const force = !!body?.force;
    const tierFilter: string[] = Array.isArray(body?.tier_filter) && body.tier_filter.length > 0
      ? body.tier_filter : ["B", "C"];

    let q = supabase.from("podcasts")
      .select("id, title, rss_url, podiverzum_rank, rank_label")
      .not("rss_url", "is", null);

    if (explicitIds.length > 0) {
      q = q.in("id", explicitIds);
    } else {
      q = q.ilike("language", "hu%").eq("rss_status", "active")
        .is("pi_backfill_completed_at", null)
        .in("rank_label", tierFilter);
      if (!force) q = q.is("pi_backfill_peeked_at", null);
      q = q.order("podiverzum_rank", { ascending: false, nullsFirst: false }).limit(limit);
    }

    const { data: podcasts, error } = await q;
    if (error) throw error;
    const todo = podcasts || [];

    const results: any[] = [];
    let totalNew = 0, totalDup = 0, errors = 0;

    for (const p of todo) {
      if (Date.now() - t0 > TIME_BUDGET_MS - PER_PODCAST_BUDGET_MS) {
        results.push({ id: p.id, title: p.title, skipped: "time_budget" });
        continue;
      }
      const r = await peekOne(supabase, p);
      results.push(r);
      if (r.ok) { totalNew += r.new || 0; totalDup += r.dup || 0; } else errors++;
    }

    const { count: remaining } = await supabase
      .from("podcasts")
      .select("id", { count: "exact", head: true })
      .ilike("language", "hu%")
      .eq("rss_status", "active")
      .is("pi_backfill_completed_at", null)
      .in("rank_label", tierFilter)
      .is("pi_backfill_peeked_at", null);

    return new Response(JSON.stringify({
      ok: true, processed: todo.length,
      total_new: totalNew, total_dup: totalDup, errors,
      remaining_to_peek: remaining ?? 0,
      elapsed_ms: Date.now() - t0,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
