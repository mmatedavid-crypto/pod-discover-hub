// PodcastIndex episode backfill — pulls ALL episodes PI knows for a podcast,
// even ones that have aged out of the live RSS feed. Drains in one invocation
// up to TIME_BUDGET, then returns. Safe to call repeatedly.
//
// POST body:
//   { limit?: number, podcast_ids?: string[], force?: boolean, dry_run?: boolean }
//
// - limit: max podcasts to process per run (default 8, hard cap 30)
// - podcast_ids: explicit list (skips eligibility filter)
// - force: re-run even if pi_backfill_completed_at is set
// - dry_run: only report what would happen
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PI_API = "https://api.podcastindex.org/api/1.0";
const TIME_BUDGET_MS = 110_000;
const PER_PODCAST_BUDGET_MS = 25_000;

async function sha1Hex(input: string) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

import { slugify as slugifyShared } from "../_shared/slug.ts";
function slugify(s: string) {
  return slugifyShared(s, "episode");
}

async function piHeaders() {
  const apiKey = Deno.env.get("PODCAST_INDEX_API_KEY")!;
  const apiSecret = Deno.env.get("PODCAST_INDEX_API_SECRET")!;
  const date = Math.floor(Date.now() / 1000).toString();
  const auth = await sha1Hex(apiKey + apiSecret + date);
  return {
    "User-Agent": "Podiverzum/1.0 pi-episode-backfill",
    "X-Auth-Date": date,
    "X-Auth-Key": apiKey,
    "Authorization": auth,
  };
}

async function piEpisodesByFeedUrl(rssUrl: string, max = 1000) {
  const url = `${PI_API}/episodes/byfeedurl?url=${encodeURIComponent(rssUrl)}&max=${max}&fulltext`;
  const res = await fetch(url, {
    headers: await piHeaders(),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`PI byfeedurl http ${res.status}`);
  const j = await res.json();
  return Array.isArray(j?.items) ? j.items : [];
}

function tsToIso(ts?: number | null) {
  if (!ts || typeof ts !== "number") return null;
  try { return new Date(ts * 1000).toISOString(); } catch { return null; }
}

async function processPodcast(supabase: any, podcast: any, dryRun: boolean) {
  const t0 = Date.now();
  let items: any[] = [];
  try {
    items = await piEpisodesByFeedUrl(podcast.rss_url, 1000);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch_err";
    if (!dryRun) {
      await supabase.from("podcasts").update({
        pi_backfill_completed_at: new Date().toISOString(),
        pi_backfill_error: msg,
        pi_backfill_episode_count: 0,
      }).eq("id", podcast.id);
    }
    return { id: podcast.id, title: podcast.title, ok: false, error: msg, items: 0, new: 0, dup: 0 };
  }

  if (items.length === 0) {
    if (!dryRun) {
      await supabase.from("podcasts").update({
        pi_backfill_completed_at: new Date().toISOString(),
        pi_backfill_error: null,
        pi_backfill_episode_count: 0,
      }).eq("id", podcast.id);
    }
    return { id: podcast.id, title: podcast.title, ok: true, items: 0, new: 0, dup: 0 };
  }

  // Build candidates
  const candidates = items
    .filter((it) => it && (it.title || "").trim())
    .map((it) => {
      const guid = (it.guid || it.id || "").toString().trim() || null;
      const link = (it.link || "").toString().trim() || null;
      const audio = (it.enclosureUrl || "").toString().trim() || null;
      const published = tsToIso(it.datePublished);
      const slugBase = slugify(it.title);
      const slugSuffix = guid
        ? guid.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase() || "x"
        : (published ? new Date(published).getTime().toString(36) : Math.random().toString(36).slice(2, 8));
      return {
        guid,
        link,
        audio,
        published,
        title: it.title.toString().slice(0, 500),
        description: (it.description || "").toString().slice(0, 12000),
        image: it.image || it.feedImage || null,
        slug: `${slugBase}-${slugSuffix}`,
      };
    });

  // Dedupe in batches: by guid + episode_url
  const guids = Array.from(new Set(candidates.map((c) => c.guid).filter(Boolean) as string[]));
  const links = Array.from(new Set(candidates.map((c) => c.link).filter(Boolean) as string[]));

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
  const seenSlugs = new Set<string>();
  const rows: any[] = [];
  for (const c of candidates) {
    const dup = (c.guid && existingGuids.has(c.guid)) || (c.link && existingLinks.has(c.link));
    if (dup) { dupCount++; continue; }
    if (seenSlugs.has(c.slug)) continue;
    seenSlugs.add(c.slug);
    newCount++;
    rows.push({
      podcast_id: podcast.id,
      title: c.title,
      slug: c.slug,
      description: c.description,
      published_at: c.published,
      audio_url: c.audio,
      episode_url: c.link,
      image_url: c.image,
      guid: c.guid,
    });
  }

  if (dryRun) {
    return { id: podcast.id, title: podcast.title, ok: true, items: items.length, new: newCount, dup: dupCount, dry: true };
  }

  if (rows.length > 0) {
    const UPSERT_CHUNK = 200;
    for (let i = 0; i < rows.length; i += UPSERT_CHUNK) {
      const slice = rows.slice(i, i + UPSERT_CHUNK);
      const { error } = await supabase.from("episodes")
        .upsert(slice, { onConflict: "podcast_id,slug" });
      if (error) {
        await supabase.from("podcasts").update({
          pi_backfill_completed_at: new Date().toISOString(),
          pi_backfill_error: `upsert: ${error.message}`,
          pi_backfill_episode_count: i,
        }).eq("id", podcast.id);
        return { id: podcast.id, title: podcast.title, ok: false, error: error.message, items: items.length, new: i, dup: dupCount };
      }
    }
  }

  await supabase.from("podcasts").update({
    pi_backfill_completed_at: new Date().toISOString(),
    pi_backfill_error: null,
    pi_backfill_episode_count: items.length,
  }).eq("id", podcast.id);

  return {
    id: podcast.id, title: podcast.title, ok: true,
    items: items.length, new: newCount, dup: dupCount,
    elapsed_ms: Date.now() - t0,
  };
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
    const limit = Math.max(1, Math.min(30, Number(body?.limit) || 8));
    const explicitIds: string[] = Array.isArray(body?.podcast_ids) ? body.podcast_ids : [];
    const force = !!body?.force;
    const dryRun = !!body?.dry_run;

    let q = supabase.from("podcasts")
      .select("id, title, rss_url, podiverzum_rank, rank_label, pi_backfill_completed_at")
      .not("rss_url", "is", null);

    if (explicitIds.length > 0) {
      q = q.in("id", explicitIds);
    } else {
      q = q.ilike("language", "hu%").eq("rss_status", "active");
      if (!force) q = q.is("pi_backfill_completed_at", null);
      // Tier szűrés: S/A automata, B/C csak admin-jóváhagyott
      // Egy lekérdezésben: rank_label IN (S,A) OR (rank_label IN (B,C) AND pi_backfill_approved=true)
      q = q.or("and(rank_label.in.(S,A)),and(rank_label.in.(B,C),pi_backfill_approved.eq.true)");
      q = q.order("podiverzum_rank", { ascending: false, nullsFirst: false }).limit(limit);
    }

    const { data: podcasts, error } = await q;
    if (error) throw error;
    const todo = podcasts || [];

    const results: any[] = [];
    let totalNew = 0, totalDup = 0, totalItems = 0, errors = 0;

    for (const p of todo) {
      if (Date.now() - t0 > TIME_BUDGET_MS - PER_PODCAST_BUDGET_MS) {
        results.push({ id: p.id, title: p.title, skipped: "time_budget" });
        continue;
      }
      const r = await processPodcast(supabase, p, dryRun);
      results.push(r);
      if (r.ok) {
        totalNew += r.new || 0;
        totalDup += r.dup || 0;
        totalItems += r.items || 0;
      } else {
        errors++;
      }
    }

    // Count remaining (rough)
    const { count: remaining } = await supabase
      .from("podcasts")
      .select("id", { count: "exact", head: true })
      .ilike("language", "hu%")
      .eq("rss_status", "active")
      .is("pi_backfill_completed_at", null);

    return new Response(JSON.stringify({
      ok: true,
      processed: todo.length,
      total_items: totalItems,
      new_episodes: totalNew,
      duplicates: totalDup,
      errors,
      remaining,
      dry_run: dryRun,
      elapsed_ms: Date.now() - t0,
      results,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
