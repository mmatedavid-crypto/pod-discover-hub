// Fetch one podcast feed (RSS or Atom) and upsert episodes.
// Supports CDATA, itunes:* / content:encoded / media:thumbnail namespaces,
// and falls back to title+pubDate dedupe when GUID is missing.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { parseFeed, type FeedItem } from "../_shared/rss.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "episode";
}

export async function fetchOne(supabase: any, podcast: any) {
  if (!podcast.rss_url) {
    await supabase.from("podcasts").update({
      rss_status: "failed",
      last_fetched_at: new Date().toISOString(),
      last_fetch_error: "no rss_url configured",
    }).eq("id", podcast.id);
    return { ok: false, error: "no rss_url", new: 0, duplicates: 0 };
  }

  let xml = "";
  try {
    const res = await fetch(podcast.rss_url, {
      headers: { "User-Agent": "PodiverzumBot/1.0 (+https://podiverzum.com)" },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    xml = await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch error";
    await supabase.from("podcasts").update({
      rss_status: "failed",
      last_fetched_at: new Date().toISOString(),
      last_fetch_error: msg,
    }).eq("id", podcast.id);
    return { ok: false, error: msg, new: 0, duplicates: 0 };
  }

  let items: FeedItem[] = [];
  try {
    items = parseFeed(xml, podcast.image_url || undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "parse error";
    await supabase.from("podcasts").update({
      rss_status: "failed",
      last_fetched_at: new Date().toISOString(),
      last_fetch_error: `parse: ${msg}`,
    }).eq("id", podcast.id);
    return { ok: false, error: msg, new: 0, duplicates: 0 };
  }

  let newCount = 0, duplicates = 0;
  for (const it of items.slice(0, 30)) {
    if (!it.title) continue;
    const slugBase = slugify(it.title);
    const slugSuffix = it.guid
      ? it.guid.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase()
      : (it.published ? new Date(it.published).getTime().toString(36) : Math.random().toString(36).slice(2, 8));
    const slug = `${slugBase}-${slugSuffix}`;

    // Dedupe: guid → episode_url → title+published_at
    let isDup = false;
    if (it.guid) {
      const { data } = await supabase.from("episodes").select("id").eq("podcast_id", podcast.id).eq("guid", it.guid).maybeSingle();
      if (data) isDup = true;
    }
    if (!isDup && it.link) {
      const { data } = await supabase.from("episodes").select("id").eq("podcast_id", podcast.id).eq("episode_url", it.link).maybeSingle();
      if (data) isDup = true;
    }
    if (!isDup && it.published) {
      const { data } = await supabase.from("episodes").select("id").eq("podcast_id", podcast.id).eq("title", it.title).eq("published_at", it.published).maybeSingle();
      if (data) isDup = true;
    }

    const row = {
      podcast_id: podcast.id,
      title: it.title,
      slug,
      description: (it.description || "").slice(0, 4000),
      published_at: it.published,
      audio_url: it.audio_url || null,
      episode_url: it.link || null,
      image_url: it.image || null,
      guid: it.guid || null,
    };

    const { error: upErr } = await supabase.from("episodes").upsert(row, { onConflict: "podcast_id,slug" });
    if (!upErr) {
      if (isDup) duplicates++; else newCount++;
    }
  }

  await supabase.from("podcasts").update({
    rss_status: "active",
    last_fetched_at: new Date().toISOString(),
    last_fetch_error: null,
    last_fetch_new_count: newCount,
    last_fetch_duplicate_count: duplicates,
  }).eq("id", podcast.id);

  return { ok: true, new: newCount, duplicates, items: items.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { podcast_id } = await req.json();
    if (!podcast_id) throw new Error("podcast_id required");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: podcast, error } = await supabase.from("podcasts").select("*").eq("id", podcast_id).single();
    if (error || !podcast) throw new Error("podcast not found");
    const result = await fetchOne(supabase, podcast);
    return new Response(JSON.stringify({ ok: result.ok, count: result.new + result.duplicates, ...result }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: result.ok ? 200 : 200,
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
