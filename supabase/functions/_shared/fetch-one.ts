// Shared: fetch one podcast feed and upsert episodes.
import { parseFeed } from "./rss.ts";

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
    return { ok: false, error: "no rss_url", new: 0, duplicates: 0, items: 0 };
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
    return { ok: false, error: msg, new: 0, duplicates: 0, items: 0 };
  }

  // Extract channel image from feed if podcast has none
  let channelImage = "";
  try {
    const head = xml.split(/<item\b|<entry\b/i)[0] || "";
    const itunesM = head.match(/<itunes:image\b[^>]*href\s*=\s*["']([^"']+)["']/i);
    const urlM = head.match(/<image\b[\s\S]*?<url>([\s\S]*?)<\/url>/i);
    channelImage = (itunesM?.[1] || urlM?.[1] || "").trim();
  } catch { /* noop */ }

  let items: ReturnType<typeof parseFeed> = [];
  try {
    items = parseFeed(xml, podcast.image_url || channelImage || undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "parse error";
    await supabase.from("podcasts").update({
      rss_status: "failed",
      last_fetched_at: new Date().toISOString(),
      last_fetch_error: `parse: ${msg}`,
    }).eq("id", podcast.id);
    return { ok: false, error: msg, new: 0, duplicates: 0, items: 0 };
  }

  let newCount = 0, duplicates = 0;
  for (const it of items.slice(0, 30)) {
    if (!it.title) continue;
    const slugBase = slugify(it.title);
    const slugSuffix = it.guid
      ? it.guid.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase() || "x"
      : (it.published ? new Date(it.published).getTime().toString(36) : Math.random().toString(36).slice(2, 8));
    const slug = `${slugBase}-${slugSuffix}`;

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

  const update: any = {
    rss_status: "active",
    last_fetched_at: new Date().toISOString(),
    last_fetch_error: null,
    last_fetch_new_count: newCount,
    last_fetch_duplicate_count: duplicates,
  };
  if (!podcast.image_url && channelImage) update.image_url = channelImage;
  await supabase.from("podcasts").update(update).eq("id", podcast.id);

  return { ok: true, new: newCount, duplicates, items: items.length };
}
