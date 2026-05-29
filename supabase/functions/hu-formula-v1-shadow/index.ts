// hu-formula-v1-shadow
// Phase B shadow scoring for Hungarian podcast ranking.
//
// CRITICAL SAFETY CONTRACT:
//   - NEVER writes podcasts.rank_label
//   - NEVER writes podcasts.podiverzum_rank
//   - NEVER writes podcasts.shadow_rank
//   - NEVER writes podcasts.shadow_rank_tier
//   - NEVER writes podcasts.shadow_computed_at
//   - Writes ONLY: podcasts.shadow_rank_components ⟵ JSONB merge of { ...existing, hu_v1: {...} }
//
// This way Formula C and HU_v1 cannot collide. (Formula C is also set to dry_run
// at the cron level as a belt-and-suspenders measure.)
//
// Formula total = 10.0 max
//   market_popularity:    3.5  (RRF over Apple/Spotify/YouTube HU charts + multi-source bonus)
//   feed_health:          2.0  (rss_status + last_ep recency + hydrated_episode_count)
//   activity:             1.5  (HU-calibrated 90d episode cadence with bulletin cap)
//   content_quality:      1.5  (title/desc/seo/ai_quality_score)
//   platform_availability:1.0  (apple/spotify/youtube/website URL presence)
//   curation_boost:       0.5  (featured + featured_rank)
//
// Language is NOT a score component. It is an eligibility flag only:
//   language_gate_flag ∈ {accepted_hungarian, accepted_hungarian_metadata_mismatch,
//                         needs_language_review, likely_foreign, confirmed_foreign, unknown}
//
// Body (POST, optional):
//   { ids?: uuid[], limit?: number, dry_run?: boolean, all?: boolean }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THRESHOLDS = { S: 8.0, A: 5.0, B: 4.0, C: 3.0, D: 2.0 };
function tierFor(s: number): "S"|"A"|"B"|"C"|"D"|"E" {
  if (s >= THRESHOLDS.S) return "S";
  if (s >= THRESHOLDS.A) return "A";
  if (s >= THRESHOLDS.B) return "B";
  if (s >= THRESHOLDS.C) return "C";
  if (s >= THRESHOLDS.D) return "D";
  return "E";
}

// News-like = general news/public-affairs/radio content
const NEWS_RE = /\b(hírek|hírmondó|hírmagazin|hírpercek|hírháttér|hírlevél|krónika|infostart|napi hírek|reggeli hírek|esti hírek|déli hírek|éjszakai hírek|hírösszefoglaló|news|bulletin)\b/i;

// Bulletin-like = short frequent news bulletins specifically.
// Must NOT match interview/long-form shows like "Aréna".
// Triggers on explicit bulletin phrasing OR very high cadence newsfeeds.
const BULLETIN_TITLE_RE = /\b(hírpercek|hírgyors|napi hírek|reggeli hírek|déli hírek|esti hírek|éjszakai hírek|hírek\s*\d|\d+\s*perc(es)?\s*hír|hírösszefoglaló|infostart\s+hírek|hírmondó\s+\d+\s*perc|news\s+bulletin|hourly\s+news)\b/i;

function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }

// Phase B QA: split flags into:
//   confirmed_hungarian            — language_decision=accept_hungarian AND RSS language is hu
//   hu_metadata_mismatch           — accept_hungarian BUT RSS lang not hu, strong HU signals (genuinely HU, bad metadata)
//   accepted_foreign_false_positive— accept_hungarian BUT RSS lang not hu AND weak HU signals / foreign dominates
//   needs_language_review          — language_decision=review_uncertain, or ambiguous unset
//   likely_foreign                 — no decision but foreign signals dominate
//   confirmed_foreign              — language_decision=reject_foreign
//   unknown                        — no usable signal
function languageGateFlag(p: any): string {
  const ld = p.language_decision;
  const lang = typeof p.language === "string" ? p.language.toLowerCase() : "";
  const langIsHu = /^hu/i.test(lang);
  const hu = Number(p.hungarian_score) || 0;
  const fo = Number(p.foreign_score) || 0;
  const det = typeof p.detected_language === "string" ? p.detected_language.toLowerCase() : "";
  const detIsHu = det === "hu" || det.startsWith("hu");

  if (ld === "reject_foreign") return "confirmed_foreign";

  if (ld === "accept_hungarian") {
    if (langIsHu) return "confirmed_hungarian";
    // Bad RSS language tag — decide if genuinely HU or false positive.
    // Strong HU signals (non-AI, no language tag):
    //   detected_language=hu, hungarian_score>=50, hu_score >> foreign_score,
    //   title/display_title ends in .hu (e.g. "Heol.hu", "Index.hu"),
    //   apple_url/website_url uses /hu/ HU storefront.
    const titleStr = `${p.title || ""} ${p.display_title || ""}`;
    const huDomainInTitle = /\.hu\b/i.test(titleStr);
    const urls = `${p.apple_url || ""} ${p.spotify_url || ""} ${p.website_url || ""}`;
    const huStorefront = /\/hu\//i.test(urls) || /\.hu\b/i.test(p.website_url || "");
    const strongHu =
      detIsHu ||
      hu >= 50 ||
      (hu > 0 && hu >= fo + 20) ||
      huDomainInTitle ||
      (huStorefront && fo === 0);
    if (strongHu) return "hu_metadata_mismatch";
    return "accepted_foreign_false_positive";
  }

  if (ld === "review_uncertain") return "needs_language_review";

  // No decision yet — fall back to non-AI signals
  if (detIsHu || (hu > 0 && hu >= fo + 10)) return langIsHu ? "confirmed_hungarian" : "hu_metadata_mismatch";
  if (fo > 0 && fo > hu) return "likely_foreign";
  if (langIsHu) return "confirmed_hungarian";
  return "unknown";
}

function detectNewsLike(p: any, eps90: number): { news_like: boolean; bulletin_like: boolean } {
  const hay = `${p.title || ""} ${p.display_title || ""} ${(p.summary || "").slice(0, 300)}`;
  const news = NEWS_RE.test(hay);
  const explicitBulletin = BULLETIN_TITLE_RE.test(hay);
  // Bulletin = explicit bulletin phrasing OR (news + very high cadence > 60 eps/90d)
  // → catches "Hírek 8 órakor", InfoRádió hourly feeds; does NOT flag Aréna-style shows.
  const bulletin = explicitBulletin || (news && eps90 > 60);
  return { news_like: news || explicitBulletin, bulletin_like: bulletin };
}

function scoreFeedHealth(p: any, lastEpAt: number | null): number {
  let s = 0;
  const rss = String(p.rss_status || "");
  if (rss === "active") s += 1.0;
  else if (rss === "quarantined" || rss === "inactive") s += 0.2;
  else if (rss === "failed") s += 0;
  else s += 0.4; // unknown but not failing

  const now = Date.now();
  if (lastEpAt) {
    const ageD = (now - lastEpAt) / 86400000;
    if (ageD <= 30) s += 0.6;
    else if (ageD <= 90) s += 0.4;
    else if (ageD <= 180) s += 0.2;
  }

  const h = Number(p.hydrated_episode_count) || 0;
  if (h >= 20) s += 0.4;
  else if (h >= 5) s += 0.2;

  return clamp(s, 0, 2.0);
}

function scoreActivity(eps90: number, eps180: number, bulletin: boolean): number {
  // HU-calibrated cadence:
  //   0-eps but had eps in 180d → 0.3
  //   1-3 eps/90d  → 0.6
  //   4-8 eps/90d  → 1.0
  //   9-20 eps/90d → 1.5  (sweet spot for active HU podcasts)
  //   21-60 eps/90d→ 1.3
  //   >60 eps/90d  → 1.0 (likely daily bulletin; do not over-promote)
  let s = 0;
  if (eps90 === 0) s = eps180 > 0 ? 0.3 : 0;
  else if (eps90 <= 3) s = 0.6;
  else if (eps90 <= 8) s = 1.0;
  else if (eps90 <= 20) s = 1.5;
  else if (eps90 <= 60) s = 1.3;
  else s = 1.0;
  // Extra cap for bulletin-like at high frequency
  if (bulletin && eps90 > 20) s = Math.min(s, 0.9);
  return clamp(s, 0, 1.5);
}

function scoreContent(p: any): number {
  let s = 0;
  const title = (p.title || "").trim();
  if (title.length >= 4 && !/^untitled|^podcast$/i.test(title)) s += 0.3;
  const desc = (p.description || p.summary || "").trim();
  if (desc.length >= 500) s += 0.5;
  else if (desc.length >= 200) s += 0.3;
  else if (desc.length >= 80) s += 0.15;
  if (p.seo_title || p.display_title) s += 0.2;
  const aq = Number(p.ai_quality_score);
  if (Number.isFinite(aq)) {
    if (aq >= 0.8) s += 0.5;
    else if (aq >= 0.6) s += 0.35;
    else if (aq >= 0.4) s += 0.2;
  }
  return clamp(s, 0, 1.5);
}

function scorePlatforms(p: any): number {
  let s = 0;
  if (p.apple_url) s += 0.25;
  if (p.spotify_url) s += 0.25;
  if (p.youtube_url || p.youtube_channel_id) s += 0.25;
  if (p.website_url) s += 0.25;
  return clamp(s, 0, 1.0);
}

function scoreCuration(p: any): number {
  let s = 0;
  if (p.featured === true) s += 0.3;
  const fr = Number(p.featured_rank);
  if (Number.isFinite(fr) && fr > 0) {
    if (fr <= 10) s += 0.2;
    else if (fr <= 50) s += 0.1;
  }
  return clamp(s, 0, 0.5);
}

function scoreMarket(rrf: number, srcCount: number): { score: number; rrf: number } {
  // Three #1s ≈ 3 * 1/61 ≈ 0.0492; tune so 0.05 saturates the 3.0 base.
  let base = clamp(rrf * 60, 0, 3.0);
  // Multi-source bonus
  if (srcCount >= 3) base += 0.5;
  else if (srcCount >= 2) base += 0.3;
  return { score: clamp(base, 0, 3.5), rrf };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let body: any = {};
    try { body = req.method === "POST" ? await req.json() : {}; } catch { /* */ }
    const ids: string[] | undefined = Array.isArray(body.ids) ? body.ids : undefined;
    const limit: number = Math.max(1, Math.min(2000, Number(body.limit) || 200));
    const dry: boolean = !!body.dry_run;
    const all: boolean = !!body.all;

    // 1) Pre-load market popularity for all HU podcasts (small set, ~300 entries).
    const { data: mpRows, error: mpErr } = await supabase.rpc("hu_market_popularity");
    if (mpErr) throw mpErr;
    const mpMap = new Map<string, { rrf: number; srcCount: number; sources: any }>();
    for (const r of mpRows || []) {
      mpMap.set((r as any).podcast_id, {
        rrf: Number((r as any).rrf_score) || 0,
        srcCount: Number((r as any).source_count) || 0,
        sources: (r as any).sources,
      });
    }

    // 1b) Chart freshness — surface staleness but DO NOT change formula aggressively.
    const { data: freshRows } = await supabase.rpc("hu_chart_freshness");
    const chartFreshness: Array<{ source: string; latest: string | null; days_old: number; rows: number; stale: boolean }> = [];
    let anyChartStale = false;
    for (const r of freshRows || []) {
      const stale = !!(r as any).stale;
      if (stale) anyChartStale = true;
      chartFreshness.push({
        source: (r as any).source,
        latest: (r as any).latest_snapshot,
        days_old: Number((r as any).days_old) || 0,
        rows: Number((r as any).rows_in_latest) || 0,
        stale,
      });
    }

    // 2) Resolve targets.
    let targets: any[] = [];
    if (ids && ids.length > 0) {
      const { data, error } = await supabase
        .from("podcasts")
        .select("id,title,display_title,summary,description,language,language_decision,hungarian_score,foreign_score,detected_language,rss_status,hydrated_episode_count,apple_url,spotify_url,youtube_url,youtube_channel_id,website_url,featured,featured_rank,seo_title,ai_quality_score,podiverzum_rank,rank_label,shadow_rank_components")
        .in("id", ids);
      if (error) throw error;
      targets = data || [];
    } else if (all) {
      // Page through HU-eligible podcasts.
      const pageSize = 500;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("podcasts")
          .select("id,title,display_title,summary,description,language,language_decision,hungarian_score,foreign_score,detected_language,rss_status,hydrated_episode_count,apple_url,spotify_url,youtube_url,youtube_channel_id,website_url,featured,featured_rank,seo_title,ai_quality_score,podiverzum_rank,rank_label,shadow_rank_components")
          .or("language.ilike.hu%,language_decision.eq.accept_hungarian,language_decision.eq.review_uncertain")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        targets.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
    } else {
      // Self-paging: only fetch podcasts that don't yet have hu_v1 shadow score.
      const onlyUnscored: boolean = body.only_unscored !== false; // default true
      let q = supabase
        .from("podcasts")
        .select("id,title,display_title,summary,description,language,language_decision,hungarian_score,foreign_score,detected_language,rss_status,hydrated_episode_count,apple_url,spotify_url,youtube_url,youtube_channel_id,website_url,featured,featured_rank,seo_title,ai_quality_score,podiverzum_rank,rank_label,shadow_rank_components")
        .or("language.ilike.hu%,language_decision.eq.accept_hungarian,language_decision.eq.review_uncertain");
      if (onlyUnscored) {
        q = q.is("shadow_rank_components->hu_v1", null);
      }
      const { data, error } = await q.limit(limit);
      if (error) throw error;
      targets = data || [];
    }

    // 3) Batch-fetch recent activity for all target ids (chunks of 200).
    const actMap = new Map<string, { eps90: number; eps180: number; last: number | null }>();
    const allIds = targets.map(t => t.id);
    for (let i = 0; i < allIds.length; i += 200) {
      const chunk = allIds.slice(i, i + 200);
      const { data, error } = await supabase.rpc("hu_recent_activity", { _ids: chunk });
      if (error) throw error;
      for (const r of data || []) {
        actMap.set((r as any).podcast_id, {
          eps90: Number((r as any).eps_90d) || 0,
          eps180: Number((r as any).eps_180d) || 0,
          last: (r as any).last_ep_at ? new Date((r as any).last_ep_at).getTime() : null,
        });
      }
    }

    // 4) Score + write in chunks of 50.
    const t0 = Date.now();
    let written = 0, errors = 0;
    const tierCounts: Record<string, number> = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0 };
    const flagCounts: Record<string, number> = {
      confirmed_hungarian: 0,
      hu_metadata_mismatch: 0,
      accepted_foreign_false_positive: 0,
      needs_language_review: 0,
      likely_foreign: 0,
      confirmed_foreign: 0,
      unknown: 0,
    };
    let newsCount = 0, bulletinCount = 0;

    for (const p of targets) {
      const mp = mpMap.get(p.id) || { rrf: 0, srcCount: 0, sources: [] };
      const act = actMap.get(p.id) || { eps90: 0, eps180: 0, last: null };
      const newsLike = detectNewsLike(p, act.eps90);

      const market = scoreMarket(mp.rrf, mp.srcCount);
      const feed = scoreFeedHealth(p, act.last);
      const activity = scoreActivity(act.eps90, act.eps180, newsLike.bulletin_like);
      const content = scoreContent(p);
      const platform = scorePlatforms(p);
      const curation = scoreCuration(p);

      const final = +(market.score + feed + activity + content + platform + curation).toFixed(3);
      const tier = tierFor(final);
      tierCounts[tier]++;
      if (newsLike.news_like) newsCount++;
      if (newsLike.bulletin_like) bulletinCount++;

      const langFlag = languageGateFlag(p);
      if (langFlag in flagCounts) flagCounts[langFlag]++;

      const hu_v1 = {
        formula: "HU_v1",
        formula_version: "1.1",
        computed_at: new Date().toISOString(),
        market_popularity_score: +market.score.toFixed(3),
        market_rrf: +mp.rrf.toFixed(5),
        market_source_count: mp.srcCount,
        market_sources: mp.sources,
        chart_stale: anyChartStale,
        chart_freshness: chartFreshness,
        feed_health_score: +feed.toFixed(3),
        activity_score: +activity.toFixed(3),
        eps_90d: act.eps90,
        eps_180d: act.eps180,
        last_ep_at: act.last ? new Date(act.last).toISOString() : null,
        content_quality_score: +content.toFixed(3),
        platform_availability_score: +platform.toFixed(3),
        curation_boost: +curation.toFixed(3),
        final_hu_score: final,
        hu_candidate_tier: tier,
        news_like: newsLike.news_like,
        bulletin_like: newsLike.bulletin_like,
        language_gate_flag: langFlag,
        live_rank_label: p.rank_label,
        live_podiverzum_rank: p.podiverzum_rank,
      };

      if (dry) continue;

      // JSONB merge: preserve any existing keys (incl. health_state etc. set by Formula C).
      const prev = (p.shadow_rank_components && typeof p.shadow_rank_components === "object")
        ? p.shadow_rank_components as Record<string, unknown>
        : {};
      const merged = { ...prev, hu_v1 };

      const { error: updErr } = await supabase
        .from("podcasts")
        .update({ shadow_rank_components: merged })
        .eq("id", p.id);
      if (updErr) { errors++; continue; }
      written++;
    }

    const summary = {
      ts: new Date().toISOString(),
      considered: targets.length,
      written, errors,
      dry_run: dry,
      duration_ms: Date.now() - t0,
      tier_distribution: tierCounts,
      language_flag_distribution: flagCounts,
      news_like: newsCount,
      bulletin_like: bulletinCount,
      market_popularity_pool: mpMap.size,
      chart_stale: anyChartStale,
      chart_freshness: chartFreshness,
    };

    if (!dry) {
      await supabase.from("app_settings").upsert({
        key: "hu_formula_v1_runner",
        value: { last_run: summary, updated_at: new Date().toISOString() },
      });
    }

    console.log("[hu-formula-v1-shadow]", JSON.stringify(summary));

    return new Response(JSON.stringify({ ok: true, ...summary }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[hu-formula-v1-shadow] error:", e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
