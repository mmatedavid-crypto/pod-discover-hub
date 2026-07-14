// Bible-prefetch: create tomorrow's "N. nap" placeholder episode a few hours before
// the RSS drops at 01:00 CEST. This lets Google index our URL alongside zarandok.ma
// instead of 6-24 hours later. When fetch-rss later runs, it merges the real audio
// into this same row (see supabase/functions/_shared/fetch-one.ts) so the URL is stable.
//
// Modes:
//   POST {}                → run once for the next day
//   POST { dry_run: true } → detect only
//   POST { day: 197 }      → force a specific day number

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE = "https://podiverzum.hu";
const PODCAST_ID = "b9b62713-d314-4da2-a69a-0b0dd2749df3";
const PODCAST_SLUG = "biblia-egy-ev-alatt-podcast-fabry-kornel-puspok-atyaval";
const HOST_NAME = "Fábry Kornél";
const SERIES = "Biblia egy év alatt";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const dryRun = body?.dry_run === true;
  const forcedDay = Number.isFinite(body?.day) ? Math.floor(body.day) : null;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    // 1) Find the highest existing day number for this podcast.
    const { data: recent } = await admin
      .from("episodes")
      .select("title, slug, guid, is_prefetch_placeholder")
      .eq("podcast_id", PODCAST_ID)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(30);

    const dayRe = /^\s*(\d{1,3})\.\s*nap\b/i;
    const highestDay = (recent || []).reduce((max, r: any) => {
      const m = String(r.title || "").match(dayRe);
      return m ? Math.max(max, parseInt(m[1], 10)) : max;
    }, 0);
    const nextDay = forcedDay ?? highestDay + 1;
    if (!nextDay || nextDay < 1 || nextDay > 365) {
      return json({ ok: false, error: "invalid_next_day", highestDay, nextDay }, 400);
    }

    // 2) Skip if already exists (real or placeholder).
    const dayPrefix = `${nextDay}-nap`;
    const { data: existing } = await admin
      .from("episodes")
      .select("id, slug, is_prefetch_placeholder, audio_url")
      .eq("podcast_id", PODCAST_ID)
      .ilike("slug", `${dayPrefix}%`)
      .limit(5);
    if ((existing || []).length > 0) {
      return json({
        ok: true, skipped: true, reason: "already_exists", nextDay,
        existing: (existing || []).map((r: any) => ({ slug: r.slug, is_placeholder: r.is_prefetch_placeholder, has_audio: !!r.audio_url })),
      });
    }

    // 3) Compose placeholder row.
    const title = `${nextDay}. nap: Fábry Kornél napi biblia elmélkedése`;
    const displayTitle = `${nextDay}. nap – ma este 01:00-kor érkezik`;
    // AI summary that will feed the Google snippet. Action-oriented, tells searcher
    // exactly when the audio arrives + that they can bookmark this page now.
    const aiSummary =
      `▶ ${HOST_NAME} ${nextDay}. napi elmélkedése a ${SERIES} podcastból ma este 01:00-kor érkezik. ` +
      `Nyisd meg most a Podiverzumon, és hallgasd meg egyetlen kattintással, amint elindul.`;

    const now = new Date().toISOString();
    const row = {
      podcast_id: PODCAST_ID,
      title,
      display_title: displayTitle,
      slug: dayPrefix,
      description: aiSummary,
      summary: aiSummary,
      ai_summary: aiSummary,
      ai_summary_source: "prefetch_placeholder",
      seo_description: aiSummary.slice(0, 160),
      published_at: now,
      audio_url: null,
      guid: `prefetch-bible-${nextDay}`,
      is_prefetch_placeholder: true,
      detected_language: "hu",
      clean_text_status: "skipped",
      topic_extraction_status: "skipped",
    };

    if (dryRun) return json({ ok: true, dry_run: true, nextDay, row });

    const { data: inserted, error: insErr } = await admin
      .from("episodes")
      .insert(row)
      .select("id, slug")
      .single();
    if (insErr) throw insErr;

    // 4) Fire instant-index pings (Google + IndexNow + sitemap refresh).
    const episodeUrl = `${SITE}/podcast/${PODCAST_SLUG}/${inserted.slug}`;
    const pings = await Promise.allSettled([
      admin.functions.invoke("google-indexing-submit", { body: { urls: [episodeUrl] } }),
      admin.functions.invoke("indexnow-submit", { body: { urls: [episodeUrl] } }),
      admin.functions.invoke("refresh-sitemap", { body: { type: "episodes" } }),
    ]);
    const pingErrors = pings
      .map((r, i) => r.status === "rejected" ? { i, err: String((r as PromiseRejectedResult).reason).slice(0, 200) } : null)
      .filter(Boolean);

    return json({
      ok: true, nextDay, episode_id: inserted.id, episode_url: episodeUrl,
      pinged: true, ping_errors: pingErrors,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
