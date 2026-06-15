// Public endpoint: anyone can submit a podcast RSS feed to be indexed.
// Validates URL, fetches & sniffs the feed, dedupes against existing podcasts
// and discovery_queue, then inserts a pending row. The existing rss-hunter
// cron processes it automatically.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BodySchema = z.object({
  rss_url: z.string().trim().url().max(2000),
  submitter_email: z.string().trim().email().max(255).optional().or(z.literal("")),
  submitter_note: z.string().trim().max(1000).optional().or(z.literal("")),
});

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function jr(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function pick(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  if (!m) return null;
  return m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() || null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jr({ error: "method_not_allowed" }, 405);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jr({ error: "invalid_json" }, 400);
  }
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return jr({ error: "invalid_input", details: parsed.error.flatten().fieldErrors }, 400);
  }

  let rssUrl = parsed.data.rss_url;
  try {
    const u = new URL(rssUrl);
    if (!/^https?:$/.test(u.protocol)) return jr({ error: "invalid_protocol" }, 400);
    rssUrl = u.toString();
  } catch {
    return jr({ error: "invalid_url" }, 400);
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);

  // Dedup: already in podcasts?
  const { data: existingPodcast } = await sb
    .from("podcasts")
    .select("id, slug, title")
    .eq("rss_url", rssUrl)
    .maybeSingle();
  if (existingPodcast) {
    return jr({
      status: "already_indexed",
      message: "Ez a podcast már szerepel a Podiverzumon.",
      podcast: existingPodcast,
    });
  }

  // Dedup: already in queue?
  const { data: existingQueue } = await sb
    .from("discovery_queue")
    .select("id, status, import_status, imported_podcast_id")
    .eq("rss_url", rssUrl)
    .maybeSingle();
  if (existingQueue) {
    return jr({
      status: "already_submitted",
      message: "Ez a feed már sorban áll feldolgozásra.",
      queue: existingQueue,
    });
  }

  // Fetch feed (cap size, short timeout) and validate XML/RSS shape
  let feedText = "";
  try {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 8000);
    const res = await fetch(rssUrl, {
      signal: ac.signal,
      headers: { "User-Agent": "PodiverzumSubmitBot/1.0 (+https://podiverzum.hu)" },
      redirect: "follow",
    });
    clearTimeout(t);
    if (!res.ok) return jr({ error: "feed_unreachable", status: res.status }, 400);
    const buf = new Uint8Array(await res.arrayBuffer());
    const slice = buf.slice(0, 200_000);
    feedText = new TextDecoder("utf-8", { fatal: false }).decode(slice);
  } catch (e) {
    return jr({ error: "feed_fetch_failed", message: String((e as Error).message ?? e) }, 400);
  }

  const looksLikeRss = /<rss[\s>]|<feed[\s>]/i.test(feedText) && /<(channel|entry|item)[\s>]/i.test(feedText);
  if (!looksLikeRss) {
    return jr({ error: "not_a_podcast_feed", message: "A megadott URL nem tűnik érvényes podcast RSS feednek." }, 400);
  }

  const title = pick(feedText, "title") ?? "Beküldött podcast";
  const description = pick(feedText, "description");
  const language = pick(feedText, "language");
  const author =
    pick(feedText, "itunes:author") ?? pick(feedText, "author");
  const imageMatch = feedText.match(/<itunes:image[^>]*href=["']([^"']+)["']/i);
  const imageUrl = imageMatch ? imageMatch[1] : pick(feedText, "url");
  const linkMatch = feedText.match(/<link[^>]*>([^<]+)<\/link>/i);
  const websiteUrl = linkMatch ? linkMatch[1].trim() : null;

  const submitter = (parsed.data.submitter_email || "").trim() || null;
  const note = (parsed.data.submitter_note || "").trim() || null;

  const { data: inserted, error: insertErr } = await sb
    .from("discovery_queue")
    .insert({
      title: title.slice(0, 500),
      rss_url: rssUrl,
      website_url: websiteUrl?.slice(0, 1000) ?? null,
      image_url: imageUrl?.slice(0, 2000) ?? null,
      description: description?.slice(0, 4000) ?? null,
      language: language?.slice(0, 16) ?? null,
      author: author?.slice(0, 255) ?? null,
      status: "pending",
      source: "user_submission",
      candidate_rank: 5,
      rank_reason: {
        reason: "user_submission",
        submitter_email: submitter,
        submitter_note: note,
        submitted_at: new Date().toISOString(),
        ua: req.headers.get("user-agent")?.slice(0, 200) ?? null,
      },
    })
    .select("id")
    .single();

  if (insertErr) {
    return jr({ error: "insert_failed", message: insertErr.message }, 500);
  }

  return jr({
    status: "submitted",
    message: "Köszönjük! A feedet hamarosan feldolgozzuk.",
    id: inserted.id,
    detected: { title, language, author },
  });
});
