// HU Formula v2 shadow scoring.
//
// Fully automatic, no manual seed list:
// - admits every Hungarian non-spam podcast into evaluation
// - writes only shadow_rank_components.hu_v2
// - never changes live public rank/tier directly
// - balances market charts with category-normalized activity and data quality

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const THRESHOLDS = { S: 8.2, A: 6.4, B: 5.1, C: 3.8, D: 2.4 };
const BAD_HEALTH = new Set(["rss_url_not_found", "needs_manual_rss_review", "confirmed_dead", "quarantined_spam"]);

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function tierFor(s: number): "S" | "A" | "B" | "C" | "D" | "E" {
  if (s >= THRESHOLDS.S) return "S";
  if (s >= THRESHOLDS.A) return "A";
  if (s >= THRESHOLDS.B) return "B";
  if (s >= THRESHOLDS.C) return "C";
  if (s >= THRESHOLDS.D) return "D";
  return "E";
}

const NEWS_RE = /\b(hírek|hírmondó|hírmagazin|hírpercek|hírháttér|hírlevél|krónika|infostart|napi hírek|reggeli hírek|esti hírek|déli hírek|éjszakai hírek|hírösszefoglaló|news|bulletin)\b/i;
const BULLETIN_TITLE_RE = /\b(hírpercek|hírgyors|napi hírek|reggeli hírek|déli hírek|esti hírek|éjszakai hírek|hírek\s*\d|\d+\s*perc(es)?\s*hír|hírösszefoglaló|infostart\s+hírek|hírmondó\s+\d+\s*perc|news\s+bulletin|hourly\s+news)\b/i;

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
    const titleStr = `${p.title || ""} ${p.display_title || ""}`;
    const urls = `${p.apple_url || ""} ${p.spotify_url || ""} ${p.website_url || ""}`;
    const strongHu = detIsHu || hu >= 50 || (hu > 0 && hu >= fo + 20) || /\.hu\b/i.test(titleStr) ||
      (/\/hu\//i.test(urls) || /\.hu\b/i.test(p.website_url || ""));
    return strongHu ? "hu_metadata_mismatch" : "accepted_foreign_false_positive";
  }
  if (ld === "review_uncertain") return "needs_language_review";
  if (detIsHu || (hu > 0 && hu >= fo + 10)) return langIsHu ? "confirmed_hungarian" : "hu_metadata_mismatch";
  if (fo > 0 && fo > hu) return "likely_foreign";
  if (langIsHu) return "confirmed_hungarian";
  return "unknown";
}

function detectNewsLike(p: any, eps90: number) {
  const hay = `${p.title || ""} ${p.display_title || ""} ${(p.summary || p.description || "").slice(0, 400)}`;
  const explicitBulletin = BULLETIN_TITLE_RE.test(hay);
  const news = NEWS_RE.test(hay);
  return {
    news_like: news || explicitBulletin,
    bulletin_like: explicitBulletin || (news && eps90 > 60),
  };
}

function percentile(sorted: number[], value: number) {
  if (!sorted.length) return 0.5;
  let below = 0;
  while (below < sorted.length && sorted[below] <= value) below++;
  return below / sorted.length;
}

function median(values: number[]) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function scoreMarket(mp: any, chartStale: boolean) {
  const rrf = Number(mp?.rrf) || 0;
  const srcCount = Number(mp?.srcCount) || 0;
  let score = clamp(rrf * 42, 0, 1.6);
  if (srcCount >= 3) score += 0.4;
  else if (srcCount >= 2) score += 0.25;
  else if (srcCount === 1) score += 0.08;
  if (chartStale) score *= 0.75;
  return clamp(score, 0, 2.0);
}

function scoreTrust(p: any, langFlag: string, content: any) {
  let score = 0;
  const health = (p.shadow_rank_components && typeof p.shadow_rank_components === "object")
    ? p.shadow_rank_components.health_state : null;
  if (langFlag === "confirmed_hungarian") score += 0.45;
  else if (langFlag === "hu_metadata_mismatch") score += 0.35;
  else if (langFlag === "needs_language_review") score += 0.12;
  if (String(p.rss_status || "") === "active") score += 0.45;
  else if (String(p.rss_status || "") === "not_checked") score += 0.2;
  if (!health || health === "healthy" || health === "recovered_rss_url") score += 0.25;
  if ((Number(content?.audio_coverage) || 0) >= 0.8) score += 0.2;
  if ((Number(p.ai_spam_score) || 0) >= 0.8 || BAD_HEALTH.has(String(health || ""))) score -= 0.6;
  return clamp(score, 0, 1.3);
}

function scoreFreshness(p: any, lastEpAt: number | null, eps180: number) {
  let score = 0;
  if (lastEpAt) {
    const ageD = (Date.now() - lastEpAt) / 86400000;
    if (ageD <= 14) score += 0.8;
    else if (ageD <= 30) score += 0.65;
    else if (ageD <= 90) score += 0.42;
    else if (ageD <= 180) score += 0.2;
  }
  const hydrated = Number(p.hydrated_episode_count) || 0;
  if (hydrated >= 25) score += 0.25;
  else if (hydrated >= 8) score += 0.15;
  if (eps180 > 0) score += 0.15;
  return clamp(score, 0, 1.2);
}

function scoreCategoryActivity(eps90: number, categoryPercentile: number, bulletin: boolean) {
  let score = 0;
  if (eps90 === 0) score = 0.1;
  else if (eps90 <= 2) score = 0.35;
  else if (eps90 <= 6) score = 0.65;
  else if (eps90 <= 20) score = 0.9;
  else if (eps90 <= 60) score = 0.75;
  else score = 0.45;
  score += clamp(categoryPercentile, 0, 1) * 0.45;
  if (bulletin && eps90 > 20) score = Math.min(score, 0.65);
  return clamp(score, 0, 1.3);
}

function scoreContent(p: any, content: any) {
  let score = 0;
  const desc = String(p.description || p.summary || "");
  if (desc.length >= 800) score += 0.25;
  else if (desc.length >= 300) score += 0.18;
  else if (desc.length >= 100) score += 0.1;
  if (p.display_title || p.seo_title) score += 0.15;
  const aq = Number(p.ai_quality_score);
  if (Number.isFinite(aq)) score += clamp(aq, 0, 1) * 0.35;
  score += clamp(Number(content?.summary_coverage) || 0, 0, 1) * 0.35;
  score += clamp(Number(content?.topic_coverage) || 0, 0, 1) * 0.25;
  score += clamp(Number(content?.entity_coverage) || 0, 0, 1) * 0.25;
  return clamp(score, 0, 1.6);
}

function scorePlatform(p: any) {
  let score = 0;
  if (p.apple_url) score += 0.18;
  if (p.spotify_url || p.spotify_id) score += 0.18;
  if (p.youtube_url || p.youtube_channel_id) score += 0.18;
  if (p.website_url) score += 0.16;
  return clamp(score, 0, 0.7);
}

function scoreDistinctiveness(p: any, content: any, newsLike: boolean) {
  let score = 0.25;
  const desc = String(p.description || p.summary || "");
  if (desc.length >= 300 && !/https?:\/\/|instagram|facebook|tiktok|youtube\.com/i.test(desc.slice(0, 900))) score += 0.15;
  if ((Number(content?.topic_coverage) || 0) >= 0.5) score += 0.15;
  if ((Number(content?.entity_coverage) || 0) >= 0.25) score += 0.1;
  if (newsLike) score -= 0.15;
  return clamp(score, 0, 0.6);
}

function scoreCuration(p: any) {
  if (p.featured !== true) return 0;
  const fr = Number(p.featured_rank);
  if (!Number.isFinite(fr) || fr <= 0) return 0.15;
  if (fr <= 10) return 0.3;
  if (fr <= 50) return 0.2;
  return 0.1;
}

function confidenceFor(p: any, content: any, mp: any, act: any, langFlag: string) {
  let c = 0.25;
  if (langFlag === "confirmed_hungarian" || langFlag === "hu_metadata_mismatch") c += 0.2;
  if (String(p.rss_status || "") === "active") c += 0.15;
  if ((Number(p.hydrated_episode_count) || 0) >= 10) c += 0.1;
  if ((Number(content?.episode_count) || 0) >= 5) c += 0.1;
  if ((Number(content?.summary_coverage) || 0) >= 0.3) c += 0.06;
  if ((Number(content?.topic_coverage) || 0) >= 0.3) c += 0.06;
  if ((Number(mp?.srcCount) || 0) > 0) c += 0.05;
  if ((Number(act?.eps180) || 0) > 0) c += 0.03;
  return clamp(+c.toFixed(3), 0, 0.98);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    let body: any = {};
    try { body = req.method === "POST" ? await req.json() : {}; } catch { /* noop */ }
    const ids: string[] | undefined = Array.isArray(body.ids) ? body.ids : undefined;
    const limit = Math.max(1, Math.min(2500, Number(body.limit) || 400));
    const all = !!body.all;
    const dry = !!body.dry_run;
    const { data: ctrlRow } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "hu_formula_v2_controls")
      .maybeSingle();
    const controls = (ctrlRow?.value && typeof ctrlRow.value === "object") ? ctrlRow.value as Record<string, unknown> : {};
    const applyLive = body.apply_live === true || controls.apply_live === true;
    const minLiveConfidence = clamp(Number(body.min_live_confidence ?? controls.min_live_confidence ?? 0.55), 0, 1);
    const allowChartStaleLive = body.allow_chart_stale_live === true || controls.allow_chart_stale_live === true;

    const { data: mpRows, error: mpErr } = await supabase.rpc("hu_market_popularity");
    if (mpErr) throw mpErr;
    const mpMap = new Map<string, { rrf: number; srcCount: number; sources: any }>();
    for (const r of mpRows || []) {
      mpMap.set((r as any).podcast_id, {
        rrf: Number((r as any).rrf_score) || 0,
        srcCount: Number((r as any).source_count) || 0,
        sources: (r as any).sources || [],
      });
    }

    const { data: freshRows } = await supabase.rpc("hu_chart_freshness");
    const chartFreshness = (freshRows || []).map((r: any) => ({
      source: r.source,
      latest: r.latest_snapshot,
      days_old: Number(r.days_old) || 0,
      rows: Number(r.rows_in_latest) || 0,
      stale: !!r.stale,
    }));
    const anyChartStale = chartFreshness.some((r: any) => r.stale);

    const selectCols = "id,title,display_title,summary,description,category,language,language_decision,hungarian_score,foreign_score,detected_language,rss_status,hydrated_episode_count,apple_url,spotify_url,spotify_id,youtube_url,youtube_channel_id,website_url,featured,featured_rank,seo_title,ai_quality_score,ai_spam_score,podiverzum_rank,rank_label,shadow_rank_components";
    let targets: any[] = [];
    if (ids && ids.length) {
      const { data, error } = await supabase.from("podcasts").select(selectCols).in("id", ids);
      if (error) throw error;
      targets = data || [];
    } else if (all) {
      const pageSize = 500;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("podcasts")
          .select(selectCols)
          .or("is_hungarian.eq.true,language_decision.eq.accept_hungarian,language_decision.eq.review_uncertain")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data?.length) break;
        targets.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
      }
    } else {
      const onlyUnscored = body.only_unscored !== false;
      let q = supabase
        .from("podcasts")
        .select(selectCols)
        .or("is_hungarian.eq.true,language_decision.eq.accept_hungarian,language_decision.eq.review_uncertain")
        .order("rank_updated_at", { ascending: true, nullsFirst: true })
        .limit(limit);
      if (onlyUnscored) q = q.is("shadow_rank_components->hu_v2", null);
      const { data, error } = await q;
      if (error) throw error;
      targets = data || [];
    }

    const idsAll = targets.map((p) => p.id);
    const actMap = new Map<string, { eps90: number; eps180: number; last: number | null }>();
    const contentMap = new Map<string, any>();
    for (let i = 0; i < idsAll.length; i += 200) {
      const chunk = idsAll.slice(i, i + 200);
      const [{ data: actRows, error: actErr }, { data: contentRows, error: contentErr }] = await Promise.all([
        supabase.rpc("hu_recent_activity", { _ids: chunk }),
        supabase.rpc("hu_content_intelligence_v2", { _ids: chunk }),
      ]);
      if (actErr) throw actErr;
      if (contentErr) throw contentErr;
      for (const r of actRows || []) {
        actMap.set((r as any).podcast_id, {
          eps90: Number((r as any).eps_90d) || 0,
          eps180: Number((r as any).eps_180d) || 0,
          last: (r as any).last_ep_at ? new Date((r as any).last_ep_at).getTime() : null,
        });
      }
      for (const r of contentRows || []) contentMap.set((r as any).podcast_id, r);
    }

    const byCategory = new Map<string, number[]>();
    for (const p of targets) {
      const cat = String(p.category || "uncategorized");
      const act = actMap.get(p.id) || { eps90: 0, eps180: 0, last: null };
      const arr = byCategory.get(cat) || [];
      arr.push(act.eps90);
      byCategory.set(cat, arr);
    }
    const sortedByCategory = new Map<string, number[]>();
    const medByCategory = new Map<string, number>();
    for (const [cat, values] of byCategory) {
      const sorted = values.slice().sort((a, b) => a - b);
      sortedByCategory.set(cat, sorted);
      medByCategory.set(cat, median(sorted));
    }

    const tierCounts: Record<string, number> = { S: 0, A: 0, B: 0, C: 0, D: 0, E: 0 };
    let written = 0, errors = 0, excluded = 0, liveApplied = 0, liveSkipped = 0;
    const examples: any[] = [];

    for (const p of targets) {
      const langFlag = languageGateFlag(p);
      const health = (p.shadow_rank_components && typeof p.shadow_rank_components === "object")
        ? p.shadow_rank_components.health_state : null;
      const hardExcluded = langFlag === "confirmed_foreign" || langFlag === "likely_foreign" ||
        BAD_HEALTH.has(String(health || "")) || Number(p.ai_spam_score || 0) >= 0.9;
      const act = actMap.get(p.id) || { eps90: 0, eps180: 0, last: null };
      const content = contentMap.get(p.id) || {};
      const mp = mpMap.get(p.id) || { rrf: 0, srcCount: 0, sources: [] };
      const news = detectNewsLike(p, act.eps90);
      const cat = String(p.category || "uncategorized");
      const catPct = percentile(sortedByCategory.get(cat) || [], act.eps90);

      const components = {
        market: scoreMarket(mp, anyChartStale),
        trust: scoreTrust(p, langFlag, content),
        freshness: scoreFreshness(p, act.last, act.eps180),
        category_activity: scoreCategoryActivity(act.eps90, catPct, news.bulletin_like),
        content_intelligence: scoreContent(p, content),
        platform_availability: scorePlatform(p),
        distinctiveness: scoreDistinctiveness(p, content, news.news_like),
        curation: scoreCuration(p),
      };
      let final = Object.values(components).reduce((a, b) => a + Number(b || 0), 0);
      const penalties: Record<string, number> = {};
      if (news.bulletin_like) penalties.bulletin_cap = Math.max(0, final - 6.2);
      else if (news.news_like && act.eps90 > 60) penalties.news_cadence = 0.35;
      if (hardExcluded) penalties.hard_exclusion = final;
      for (const v of Object.values(penalties)) final -= Number(v || 0);
      final = clamp(+final.toFixed(3), 0, 10);
      const tier = hardExcluded ? "E" : tierFor(final);
      tierCounts[tier]++;
      if (hardExcluded) excluded++;
      const confidence = confidenceFor(p, content, mp, act, langFlag);

      const hu_v2 = {
        formula: "HU_v2",
        formula_version: "2.0",
        computed_at: new Date().toISOString(),
        final_hu_score: final,
        hu_candidate_tier: tier,
        confidence,
        components: Object.fromEntries(Object.entries(components).map(([k, v]) => [k, +Number(v).toFixed(3)])),
        penalties,
        language_gate_flag: langFlag,
        news_like: news.news_like,
        bulletin_like: news.bulletin_like,
        eps_90d: act.eps90,
        eps_180d: act.eps180,
        last_ep_at: act.last ? new Date(act.last).toISOString() : null,
        category: cat,
        category_eps90_percentile: +catPct.toFixed(3),
        category_eps90_median: medByCategory.get(cat) || 0,
        market_rrf: +(mp.rrf || 0).toFixed(5),
        market_source_count: mp.srcCount || 0,
        market_sources: mp.sources || [],
        content_signals: content,
        chart_stale: anyChartStale,
        chart_freshness: chartFreshness,
        live_rank_label: p.rank_label,
        live_podiverzum_rank: p.podiverzum_rank,
      };

      if (examples.length < 8) examples.push({ id: p.id, title: p.display_title || p.title, score: final, tier, confidence });
      if (dry) continue;
      const prev = (p.shadow_rank_components && typeof p.shadow_rank_components === "object")
        ? p.shadow_rank_components as Record<string, unknown> : {};
      const { error } = await supabase.from("podcasts").update({ shadow_rank_components: { ...prev, hu_v2 } }).eq("id", p.id);
      if (error) errors++;
      else written++;

      const liveAllowed = applyLive
        && !hardExcluded
        && confidence >= minLiveConfidence
        && (!anyChartStale || allowChartStaleLive)
        && (langFlag === "confirmed_hungarian" || langFlag === "hu_metadata_mismatch" || langFlag === "needs_language_review");
      if (!dry && liveAllowed) {
        const { error: liveErr } = await supabase
          .from("podcasts")
          .update({
            podiverzum_rank: final,
            rank_label: tier,
            rank_updated_at: new Date().toISOString(),
            rank_reason: {
              formula: "HU_v2",
              source: "hu-formula-v2-shadow",
              score: final,
              tier,
              confidence,
              market_source_count: mp.srcCount || 0,
              market_rrf: +(mp.rrf || 0).toFixed(5),
              language_gate_flag: langFlag,
              applied_at: new Date().toISOString(),
            },
          })
          .eq("id", p.id);
        if (liveErr) errors++;
        else liveApplied++;
      } else if (applyLive && !dry) {
        liveSkipped++;
      }
    }

    const summary = {
      ts: new Date().toISOString(),
      considered: targets.length,
      written,
      errors,
      dry_run: dry,
      apply_live: applyLive,
      live_applied: liveApplied,
      live_skipped: liveSkipped,
      min_live_confidence: minLiveConfidence,
      excluded,
      tier_distribution: tierCounts,
      market_popularity_pool: mpMap.size,
      chart_stale: anyChartStale,
      examples,
    };
    if (!dry) {
      await supabase.from("app_settings").upsert({
        key: "hu_formula_v2_runner",
        value: { last_run: summary, updated_at: new Date().toISOString() },
      });
    }
    return new Response(JSON.stringify({ ok: true, ...summary }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[hu-formula-v2-shadow] error:", e);
    return new Response(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
