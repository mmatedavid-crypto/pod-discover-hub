// Shared: fetch one podcast feed and upsert episodes.
import { parseFeed } from "./rss.ts";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "episode";
}

export async function fetchOne(supabase: any, podcast: any, opts: { episodeCap?: number } = {}) {
  const episodeCap = Math.max(1, Math.min(500, opts.episodeCap ?? 30));
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

  const sliced = items.slice(0, episodeCap).filter((it) => it.title);

  // Build candidate rows with deterministic slugs (same as before).
  const candidates = sliced.map((it) => {
    const slugBase = slugify(it.title);
    const slugSuffix = it.guid
      ? it.guid.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase() || "x"
      : (it.published ? new Date(it.published).getTime().toString(36) : Math.random().toString(36).slice(2, 8));
    const slug = `${slugBase}-${slugSuffix}`;
    return { it, slug };
  });

  // Bulk dedupe: pull all existing rows that could match by guid OR episode_url OR (title+published_at) in ONE query each.
  // Uses composite indexes on (podcast_id, guid), (podcast_id, slug), (podcast_id, published_at).
  const guids = Array.from(new Set(candidates.map((c) => c.it.guid).filter(Boolean) as string[]));
  const links = Array.from(new Set(candidates.map((c) => c.it.link).filter(Boolean) as string[]));
  const pubDates = Array.from(new Set(candidates.map((c) => c.it.published).filter(Boolean) as string[]));

  const dedupQueries: Promise<any>[] = [];
  if (guids.length) dedupQueries.push(supabase.from("episodes").select("guid").eq("podcast_id", podcast.id).in("guid", guids));
  if (links.length) dedupQueries.push(supabase.from("episodes").select("episode_url").eq("podcast_id", podcast.id).in("episode_url", links));
  if (pubDates.length) dedupQueries.push(supabase.from("episodes").select("title, published_at").eq("podcast_id", podcast.id).in("published_at", pubDates));

  const dedupResults = await Promise.all(dedupQueries);
  const existingGuids = new Set<string>();
  const existingLinks = new Set<string>();
  const existingTitlePub = new Set<string>();
  let qi = 0;
  if (guids.length) { (dedupResults[qi++]?.data || []).forEach((r: any) => r.guid && existingGuids.add(r.guid)); }
  if (links.length) { (dedupResults[qi++]?.data || []).forEach((r: any) => r.episode_url && existingLinks.add(r.episode_url)); }
  if (pubDates.length) { (dedupResults[qi++]?.data || []).forEach((r: any) => existingTitlePub.add(`${r.title}|${r.published_at}`)); }

  let newCount = 0, duplicates = 0;
  const rowsToUpsert: any[] = [];
  for (const { it, slug } of candidates) {
    const isDup =
      (it.guid && existingGuids.has(it.guid)) ||
      (it.link && existingLinks.has(it.link)) ||
      (it.published && existingTitlePub.has(`${it.title}|${it.published}`));

    if (isDup) duplicates++; else newCount++;

    rowsToUpsert.push({
      podcast_id: podcast.id,
      title: it.title,
      slug,
      description: (it.description || "").slice(0, 4000),
      published_at: it.published,
      audio_url: it.audio_url || null,
      episode_url: it.link || null,
      image_url: it.image || null,
      guid: it.guid || null,
    });
  }

  if (rowsToUpsert.length) {
    // One bulk upsert. onConflict (podcast_id, slug) preserves the existing dedupe semantics for replays.
    const { error: upErr } = await supabase.from("episodes").upsert(rowsToUpsert, { onConflict: "podcast_id,slug" });
    if (upErr) {
      // If bulk upsert fails, surface as a fetch error so the caller can mark it.
      await supabase.from("podcasts").update({
        rss_status: "failed",
        last_fetched_at: new Date().toISOString(),
        last_fetch_error: `upsert: ${upErr.message}`,
      }).eq("id", podcast.id);
      return { ok: false, error: upErr.message, new: 0, duplicates: 0, items: items.length };
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
