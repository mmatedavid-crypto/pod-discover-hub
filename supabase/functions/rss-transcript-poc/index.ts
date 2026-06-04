// RSS transcript PoC: discovers Podcasting 2.0 <podcast:transcript>
// tags in existing HU podcast RSS feeds. No database writes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const UA = "Podiverzum/1.0 rss-transcript-poc (+https://podiverzum.hu)";

type PodcastRow = { id: string; title: string | null; rss_url: string | null };
type EpisodeRow = { id: string; title: string | null; display_title?: string | null; guid: string | null; audio_url: string | null };
type TranscriptLink = { url: string; type: string | null; language: string | null; rel: string | null };

function decodeXml(s: string): string {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function textOf(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? decodeXml(m[1]).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : null;
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return m ? decodeXml(m[1]).trim() : null;
}

function normalizeTitle(s: string | null | undefined): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTranscript(text: string, type: string | null): string {
  let out = String(text || "");
  if (/json/i.test(type || "")) {
    try {
      const j = JSON.parse(out);
      const segs = Array.isArray(j) ? j : (j.segments || j.transcript || j.content || []);
      if (Array.isArray(segs)) out = segs.map((x: any) => x?.text || x?.body || x?.content || "").join(" ");
      else if (typeof j.text === "string") out = j.text;
    } catch { /* keep raw */ }
  }
  return out
    .replace(/^WEBVTT[\s\S]*?(?=\n\n|$)/i, "")
    .replace(/^\d+\s*$/gm, "")
    .replace(/\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s+-->\s+\d{1,2}:\d{2}:\d{2}[,.]\d{3}.*$/gm, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string, timeoutMs = 12_000, maxChars = 2_000_000): Promise<{ status: number; text: string; contentType: string | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/rss+xml,application/xml,text/xml,text/vtt,application/json,text/plain,*/*" }, signal: ctrl.signal, redirect: "follow" });
    const text = (await r.text()).slice(0, maxChars);
    return { status: r.status, text, contentType: r.headers.get("content-type") };
  } finally {
    clearTimeout(timer);
  }
}

function parseItems(feedXml: string): Array<{ title: string | null; guid: string | null; enclosure: string | null; transcripts: TranscriptLink[] }> {
  const items = feedXml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
  return items.map((item) => {
    const enclosureTag = item.match(/<enclosure\b[^>]*>/i)?.[0] || "";
    const transcriptTags = item.match(/<(?:podcast:)?transcript\b[^>]*(?:\/>|>[\s\S]*?<\/(?:podcast:)?transcript>)/gi) || [];
    const transcripts = transcriptTags
      .map((tag) => ({
        url: attr(tag, "url") || attr(tag, "href") || "",
        type: attr(tag, "type"),
        language: attr(tag, "language") || attr(tag, "lang"),
        rel: attr(tag, "rel"),
      }))
      .filter((t) => /^https?:\/\//i.test(t.url));
    return {
      title: textOf(item, "title"),
      guid: textOf(item, "guid"),
      enclosure: attr(enclosureTag, "url"),
      transcripts,
    };
  });
}

function matchEpisode(item: ReturnType<typeof parseItems>[number], episodes: EpisodeRow[]): EpisodeRow | null {
  if (item.guid) {
    const byGuid = episodes.find((e) => e.guid && e.guid === item.guid);
    if (byGuid) return byGuid;
  }
  if (item.enclosure) {
    const byAudio = episodes.find((e) => e.audio_url && e.audio_url === item.enclosure);
    if (byAudio) return byAudio;
  }
  const nt = normalizeTitle(item.title);
  if (nt) return episodes.find((e) => normalizeTitle(e.title) === nt || normalizeTitle(e.display_title) === nt) || null;
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(50, Number(body.limit || 20)));
    const fetchSamples = body.fetch_samples !== false;
    const preferred = String(body.preferred || "telex|partiz|444|portfolio|anchor|megaphone");
    const preferredRe = new RegExp(preferred, "i");
    const podcastIds = Array.isArray(body.podcast_ids) ? body.podcast_ids.map(String).filter(Boolean).slice(0, limit) : [];

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    let q = admin
      .from("podcasts")
      .select("id,title,rss_url")
      .ilike("language", "hu%")
      .not("rss_url", "is", null)
      .limit(Math.max(limit * 8, 80));
    if (podcastIds.length) q = q.in("id", podcastIds);
    const { data: pods, error: podErr } = await q;
    if (podErr) throw podErr;

    const candidates = ((pods || []) as PodcastRow[])
      .sort((a, b) => Number(preferredRe.test(`${b.title} ${b.rss_url}`)) - Number(preferredRe.test(`${a.title} ${a.rss_url}`)))
      .slice(0, limit);

    const results: any[] = [];
    for (const pod of candidates) {
      const feed = await fetchText(pod.rss_url!);
      if (feed.status < 200 || feed.status >= 300) {
        results.push({ podcast_id: pod.id, podcast: pod.title, rss_url: pod.rss_url, feed_status: feed.status, error: "feed_fetch_failed" });
        continue;
      }
      const items = parseItems(feed.text);
      const withLinks = items.filter((it) => it.transcripts.length > 0);
      const { data: eps } = await admin
        .from("episodes")
        .select("id,title,display_title,guid,audio_url")
        .eq("podcast_id", pod.id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(1200);
      const episodes = (eps || []) as EpisodeRow[];

      const sampleEpisodes: any[] = [];
      for (const item of withLinks.slice(0, 5)) {
        const link = item.transcripts[0];
        const matched = matchEpisode(item, episodes);
        let transcriptStatus: number | null = null;
        let transcriptChars = 0;
        let sample = "";
        if (fetchSamples && sampleEpisodes.length < 3) {
          try {
            const tr = await fetchText(link.url, 15_000);
            transcriptStatus = tr.status;
            const cleaned = stripTranscript(tr.text, link.type || tr.contentType);
            transcriptChars = cleaned.length;
            sample = cleaned.slice(0, 300);
          } catch (e) {
            sample = `fetch_error:${e instanceof Error ? e.message : String(e)}`;
          }
        }
        sampleEpisodes.push({
          episode_id: matched?.id || null,
          item_title: item.title,
          matched: !!matched,
          transcript_url: link.url,
          type: link.type,
          language: link.language,
          rel: link.rel,
          transcript_status: transcriptStatus,
          transcript_chars: transcriptChars,
          sample,
        });
      }

      results.push({
        podcast_id: pod.id,
        podcast: pod.title,
        rss_url: pod.rss_url,
        feed_status: feed.status,
        feed_items: items.length,
        items_with_transcript_tag: withLinks.length,
        matched_existing_episodes: withLinks.map((it) => matchEpisode(it, episodes)).filter(Boolean).length,
        sample_episodes: sampleEpisodes,
      });
    }

    const totalItems = results.reduce((s, r) => s + Number(r.feed_items || 0), 0);
    const totalTagged = results.reduce((s, r) => s + Number(r.items_with_transcript_tag || 0), 0);
    const totalMatched = results.reduce((s, r) => s + Number(r.matched_existing_episodes || 0), 0);
    return json({
      ok: true,
      mode: "rss_transcript_poc_no_db_writes",
      summary: {
        podcasts_checked: results.length,
        feed_items_scanned: totalItems,
        transcript_tagged_items: totalTagged,
        matched_existing_episodes: totalMatched,
        hit_rate_by_item: totalItems ? Number((totalTagged / totalItems).toFixed(4)) : 0,
      },
      results,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("rss-transcript-poc error", msg);
    return json({ ok: false, error: msg }, 500);
  }
});