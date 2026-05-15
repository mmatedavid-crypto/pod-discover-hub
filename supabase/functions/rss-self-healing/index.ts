// Permanent RSS self-healing job. Runs every 30min via pg_cron.
// Picks failed/broken feeds (high quality first), tries to rediscover via Podcast Index,
// auto-recovers on high confidence, flags for manual review on medium, marks not_found otherwise.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { titleSim as sim } from "../_shared/title-similarity.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Try to discover an RSS feed URL from a website. Handles HU CMS feeds (Telex, 444, HVG, Index, Mandiner).
async function discoverFeedFromWebsite(websiteUrl: string): Promise<string[]> {
  const found: string[] = [];
  try {
    const r = await fetch(websiteUrl, {
      headers: { "User-Agent": "Podiverzum/1.0 (+rss-discovery)" },
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
    });
    if (r.ok) {
      const html = (await r.text()).slice(0, 200_000);
      // <link rel="alternate" type="application/(rss|atom)+xml" href="...">
      const linkRe = /<link[^>]+rel=["']alternate["'][^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi;
      const hrefRe = /href=["']([^"']+)["']/i;
      const matches = html.match(linkRe) || [];
      for (const m of matches) {
        const h = m.match(hrefRe);
        if (h) found.push(new URL(h[1], websiteUrl).toString());
      }
    }
  } catch { /* swallow */ }

  // Common conventional paths
  try {
    const base = new URL(websiteUrl);
    for (const p of ["/feed", "/rss", "/feed/podcast", "/podcast.xml", "/feed.xml", "/rss.xml", "/feed/"]) {
      found.push(new URL(p, base.origin).toString());
    }
  } catch { /* invalid url */ }

  // Dedupe, cap
  return Array.from(new Set(found)).slice(0, 8);
}

async function piSearch(title: string) {
  const key = Deno.env.get("PODCAST_INDEX_API_KEY")!;
  const sec = Deno.env.get("PODCAST_INDEX_API_SECRET")!;
  const ts = Math.floor(Date.now() / 1000).toString();
  const data = new TextEncoder().encode(key + sec + ts);
  const buf = await crypto.subtle.digest("SHA-1", data);
  const hash = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  const u = `https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(title)}&max=8`;
  const r = await fetch(u, {
    headers: { "User-Agent": "Podiverzum/1.0", "X-Auth-Date": ts, "X-Auth-Key": key, Authorization: hash },
  });
  if (!r.ok) return [];
  const j = await r.json().catch(() => ({}));
  return (j.feeds || []) as any[];
}

async function verifyFeed(url: string, expectedTitle: string) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": "Podiverzum/1.0" } });
    if (!r.ok) return { ok: false, sim: 0 };
    const xml = (await r.text()).slice(0, 50_000);
    const m = xml.match(/<title[^>]*>\s*(?:<!\[CDATA\[)?([^<\]]+)/i);
    const feedTitle = m ? m[1].trim() : "";
    const hasItems = /<item[\s>]/i.test(xml);
    const titleSim = sim(feedTitle, expectedTitle);
    return { ok: hasItems, sim: titleSim, feedTitle };
  } catch { return { ok: false, sim: 0 }; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const __guard = await checkBackgroundJobsAllowed(supabase, "rss-self-healing");
    if (__guard.blocked) return new Response(JSON.stringify({ ok: true, skipped: true, reason: __guard.reason }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    const body = await req.json().catch(() => ({}));
    const limit = Math.max(1, Math.min(30, Number(body.limit) || 10));
    const TIME_BUDGET_MS = Math.max(20_000, Math.min(110_000, Number(body.time_budget_ms) || 60_000));
    const startedAt = Date.now();

    // Pick high-quality broken feeds first
    const { data: cands } = await supabase
      .from("podcasts")
      .select("id, title, rss_url, rss_status, consecutive_failure_count, ai_quality_score, ai_spam_score, last_fetch_error, shadow_rank_components")
      .or("rss_status.eq.failed,consecutive_failure_count.gte.5")
      .gte("ai_quality_score", 6)
      .lt("ai_spam_score", 4)
      .order("ai_quality_score", { ascending: false })
      .limit(limit * 2);

    // Skip ones already attempted recently (within 24h) unless forced
    const now = Date.now();
    const list = (cands || []).filter((p: any) => {
      if (body.force) return true;
      const at = (p.shadow_rank_components as any)?.rss_rediscovery_attempted_at
              || (p.shadow_rank_components as any)?.rss_rediscovery?.at;
      if (!at) return true;
      return now - new Date(at).getTime() > 24 * 3600 * 1000;
    }).slice(0, limit);

    const results: any[] = [];
    let recovered = 0, manualReview = 0, notFound = 0, errors = 0;

    for (const p of list) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) break;
      try {
        const feeds = await piSearch(p.title);
        let best: { url: string; conf: number; feedTitle?: string } | null = null;
        for (const f of feeds.slice(0, 5)) {
          if (!f.url || f.url === p.rss_url) continue;
          const v = await verifyFeed(f.url, p.title);
          const piSim = sim(f.title || "", p.title);
          const conf = 0.6 * v.sim + 0.3 * piSim + 0.1 * (v.ok ? 1 : 0);
          if (!best || conf > best.conf) best = { url: f.url, conf, feedTitle: v.feedTitle };
        }
        const oldUrl = p.rss_url;
        const comp = (p.shadow_rank_components as any) || {};
        if (best && best.conf >= 0.85) {
          comp.health_state = "recovered_rss_url";
          comp.rss_rediscovery = { old_url: oldUrl, confidence: best.conf, at: new Date().toISOString() };
          await supabase.from("podcasts").update({
            rss_url: best.url, rss_status: "not_checked",
            consecutive_failure_count: 0, last_fetch_error: null,
            shadow_rank_components: comp,
          }).eq("id", p.id);
          await supabase.from("rss_url_history").insert({
            podcast_id: p.id, old_url: oldUrl, new_url: best.url,
            reason: `self_healing confidence=${best.conf.toFixed(2)}`,
          });
          recovered++;
          results.push({ id: p.id, title: p.title, action: "recovered", confidence: best.conf, new_url: best.url });
        } else if (best && best.conf >= 0.6) {
          comp.health_state = "needs_manual_rss_review";
          comp.rss_rediscovery_candidate = { url: best.url, confidence: best.conf, at: new Date().toISOString() };
          await supabase.from("podcasts").update({ shadow_rank_components: comp }).eq("id", p.id);
          manualReview++;
          results.push({ id: p.id, title: p.title, action: "manual_review", confidence: best.conf, candidate: best.url });
        } else {
          comp.health_state = "rss_url_not_found";
          comp.rss_rediscovery_attempted_at = new Date().toISOString();
          await supabase.from("podcasts").update({ shadow_rank_components: comp }).eq("id", p.id);
          notFound++;
          results.push({ id: p.id, title: p.title, action: "not_found" });
        }
      } catch (e) {
        errors++;
        results.push({ id: p.id, title: p.title, action: "error", error: String(e) });
      }
    }

    const summary = {
      started_at: new Date(startedAt).toISOString(),
      finished_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      checked: results.length, recovered, manual_review: manualReview, not_found: notFound, errors,
    };
    await supabase.from("app_settings").upsert({
      key: "rss_self_healing", value: { last_run: summary, recent: results.slice(0, 20) } as any,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return new Response(JSON.stringify({ ok: true, ...summary, results }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
