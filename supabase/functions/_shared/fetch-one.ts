// Shared: fetch one podcast feed and upsert episodes.
// Crawler features: ETag/Last-Modified caching, 301 + <itunes:new-feed-url> following,
// repeated-failure → quarantine/dead, crawl_state transitions.
import { parseFeed } from "./rss.ts";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 80) || "episode";
}

const DEAD_THRESHOLD = 3;        // consecutive 404/410 → dead
const QUARANTINE_THRESHOLD = 5;  // consecutive other failures → quarantined 7d
const QUARANTINE_DAYS = 7;

async function recordRssUrlChange(supabase: any, podcastId: string, oldUrl: string | null, newUrl: string, reason: string) {
  try {
    await supabase.from("rss_url_history").insert({
      podcast_id: podcastId, old_url: oldUrl, new_url: newUrl, reason,
    });
    await supabase.from("podcasts").update({ rss_url: newUrl }).eq("id", podcastId);
  } catch { /* noop */ }
}

async function markFailure(supabase: any, podcast: any, msg: string, isDeadCode = false) {
  const next = (podcast.consecutive_failure_count || 0) + 1;
  // Exponential backoff: 30m * 2^min(n,8), capped at 7 days
  const backoffMin = Math.min(10080, Math.round(30 * Math.pow(2, Math.min(next, 8))));
  const upd: any = {
    rss_status: "failed",
    last_fetched_at: new Date().toISOString(),
    last_fetch_error: msg,
    consecutive_failure_count: next,
    next_fetch_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
  };
  if (isDeadCode && next >= DEAD_THRESHOLD) {
    upd.crawl_state = "dead";
  } else if (next >= QUARANTINE_THRESHOLD) {
    upd.crawl_state = "quarantined";
    upd.quarantined_until = new Date(Date.now() + QUARANTINE_DAYS * 86400_000).toISOString();
  }
  await supabase.from("podcasts").update(upd).eq("id", podcast.id);
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
  let respEtag: string | null = null;
  let respLastModified: string | null = null;
  let finalUrl = podcast.rss_url as string;

  try {
    const headers: Record<string, string> = { "User-Agent": "PodiverzumBot/1.0 (+https://podiverzum.com)" };
    if (podcast.last_etag) headers["If-None-Match"] = podcast.last_etag;
    if (podcast.last_modified) headers["If-Modified-Since"] = podcast.last_modified;

    const res = await fetch(podcast.rss_url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });

    finalUrl = res.url || podcast.rss_url;
    if (finalUrl !== podcast.rss_url) {
      await recordRssUrlChange(supabase, podcast.id, podcast.rss_url, finalUrl, "http_redirect");
      podcast.rss_url = finalUrl;
    }

    if (res.status === 304) {
      // Not modified — cheap success.
      await supabase.from("podcasts").update({
        rss_status: "active",
        last_fetched_at: new Date().toISOString(),
        last_fetch_error: null,
        last_fetch_new_count: 0,
        last_fetch_duplicate_count: 0,
        consecutive_failure_count: 0,
        next_fetch_at: null,
      }).eq("id", podcast.id);
      return { ok: true, new: 0, duplicates: 0, items: 0, not_modified: true };
    }

    if (res.status === 404 || res.status === 410) {
      await markFailure(supabase, podcast, `HTTP ${res.status}`, true);
      return { ok: false, error: `HTTP ${res.status}`, new: 0, duplicates: 0, items: 0 };
    }

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    respEtag = res.headers.get("etag");
    respLastModified = res.headers.get("last-modified");
    xml = await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "fetch error";
    await markFailure(supabase, podcast, msg, false);
    return { ok: false, error: msg, new: 0, duplicates: 0, items: 0 };
  }

  // Extract channel image + new-feed-url from feed head
  let channelImage = "";
  let newFeedUrl = "";
  try {
    const head = xml.split(/<item\b|<entry\b/i)[0] || "";
    const itunesM = head.match(/<itunes:image\b[^>]*href\s*=\s*["']([^"']+)["']/i);
    const urlM = head.match(/<image\b[\s\S]*?<url>([\s\S]*?)<\/url>/i);
    channelImage = (itunesM?.[1] || urlM?.[1] || "").trim();
    const nfu = head.match(/<itunes:new-feed-url>([\s\S]*?)<\/itunes:new-feed-url>/i);
    if (nfu?.[1]) newFeedUrl = nfu[1].trim();
  } catch { /* noop */ }

  if (newFeedUrl && newFeedUrl !== podcast.rss_url) {
    await recordRssUrlChange(supabase, podcast.id, podcast.rss_url, newFeedUrl, "itunes_new_feed_url");
  }

  let items: ReturnType<typeof parseFeed> = [];
  try {
    items = parseFeed(xml, podcast.image_url || channelImage || undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "parse error";
    await markFailure(supabase, podcast, `parse: ${msg}`, false);
    return { ok: false, error: msg, new: 0, duplicates: 0, items: 0 };
  }

  const sliced = items.slice(0, episodeCap).filter((it) => it.title);

  const candidates = sliced.map((it) => {
    const slugBase = slugify(it.title);
    const slugSuffix = it.guid
      ? it.guid.replace(/[^a-z0-9]/gi, "").slice(-8).toLowerCase() || "x"
      : (it.published ? new Date(it.published).getTime().toString(36) : Math.random().toString(36).slice(2, 8));
    const slug = `${slugBase}-${slugSuffix}`;
    return { it, slug };
  });

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
    const { error: upErr } = await supabase.from("episodes").upsert(rowsToUpsert, { onConflict: "podcast_id,slug" });
    if (upErr) {
      await markFailure(supabase, podcast, `upsert: ${upErr.message}`, false);
      return { ok: false, error: upErr.message, new: 0, duplicates: 0, items: items.length };
    }
  }

  const update: any = {
    rss_status: "active",
    last_fetched_at: new Date().toISOString(),
    last_fetch_error: null,
    last_fetch_new_count: newCount,
    last_fetch_duplicate_count: duplicates,
    consecutive_failure_count: 0,
    quarantined_until: null,
  };
  if (respEtag) update.last_etag = respEtag;
  if (respLastModified) update.last_modified = respLastModified;
  if (!podcast.image_url && channelImage) update.image_url = channelImage;

  // crawl_state lifecycle: only transition forward from staged → light_indexed.
  // full_backfilled / incremental_refresh transitions are handled by deep-hydrate-runner.
  if (podcast.crawl_state === "staged" || podcast.crawl_state === "quarantined" || podcast.crawl_state === "dead") {
    update.crawl_state = "light_indexed";
  }

  await supabase.from("podcasts").update(update).eq("id", podcast.id);

  return { ok: true, new: newCount, duplicates, items: items.length };
}
