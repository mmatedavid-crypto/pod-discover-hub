// Zarandok.ma "Biblia egy év alatt" fast-index poller.
//
// A napi biblia epizódot minden éjjel 01:00 CEST-kor publikálják egyszerre a
// zarandok.ma WordPress oldalon, a YouTube-on és a Spotify Anchor RSS-en.
// A Google a WP posztot IndexNow + sitemap lastmod miatt szinte azonnal
// indexeli, míg a mi RSS-hunterünk csak óránként vagy ritkábban fut, így 6–24
// óra hátrányban vagyunk. Ez a poller egy szűk időablakban percenként megnézi
// a WP REST API-t; ha új biblia poszt van, azonnal újralövi a podcast RSS-t,
// és amint a mi episode row-nk megvan, bepingeli a Google Indexing API-t +
// IndexNow-t.
//
// Modes:
//   POST {}                       → run once
//   POST { dry_run: true }        → detect only, no writes / pings
//   POST { force_rss: true }      → mindenképp fetch-rss az RSS-t

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SITE = "https://podiverzum.hu";
const PODCAST_ID = "b9b62713-d314-4da2-a69a-0b0dd2749df3";
const PODCAST_SLUG = "biblia-egy-ev-alatt-podcast-fabry-kornel-puspok-atyaval";
// zarandok.ma WordPress category ID for the daily bible series.
const WP_CATEGORY_ID = 7417;
const WP_URL =
  `https://zarandok.ma/wp-json/wp/v2/posts?_fields=id,slug,date_gmt,modified_gmt,title,link&categories=${WP_CATEGORY_ID}&per_page=1&orderby=date&order=desc`;
const BIBLE_SLUG_RE = /^\d+-nap-/;
const STATE_KEY = "zarandok_biblia_poll_state";

type PollState = {
  last_wp_post_id?: number;
  last_wp_date_gmt?: string;
  last_pinged_episode_id?: string;
  last_pinged_episode_slug?: string;
  last_pinged_at?: string;
  runs?: Array<{
    at: string;
    wp_new: boolean;
    rss_refetched: boolean;
    episode_new: boolean;
    pinged: boolean;
    episode_slug?: string;
    error?: string;
    detail?: string;
  }>;
  errors?: Array<{ at: string; error: string }>;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const dryRun = body?.dry_run === true;
  const forceRss = body?.force_rss === true;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const run: NonNullable<PollState["runs"]>[number] = {
    at: new Date().toISOString(),
    wp_new: false,
    rss_refetched: false,
    episode_new: false,
    pinged: false,
  };

  try {
    // 1) Load state
    const { data: stateRow } = await admin
      .from("app_settings").select("value").eq("key", STATE_KEY).maybeSingle();
    const state: PollState = (stateRow?.value as PollState) || {};

    // 2) Poll WP REST API
    let wpPost: { id: number; slug: string; date_gmt: string; link: string; title?: { rendered?: string } } | null = null;
    try {
      const r = await fetch(WP_URL, { headers: { "User-Agent": "Podiverzum-Poller/1.0" } });
      if (!r.ok) throw new Error(`wp_${r.status}`);
      const arr = await r.json();
      const p = Array.isArray(arr) ? arr[0] : null;
      if (p && BIBLE_SLUG_RE.test(p.slug)) wpPost = p;
    } catch (e) {
      run.error = `wp_fetch: ${(e as Error).message}`;
    }

    if (wpPost && (state.last_wp_post_id ?? 0) < wpPost.id) {
      run.wp_new = true;
      run.detail = `WP #${wpPost.id} ${wpPost.slug}`;
    }

    // 3) Ha új WP poszt VAGY force → fetch-rss re-run
    const shouldRss = run.wp_new || forceRss;
    if (shouldRss && !dryRun) {
      try {
        const { error: rssErr } = await admin.functions.invoke("fetch-rss", {
          body: { podcast_id: PODCAST_ID },
        });
        if (rssErr) throw rssErr;
        run.rss_refetched = true;
      } catch (e) {
        run.error = `fetch_rss: ${(e as Error).message}`;
      }
    }

    // 4) Nézzük a legfrissebb episode row-t a Fábry Kornél podcastnál.
    const { data: latestEp } = await admin
      .from("episodes")
      .select("id, slug, title, published_at")
      .eq("podcast_id", PODCAST_ID)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();

    let pinged = false;
    let episodeUrl: string | null = null;
    if (latestEp && latestEp.id !== state.last_pinged_episode_id && BIBLE_SLUG_RE.test(latestEp.slug || "")) {
      run.episode_new = true;
      episodeUrl = `${SITE}/podcast/${PODCAST_SLUG}/${latestEp.slug}`;
      if (!dryRun) {
        // Ping Google Indexing API + IndexNow párhuzamosan
        const results = await Promise.allSettled([
          admin.functions.invoke("google-indexing-submit", { body: { urls: [episodeUrl] } }),
          admin.functions.invoke("indexnow-submit", { body: { urls: [episodeUrl] } }),
        ]);
        const firstErr = results.find((r) => r.status === "rejected");
        if (firstErr && firstErr.status === "rejected") {
          run.error = `ping: ${String((firstErr as PromiseRejectedResult).reason).slice(0, 200)}`;
        }
        pinged = true;
        run.pinged = true;
        run.episode_slug = latestEp.slug;
      }
    }

    // 5) Persist state
    if (!dryRun) {
      const nextState: PollState = {
        ...state,
        last_wp_post_id: wpPost ? Math.max(state.last_wp_post_id ?? 0, wpPost.id) : state.last_wp_post_id,
        last_wp_date_gmt: wpPost?.date_gmt ?? state.last_wp_date_gmt,
        last_pinged_episode_id: pinged ? latestEp!.id : state.last_pinged_episode_id,
        last_pinged_episode_slug: pinged ? latestEp!.slug : state.last_pinged_episode_slug,
        last_pinged_at: pinged ? new Date().toISOString() : state.last_pinged_at,
        runs: [...(state.runs || []).slice(-49), run],
        errors: run.error
          ? [...(state.errors || []).slice(-19), { at: run.at, error: run.error }]
          : state.errors,
      };
      await admin.from("app_settings").upsert(
        { key: STATE_KEY, value: nextState },
        { onConflict: "key" },
      );
    }

    return json({
      ok: true,
      dry_run: dryRun,
      wp_post: wpPost ? { id: wpPost.id, slug: wpPost.slug, date_gmt: wpPost.date_gmt } : null,
      wp_new: run.wp_new,
      rss_refetched: run.rss_refetched,
      latest_episode: latestEp,
      episode_url: episodeUrl,
      pinged,
      error: run.error,
    });
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500);
  }
});
