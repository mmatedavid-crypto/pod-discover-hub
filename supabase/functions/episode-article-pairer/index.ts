// Matches publisher article pages to podcast episodes.
// Conservative by design: only configured outlet feeds are read, and only high
// title/date/token agreement becomes confirmed evidence for best-text-source.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import {
  ArticleEpisodeRow,
  ArticleItem,
  articlePodcastTitle,
  parsePublisherListingHtml,
  parsePublisherFeed,
  scorePublisherArticleMatch,
  stripHtml,
} from "../_shared/publisher-article-match.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type SourceConfig = {
  outlet: string;
  feed_urls: string[];
  listing_urls?: string[];
  podcast_title_patterns?: string[];
};

type SourceDiagnostics = Record<string, {
  feeds: Record<string, { ok: boolean; items: number; error?: string }>;
  listings: Record<string, { ok: boolean; items: number; error?: string }>;
}>;

const DEFAULT_BLOCKED_GENERIC_TITLE_PATTERNS = [
  "téma",
  "közélet",
  "gazdaság",
  "tech",
  "tudomány",
  "biznisz",
  "forint",
  "tőzsde",
  "befektetés",
  "checklist",
  "after",
];

function normalizeTitlePattern(pattern: string): string {
  return pattern.trim().toLocaleLowerCase("hu-HU");
}

function blockedGenericTitlePatterns(ctrl: Record<string, unknown>): Set<string> {
  const configured = Array.isArray(ctrl.blocked_generic_title_patterns)
    ? ctrl.blocked_generic_title_patterns.filter((pattern): pattern is string => typeof pattern === "string")
    : DEFAULT_BLOCKED_GENERIC_TITLE_PATTERNS;
  return new Set(configured.map(normalizeTitlePattern));
}

function safePodcastTitlePatterns(
  source: SourceConfig,
  ctrl: Record<string, unknown>,
): { patterns: string[]; filtered: string[] } {
  const rawPatterns = (source.podcast_title_patterns || [source.outlet])
    .filter((pattern): pattern is string => typeof pattern === "string")
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  const blocked = blockedGenericTitlePatterns(ctrl);
  const filtered: string[] = [];
  const patterns = rawPatterns.filter((pattern) => {
    if (!blocked.has(normalizeTitlePattern(pattern))) return true;
    filtered.push(pattern);
    return false;
  });

  return {
    patterns: patterns.length ? patterns : [source.outlet],
    filtered,
  };
}

async function fetchArticleText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "PodiverzumBot/1.0" } });
  if (!res.ok) return "";
  const html = await res.text();
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || "";
  const main = articleMatch || html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html;
  return stripHtml(main).slice(0, 18000);
}

async function fetchFeedItems(source: SourceConfig, ctrl: Record<string, unknown>, diagnostics: SourceDiagnostics): Promise<ArticleItem[]> {
  const out: ArticleItem[] = [];
  diagnostics[source.outlet] ||= { feeds: {}, listings: {} };
  const limit = Math.max(10, Math.min(200, Number(ctrl.article_feed_item_limit || 80)));
  for (const feedUrl of source.feed_urls || []) {
    try {
      const res = await fetch(feedUrl, { headers: { "User-Agent": "PodiverzumBot/1.0" } });
      if (!res.ok) {
        diagnostics[source.outlet].feeds[feedUrl] = { ok: false, items: 0, error: `http_${res.status}` };
        continue;
      }
      const xml = await res.text();
      const items = parsePublisherFeed(xml, source.outlet);
      diagnostics[source.outlet].feeds[feedUrl] = {
        ok: items.length > 0,
        items: items.length,
        ...(items.length ? {} : { error: "no_feed_items" }),
      };
      out.push(...items);
    } catch (e) {
      console.error("article feed fetch failed", source.outlet, feedUrl, e);
      diagnostics[source.outlet].feeds[feedUrl] = { ok: false, items: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }
  for (const listingUrl of source.listing_urls || []) {
    try {
      const res = await fetch(listingUrl, { headers: { "User-Agent": "PodiverzumBot/1.0" } });
      if (!res.ok) {
        diagnostics[source.outlet].listings[listingUrl] = { ok: false, items: 0, error: `http_${res.status}` };
        continue;
      }
      const html = await res.text();
      const items = parsePublisherListingHtml(html, source.outlet, listingUrl);
      diagnostics[source.outlet].listings[listingUrl] = {
        ok: items.length > 0,
        items: items.length,
        ...(items.length ? {} : { error: "no_listing_items" }),
      };
      out.push(...items);
    } catch (e) {
      console.error("article listing fetch failed", source.outlet, listingUrl, e);
      diagnostics[source.outlet].listings[listingUrl] = { ok: false, items: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }
  const seen = new Set<string>();
  return out
    .filter((item) => {
      if (seen.has(item.url)) return false;
      seen.add(item.url);
      return true;
    })
    .sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime())
    .slice(0, limit);
}

async function runPairer(admin: ReturnType<typeof createClient>, body: Record<string, unknown>, ctrl: Record<string, unknown>, startedAt: number) {
  try {
    const sources = (Array.isArray(ctrl.sources) ? ctrl.sources : []) as SourceConfig[];
    const limit = Math.max(10, Math.min(200, Number(body.limit || ctrl.batch_limit || 60)));
    const autoConfirm = Number(ctrl.auto_confirm_threshold || 0.82);
    const needsReview = Number(ctrl.needs_review_threshold || 0.68);
    const recentEpisodeDays = Math.max(7, Math.min(365, Number(ctrl.recent_episode_days || 45)));
    const recentArticleDays = Math.max(7, Math.min(365, Number(ctrl.recent_article_days || 60)));
    const fetchArticleHtml = ctrl.fetch_article_html === true; // default OFF to stay under CPU budget
    let fetchesLeft = fetchArticleHtml ? Math.max(0, Math.min(20, Number(ctrl.max_article_fetches_per_run || 8))) : 0;

    // Round-robin a small source window per invocation to stay under Edge
    // Function CPU limits without letting one weak outlet keep the whole
    // candidate table empty for many runs.
    const { data: progRow } = await admin.from("app_settings").select("value").eq("key", "episode_article_pairer_progress").maybeSingle();
    const prevProgress = (progRow?.value || {}) as Record<string, unknown>;
    const cursor = Number(prevProgress.source_cursor || 0);
    const sourceIdx = sources.length ? cursor % sources.length : 0;
    const sourcesPerRun = sources.length
      ? Math.max(1, Math.min(sources.length, Number(body.sources_per_run || ctrl.sources_per_run || 1)))
      : 0;
    const activeSources = sources.length
      ? Array.from({ length: sourcesPerRun }, (_unused, offset) => sources[(sourceIdx + offset) % sources.length])
      : [];

    const inserted: Record<string, number> = {};
    const sourceDiagnostics: SourceDiagnostics = {};
    const bestRejectedScores: Array<{ outlet: string; article_title: string; score: number; reasons: string[] }> = [];
    let scannedArticles = 0;
    let scannedEpisodes = 0;
    let selectedCandidates = 0;
    let confirmedCandidates = 0;
    let verifiedUpsertRows = 0;
    let blockedGenericPatternsFiltered = 0;

    for (const source of activeSources) {
      const items = (await fetchFeedItems(source, ctrl, sourceDiagnostics)).filter((item) => {
        if (!item.published_at) return true;
        return new Date(item.published_at).getTime() > Date.now() - recentArticleDays * 86_400_000;
      }).slice(0, 60);
      scannedArticles += items.length;
      if (!items.length) continue;

      const safePatterns = safePodcastTitlePatterns(source, ctrl);
      blockedGenericPatternsFiltered += safePatterns.filtered.length;
      const patterns = safePatterns.patterns.map((p) => `%${p}%`);
      const orFilter = patterns.map((p) => `title.ilike.${p},display_title.ilike.${p}`).join(",");
      const { data: episodes, error: epErr } = await admin
        .from("episodes")
        .select("id,podcast_id,title,display_title,description,published_at,podcasts!inner(title,display_title,language_decision)")
        .or(orFilter, { foreignTable: "podcasts" })
        .eq("podcasts.language_decision", "accept_hungarian")
        .not("published_at", "is", null)
        .gt("published_at", new Date(Date.now() - recentEpisodeDays * 86_400_000).toISOString())
        .order("published_at", { ascending: false })
        .limit(limit);
      if (epErr) throw epErr;
      scannedEpisodes += episodes?.length || 0;

      const candidates: any[] = [];
      for (const article of items) {
        if (fetchArticleHtml && fetchesLeft > 0 && article.text.length < 1500) {
          const fullText = await fetchArticleText(article.url);
          fetchesLeft -= 1;
          if (fullText.length > article.text.length) article.text = fullText;
        }

        let best: { ep: ArticleEpisodeRow; score: ReturnType<typeof scorePublisherArticleMatch> } | null = null;
        for (const ep of (episodes || []) as ArticleEpisodeRow[]) {
          const s = scorePublisherArticleMatch(ep, article);
          if (!best || s.score > best.score.score) best = { ep, score: s };
        }
        if (!best || best.score.score < needsReview) {
          if (best && best.score.score > 0) {
            bestRejectedScores.push({
              outlet: source.outlet,
              article_title: article.title.slice(0, 160),
              score: Number(best.score.score.toFixed(4)),
              reasons: best.score.reasons,
            });
          }
          continue;
        }

        const status = best.score.score >= autoConfirm ? "confirmed" : "needs_review";
        candidates.push({
          episode_id: best.ep.id,
          podcast_id: best.ep.podcast_id,
          outlet: source.outlet,
          article_url: article.url,
          article_title: article.title,
          article_excerpt: article.excerpt.slice(0, 4000),
          article_text: article.text.slice(0, 30000),
          article_published_at: article.published_at,
          match_score: Number(best.score.score.toFixed(4)),
          status,
          match_reasons: best.score.reasons,
          evidence: {
            policy: "publisher_article_match_v1",
            outlet: source.outlet,
            date_score: best.score.date_score,
            shared_title_tokens: best.score.shared_title_tokens,
            shared_body_tokens: best.score.shared_body_tokens,
            article_len: article.text.length,
            episode_title: best.ep.display_title || best.ep.title,
            podcast_title: articlePodcastTitle(best.ep),
          },
          fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      selectedCandidates += candidates.length;
      confirmedCandidates += candidates.filter((candidate) => candidate.status === "confirmed").length;
      for (let i = 0; i < candidates.length; i += 100) {
        const chunk = candidates.slice(i, i + 100);
        const { data: upsertedRows, error } = await admin
          .from("episode_article_candidates")
          .upsert(chunk, { onConflict: "episode_id,article_url" })
          .select("id");
        if (error) throw error;
        inserted[source.outlet] = (inserted[source.outlet] || 0) + chunk.length;
        verifiedUpsertRows += upsertedRows?.length || 0;
      }
    }

    const { count: totalArticleCandidates, error: countErr } = await admin
      .from("episode_article_candidates")
      .select("id", { count: "exact", head: true });
    if (countErr) throw countErr;

    const progress = {
      last_run_at: new Date().toISOString(),
      parser_policy: "regex_xml_no_domparser_v2",
      source_cursor: sources.length ? (sourceIdx + sourcesPerRun) % sources.length : 0,
      processed_outlet: activeSources[0]?.outlet || null,
      processed_outlets: activeSources.map((source) => source.outlet),
      sources_per_run: sourcesPerRun,
      scanned_articles: scannedArticles,
      scanned_episodes: scannedEpisodes,
      selected_candidates: selectedCandidates,
      confirmed_candidates: confirmedCandidates,
      upserted_by_outlet: inserted,
      verified_upsert_rows: verifiedUpsertRows,
      total_article_candidates: totalArticleCandidates || 0,
      best_rejected_scores: bestRejectedScores.sort((a, b) => b.score - a.score).slice(0, 12),
      source_diagnostics: sourceDiagnostics,
      runtime_pattern_policy: "brand_anchor_no_topic_words_v2",
      blocked_generic_patterns_filtered: blockedGenericPatternsFiltered,
      runtime_ms: Date.now() - startedAt,
      policy: "publisher_article_match_v1",
    };
    await admin.from("app_settings").upsert({
      key: "episode_article_pairer_progress",
      value: progress,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return progress;
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}${e.stack ? ` :: ${e.stack.split("\n").slice(0, 3).join(" | ")}` : ""}` : String(e);
    console.error("episode-article-pairer error:", msg);
    try {
      await admin.from("app_settings").upsert({
        key: "episode_article_pairer_progress",
        value: { last_run_at: new Date().toISOString(), parser_policy: "regex_xml_no_domparser_v2", error: msg, runtime_ms: Date.now() - startedAt },
        updated_at: new Date().toISOString(),
      }, { onConflict: "key" });
    } catch (_) { /* swallow */ }
    return { ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const guard = await checkBackgroundJobsAllowed(admin, "episode-article-pairer");
  if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });
  const body = await req.json().catch(() => ({}));
  const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "episode_article_pairer_controls").maybeSingle();
  const ctrl = (ctrlRow?.value || {}) as Record<string, unknown>;
  if (ctrl.enabled === false && !body.force) return json({ ok: true, paused: true });

  // Run heavy work in background to avoid WORKER_RESOURCE_LIMIT on sync responses.
  // @ts-ignore EdgeRuntime is supabase edge runtime global
  if (typeof EdgeRuntime !== "undefined" && EdgeRuntime?.waitUntil) {
    // @ts-ignore
    EdgeRuntime.waitUntil(runPairer(admin, body, ctrl, startedAt));
    return json({ ok: true, dispatched: true, parser_policy: "regex_xml_no_domparser_v2" });
  }
  const result = await runPairer(admin, body, ctrl, startedAt);
  return json({ ok: true, ...result });
});
