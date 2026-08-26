// Shared: fetch one podcast feed and upsert episodes.
// Crawler features: ETag/Last-Modified caching, 301 + <itunes:new-feed-url> following,
// repeated-failure → quarantine/dead, crawl_state transitions.
import { parseFeed } from "./rss.ts";
import { slugify as slugifyShared } from "./slug.ts";

function slugify(s: string) {
  return slugifyShared(s, "episode");
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

export async function fetchOne(supabase: any, podcast: any, opts: { episodeCap?: number; fetchTimeoutMs?: number; upsertDuplicates?: boolean } = {}) {
  const episodeCap = Math.max(1, Math.min(500, opts.episodeCap ?? 30));
  const fetchTimeoutMs = Math.max(3_000, Math.min(20_000, opts.fetchTimeoutMs ?? 20_000));
  const upsertDuplicates = opts.upsertDuplicates !== false;
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
    const headers: Record<string, string> = { "User-Agent": "PodiverzumBot/1.0 (+https://podiverzum.hu)" };
    if (podcast.last_etag) headers["If-None-Match"] = podcast.last_etag;
    if (podcast.last_modified) headers["If-Modified-Since"] = podcast.last_modified;

    const res = await fetch(podcast.rss_url, {
      headers,
      redirect: "follow",
      signal: AbortSignal.timeout(fetchTimeoutMs),
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

  // Extract channel image + new-feed-url + language from feed head
  let channelImage = "";
  let newFeedUrl = "";
  let channelLanguage = "";
  try {
    const head = xml.split(/<item\b|<entry\b/i)[0] || "";
    const itunesM = head.match(/<itunes:image\b[^>]*href\s*=\s*["']([^"']+)["']/i);
    const urlM = head.match(/<image\b[\s\S]*?<url>([\s\S]*?)<\/url>/i);
    channelImage = (itunesM?.[1] || urlM?.[1] || "").trim();
    const nfu = head.match(/<itunes:new-feed-url>([\s\S]*?)<\/itunes:new-feed-url>/i);
    if (nfu?.[1]) newFeedUrl = nfu[1].trim();
    const langM = head.match(/<language>([\s\S]*?)<\/language>/i);
    if (langM?.[1]) {
      // Strip CDATA wrapper, comments, whitespace; keep only ISO-639 prefix (e.g. "hu", "en-us").
      const raw = langM[1]
        .replace(/<!\[CDATA\[/gi, "")
        .replace(/\]\]>/g, "")
        .replace(/<!--[\s\S]*?-->/g, "")
        .trim()
        .toLowerCase();
      const m = raw.match(/^([a-z]{2,3})(?:[-_]([a-z0-9]{2,4}))?/);
      if (m) channelLanguage = m[2] ? `${m[1]}-${m[2]}` : m[1];
    }
  } catch { /* noop */ }

  if (newFeedUrl && newFeedUrl !== podcast.rss_url) {
    await recordRssUrlChange(supabase, podcast.id, podcast.rss_url, newFeedUrl, "itunes_new_feed_url");
  }

  // Quick non-EN gate: if the feed's <language> declares a clearly non-English
  // language, set podcasts.language so EN-only public surfaces hide it.
  // Episodes are still upserted (db consistency); AI guard handles lying feeds.
  if (channelLanguage && !channelLanguage.startsWith("en") && channelLanguage !== "mul" && channelLanguage !== "und") {
    const currentLang = String(podcast.language || "").toLowerCase();
    if (!currentLang || currentLang.startsWith("en") || currentLang !== channelLanguage) {
      try { await supabase.from("podcasts").update({ language: channelLanguage }).eq("id", podcast.id); } catch { /* noop */ }
      podcast.language = channelLanguage;
    }
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

  // Prefetch placeholder merge: for podcasts where a `bible-prefetch`-style edge
  // pre-creates "{N}-nap" rows a few hours before the RSS drops, we merge the
  // real audio into that placeholder row (keeping its id + slug) so the URL Google
  // just indexed stays stable. Match by day-number prefix in the incoming title.
  const dayRe = /^\s*(\d{1,3})\.\s*nap\b/i;
  const { data: placeholderRows } = await supabase
    .from("episodes")
    .select("id, slug, guid")
    .eq("podcast_id", podcast.id)
    .eq("is_prefetch_placeholder", true)
    .is("audio_url", null);
  const placeholderByDay = new Map<number, { id: string; slug: string }>();
  for (const r of (placeholderRows || []) as any[]) {
    const m = String(r.slug || "").match(/^(\d{1,3})-nap/);
    if (m) placeholderByDay.set(parseInt(m[1], 10), { id: r.id, slug: r.slug });
  }
  const consumedPlaceholderIds = new Set<string>();

  // Day-numbered series ("217. nap") must never end up with two URLs for the same
  // day: an already-merged placeholder plus a fresh RSS insert cannibalised each
  // other in Google. Index every existing day number so a second pass updates the
  // canonical row instead of inserting a twin.
  const { data: dayRows } = await supabase
    .from("episodes")
    .select("id, slug, title")
    .eq("podcast_id", podcast.id)
    .like("slug", "%-nap%");
  const existingByDay = new Map<number, { id: string; slug: string }>();
  for (const r of (dayRows || []) as any[]) {
    const m = String(r.slug || "").match(/^(\d{1,3})-nap/);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    const prev = existingByDay.get(n);
    // Prefer the shortest slug ("217-nap") — that is the URL Google already indexed.
    if (!prev || String(r.slug).length < prev.slug.length) existingByDay.set(n, { id: r.id, slug: r.slug });
  }
  const dayUpdateIds = new Set<string>();


  let newCount = 0, duplicates = 0;
  const rowsToUpsert: any[] = [];
  const placeholderUpdates: Array<{ id: string; patch: any }> = [];
  for (const { it, slug } of candidates) {
    const isDup =
      (it.guid && existingGuids.has(it.guid)) ||
      (it.link && existingLinks.has(it.link)) ||
      (it.published && existingTitlePub.has(`${it.title}|${it.published}`));

    // Check placeholder match by day number BEFORE dedupe (placeholder guid intentionally
    // differs from the real RSS guid, so the guid-based dedupe would miss it).
    const dayMatch = it.title.match(dayRe);
    const dayNum = dayMatch ? parseInt(dayMatch[1], 10) : null;
    const ph = dayNum != null ? placeholderByDay.get(dayNum) : undefined;
    if (ph && !consumedPlaceholderIds.has(ph.id)) {
      consumedPlaceholderIds.add(ph.id);
      newCount++;
      const patch: any = {
        title: it.title,
        description: (it.description || "").slice(0, 12000),
        published_at: it.published,
        audio_url: it.audio_url || null,
        episode_url: it.link || null,
        image_url: it.image || null,
        guid: it.guid || null,
        is_prefetch_placeholder: false,
        display_title: null, // clear the "ma este 01:00-kor" preview title
      };
      if (it.duration_seconds && it.duration_seconds > 0) patch.duration_seconds = it.duration_seconds;
      placeholderUpdates.push({ id: ph.id, patch });
      continue; // do NOT insert a duplicate row for this episode
    }

    // Same day number already exists (e.g. an earlier merged placeholder): refresh that
    // row instead of creating a duplicate URL for the same reading day.
    if (dayNum != null) {
      const twin = existingByDay.get(dayNum);
      if (twin && !dayUpdateIds.has(twin.id)) {
        dayUpdateIds.add(twin.id);
        duplicates++;
        const patch: any = {
          title: it.title,
          description: (it.description || "").slice(0, 12000),
          published_at: it.published,
          episode_url: it.link || null,
          guid: it.guid || null,
          is_prefetch_placeholder: false,
        };
        if (it.audio_url) patch.audio_url = it.audio_url;
        if (it.image) patch.image_url = it.image;
        if (it.duration_seconds && it.duration_seconds > 0) patch.duration_seconds = it.duration_seconds;
        placeholderUpdates.push({ id: twin.id, patch });
        continue;
      }
    }

    if (isDup) duplicates++; else newCount++;
    if (isDup && !upsertDuplicates) continue;


    const row: any = {
      podcast_id: podcast.id,
      title: it.title,
      slug,
      description: (it.description || "").slice(0, 12000),
      published_at: it.published,
      audio_url: it.audio_url || null,
      episode_url: it.link || null,
      image_url: it.image || null,
      guid: it.guid || null,
    };
    // Only write duration when the feed actually provides itunes:duration —
    // otherwise an upsert would wipe out values we already backfilled from
    // Spotify / YouTube / transcript sources.
    if (it.duration_seconds && it.duration_seconds > 0) {
      row.duration_seconds = it.duration_seconds;
    }
    rowsToUpsert.push(row);
  }

  // Apply placeholder merges (small N, one UPDATE per row is fine).
  const mergedSlugs: string[] = [];
  for (const { id, patch } of placeholderUpdates) {
    const { error: upErr } = await supabase.from("episodes").update(patch).eq("id", id);
    if (upErr) {
      console.warn(`[fetch-one] placeholder merge failed for ${id}: ${upErr.message}`);
    } else {
      const ph = [...placeholderByDay.values()].find((v) => v.id === id);
      if (ph?.slug) mergedSlugs.push(ph.slug);
    }
  }

  // When a prefetch placeholder just received its real audio, immediately ping
  // Google Indexing + IndexNow so the now-substantive URL gets re-crawled fast.
  if (mergedSlugs.length && podcast.slug) {
    const site = "https://podiverzum.hu";
    const urls = mergedSlugs.map((s) => `${site}/podcast/${podcast.slug}/${s}`);
    try {
      await Promise.allSettled([
        supabase.functions.invoke("google-indexing-submit", { body: { urls } }),
        supabase.functions.invoke("indexnow-submit", { body: { urls } }),
      ]);
      console.log(`[fetch-one] indexing pinged for merged placeholders: ${urls.join(", ")}`);
    } catch (e) {
      console.warn(`[fetch-one] indexing ping failed: ${(e as Error).message}`);
    }
  }


  if (rowsToUpsert.length) {
    // Dedupe within this batch by (podcast_id, slug) — feeds occasionally
    // emit duplicate slugs which trigger Postgres "ON CONFLICT cannot affect row a second time".
    const seenSlugs = new Set<string>();
    const deduped: any[] = [];
    for (const r of rowsToUpsert) {
      if (seenSlugs.has(r.slug)) continue;
      seenSlugs.add(r.slug);
      deduped.push(r);
    }
    // Chunk upserts to avoid statement_timeout on large feeds (1000+ episodes).
    const CHUNK = 200;
    for (let i = 0; i < deduped.length; i += CHUNK) {
      const slice = deduped.slice(i, i + CHUNK);
      const { error: upErr } = await supabase.from("episodes").upsert(slice, { onConflict: "podcast_id,slug" });
      if (upErr) {
        await markFailure(supabase, podcast, `upsert: ${upErr.message}`, false);
        return { ok: false, error: upErr.message, new: 0, duplicates: 0, items: items.length };
      }
    }

    // Fire per-subscriber email notifications for newly-added episodes.
    // Only runs when the podcast has opt-in flag `notify_new_episodes = true`
    // and only for slugs that were NOT previously in the DB (true new episodes).
    if (podcast?.notify_new_episodes && newCount > 0) {
      try {
        const newSlugs = candidates
          .filter(({ it, slug }) => {
            const dup =
              (it.guid && existingGuids.has(it.guid)) ||
              (it.link && existingLinks.has(it.link)) ||
              (it.published && existingTitlePub.has(`${it.title}|${it.published}`));
            return !dup;
          })
          .map((c) => c.slug);
        if (newSlugs.length > 0) {
          await notifyPodcastSubscribers(supabase, podcast, newSlugs);
          // Fire-and-forget instant Google discovery pipeline for whitelisted
          // podcasts (Fábry Kornél etc.): the goal is to rank #1 on
          // "<host> <N>. nap"-style queries within minutes of the drop, not
          // wait for the daily indexing cron. Sends the episode URLs to
          // Google Indexing API + IndexNow (Bing/Yandex) and refreshes the
          // episodes sitemap so news-sitemap.xml picks them up too.
          try {
            await instantIndexEpisodes(podcast, newSlugs);
          } catch (e) {
            console.error("instantIndexEpisodes failed", (e as Error)?.message);
          }
        }
      } catch (e) {
        console.error("notifyPodcastSubscribers failed", (e as Error)?.message);
      }
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
    next_fetch_at: null,
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

// ---------------------------------------------------------------------------
// Notify email subscribers about newly-added episodes for a podcast.
// Invoked from the main fetch flow only when `podcast.notify_new_episodes = true`.
// Fires per-recipient sends via the shared send-transactional-email edge fn,
// which enqueues to pgmq for retry-safe delivery. Idempotent per (episode, email).
// ---------------------------------------------------------------------------
async function notifyPodcastSubscribers(supabase: any, podcast: any, newSlugs: string[]) {
  if (!newSlugs.length) return;

  // Fetch the newly-added episodes (id, slug, title, description, published_at)
  const { data: newEps } = await supabase
    .from("episodes")
    .select("id, slug, title, description, published_at")
    .eq("podcast_id", podcast.id)
    .in("slug", newSlugs);
  if (!newEps || newEps.length === 0) return;

  // Only notify about episodes published within the last 14 days — protects
  // against backfills / late-added archive items spamming subscribers.
  const cutoffMs = Date.now() - 14 * 86400_000;
  const freshEps = newEps.filter((e: any) => {
    if (!e.published_at) return true;
    const t = Date.parse(e.published_at);
    return Number.isFinite(t) && t >= cutoffMs;
  });
  if (freshEps.length === 0) return;

  // Load active subscribers
  const { data: subs } = await supabase
    .from("podcast_email_subscriptions")
    .select("email, unsubscribe_token")
    .eq("podcast_id", podcast.id)
    .is("unsubscribed_at", null);
  if (!subs || subs.length === 0) return;

  const podcastTitle = podcast.display_title || podcast.title || "";
  const podcastSlug = podcast.slug;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  for (const ep of freshEps) {
    const episodeUrl = `https://podiverzum.hu/podcast/${podcastSlug}/${ep.slug}`;
    const publishedAt = ep.published_at ? String(ep.published_at).slice(0, 10) : "";

    for (const sub of subs) {
      const unsubscribeUrl = `https://podiverzum.hu/leiratkozas-podcast?token=${encodeURIComponent(sub.unsubscribe_token)}`;
      const idempotencyKey = `new-ep-${ep.id}-${sub.unsubscribe_token.slice(0, 12)}`;
      try {
        await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
          body: JSON.stringify({
            templateName: "new-episode-notification",
            recipientEmail: sub.email,
            idempotencyKey,
            templateData: {
              podcastTitle,
              episodeTitle: ep.title,
              episodeUrl,
              episodeDescription: ep.description || "",
              publishedAt,
              unsubscribeUrl,
            },
          }),
        });
      } catch (e) {
        console.error("send-transactional-email invoke failed", (e as Error)?.message);
      }
    }
  }

  // Update last_sent_at for observability
  try {
    await supabase
      .from("podcast_email_subscriptions")
      .update({ last_sent_at: new Date().toISOString() })
      .eq("podcast_id", podcast.id)
      .is("unsubscribed_at", null);
  } catch { /* noop */ }
}

// ---------------------------------------------------------------------------
// Instant indexing pipeline for whitelisted podcasts.
// Fires the moment new episodes are ingested from RSS — no waiting for the
// daily google-indexing cron. Used for daily-cadence series like the Fábry
// Kornél "Biblia egy év alatt" podcast where being #1 on Google within an
// hour of the drop is the whole win.
// ---------------------------------------------------------------------------
async function instantIndexEpisodes(podcast: any, newSlugs: string[]) {
  if (!newSlugs.length) return;
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return;

  const urls = newSlugs.map(
    (slug) => `https://podiverzum.hu/podcast/${podcast.slug}/${slug}`,
  );
  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
  };

  // 1) Google Indexing API — direct URL_UPDATED ping. Requires the
  //    GOOGLE_INDEXING_SA_JSON secret; the function no-ops without it.
  //    Capped at 200/day per property (Google quota); we send ≤ 5 URLs per
  //    drop, so the daily budget is never a concern from this path.
  const googlePromise = fetch(`${supabaseUrl}/functions/v1/google-indexing-submit`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ urls: urls.slice(0, 10) }),
  }).catch((e) => console.error("google-indexing-submit failed", (e as Error)?.message));

  // 2) IndexNow — Bing / Yandex / DuckDuckGo. Free, unmetered.
  const indexnowPromise = fetch(`${supabaseUrl}/functions/v1/indexnow-submit`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ urls }),
  }).catch((e) => console.error("indexnow-submit failed", (e as Error)?.message));

  // 3) Refresh the episodes sitemap so news-sitemap.xml sees the new URLs
  //    on the next crawler visit (Google News favours sitemap-listed items).
  const sitemapPromise = fetch(
    `${supabaseUrl}/functions/v1/refresh-sitemap?type=episodes`,
    { method: "POST", headers: authHeaders },
  ).catch((e) => console.error("refresh-sitemap failed", (e as Error)?.message));

  await Promise.allSettled([googlePromise, indexnowPromise, sitemapPromise]);
  console.log(
    `instantIndexEpisodes: pinged ${urls.length} URL(s) for podcast=${podcast.slug}`,
  );
}
