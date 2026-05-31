// Matches publisher article pages to podcast episodes.
// Conservative by design: only configured outlet feeds are read, and only high
// title/date/token agreement becomes confirmed evidence for best-text-source.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type SourceConfig = {
  outlet: string;
  feed_urls: string[];
  podcast_title_patterns?: string[];
};

type ArticleItem = {
  outlet: string;
  url: string;
  title: string;
  excerpt: string;
  text: string;
  published_at: string | null;
};

type EpisodeRow = {
  id: string;
  podcast_id: string;
  title: string | null;
  display_title: string | null;
  description: string | null;
  published_at: string | null;
  podcasts?: { title?: string | null; display_title?: string | null } | { title?: string | null; display_title?: string | null }[];
};

const STOPWORDS = new Set([
  "a", "az", "egy", "és", "hogy", "mit", "mi", "ez", "ezt", "de", "ha", "is", "nem", "van", "volt", "lesz",
  "podcast", "adás", "epizód", "rész", "telex", "444", "after", "video", "videó",
]);

function stripHtml(input: string): string {
  return String(input || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(input: string): string {
  return String(input || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(input: string): string[] {
  return normalize(input)
    .split(" ")
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

function tokenScore(a: string, b: string) {
  const aa = new Set(tokens(a));
  const bb = new Set(tokens(b));
  if (!aa.size || !bb.size) return { score: 0, shared: [] as string[] };
  const shared = Array.from(aa).filter((t) => bb.has(t));
  return { score: shared.length / Math.max(aa.size, bb.size), shared };
}

function dateScore(epDate?: string | null, articleDate?: string | null): number {
  if (!epDate || !articleDate) return 0.35;
  const diffDays = Math.abs(new Date(epDate).getTime() - new Date(articleDate).getTime()) / 86_400_000;
  if (diffDays <= 1) return 1;
  if (diffDays <= 3) return 0.82;
  if (diffDays <= 7) return 0.58;
  if (diffDays <= 14) return 0.32;
  return 0;
}

function podcastTitle(ep: EpisodeRow): string {
  const p = Array.isArray(ep.podcasts) ? ep.podcasts[0] : ep.podcasts;
  return p?.display_title || p?.title || "";
}

function scoreMatch(ep: EpisodeRow, article: ArticleItem) {
  const epTitle = ep.display_title || ep.title || "";
  const articleHay = `${article.title} ${article.excerpt} ${article.text.slice(0, 1200)}`;
  const title = tokenScore(epTitle, article.title);
  const body = tokenScore(epTitle, articleHay);
  const date = dateScore(ep.published_at, article.published_at);
  const podcast = podcastTitle(ep);
  const podcastMention = podcast && normalize(articleHay).includes(normalize(podcast).slice(0, 24)) ? 0.08 : 0;
  const score = Math.min(1, title.score * 0.55 + body.score * 0.25 + date * 0.18 + podcastMention);
  const reasons = [
    title.score >= 0.45 ? "title_token_match" : null,
    body.score >= 0.35 ? "article_body_token_match" : null,
    date >= 0.82 ? "published_near_episode" : null,
    podcastMention ? "podcast_mentioned" : null,
  ].filter(Boolean) as string[];
  return { score, reasons, shared_title_tokens: title.shared, shared_body_tokens: body.shared.slice(0, 20), date_score: date };
}

function parseFeed(xml: string, outlet: string): ArticleItem[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const entries = Array.from(doc.querySelectorAll("item, entry")).slice(0, 200);
  return entries.map((el) => {
    const title = stripHtml(el.querySelector("title")?.textContent || "");
    const link =
      el.querySelector("link")?.textContent?.trim() ||
      el.querySelector("link[href]")?.getAttribute("href") ||
      "";
    const excerpt = stripHtml(
      el.querySelector("description")?.textContent ||
      el.querySelector("summary")?.textContent ||
      "",
    );
    const content = stripHtml(
      el.querySelector("encoded")?.textContent ||
      el.querySelector("content")?.textContent ||
      excerpt,
    );
    const dateText =
      el.querySelector("pubDate")?.textContent ||
      el.querySelector("published")?.textContent ||
      el.querySelector("updated")?.textContent ||
      "";
    const date = dateText ? new Date(dateText) : null;
    return {
      outlet,
      url: link,
      title,
      excerpt,
      text: content,
      published_at: date && !Number.isNaN(date.getTime()) ? date.toISOString() : null,
    };
  }).filter((item) => item.url && item.title);
}

async function fetchArticleText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "PodiverzumBot/1.0" } });
  if (!res.ok) return "";
  const html = await res.text();
  const articleMatch = html.match(/<article[\s\S]*?<\/article>/i)?.[0] || "";
  const main = articleMatch || html.match(/<main[\s\S]*?<\/main>/i)?.[0] || html;
  return stripHtml(main).slice(0, 18000);
}

async function fetchFeedItems(source: SourceConfig, ctrl: Record<string, unknown>): Promise<ArticleItem[]> {
  const out: ArticleItem[] = [];
  const limit = Math.max(10, Math.min(200, Number(ctrl.article_feed_item_limit || 80)));
  for (const feedUrl of source.feed_urls || []) {
    try {
      const res = await fetch(feedUrl, { headers: { "User-Agent": "PodiverzumBot/1.0" } });
      if (!res.ok) continue;
      const xml = await res.text();
      out.push(...parseFeed(xml, source.outlet));
    } catch (e) {
      console.error("article feed fetch failed", source.outlet, feedUrl, e);
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const guard = await checkBackgroundJobsAllowed(admin, "episode-article-pairer");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    const body = await req.json().catch(() => ({}));
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "episode_article_pairer_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as Record<string, unknown>;
    if (ctrl.enabled === false && !body.force) return json({ ok: true, paused: true });

    const sources = (Array.isArray(ctrl.sources) ? ctrl.sources : []) as SourceConfig[];
    const limit = Math.max(10, Math.min(500, Number(body.limit || ctrl.batch_limit || 120)));
    const autoConfirm = Number(ctrl.auto_confirm_threshold || 0.82);
    const needsReview = Number(ctrl.needs_review_threshold || 0.68);
    const recentEpisodeDays = Math.max(7, Math.min(365, Number(ctrl.recent_episode_days || 45)));
    const recentArticleDays = Math.max(7, Math.min(365, Number(ctrl.recent_article_days || 60)));
    const fetchArticleHtml = ctrl.fetch_article_html !== false;
    let fetchesLeft = Math.max(0, Math.min(80, Number(ctrl.max_article_fetches_per_run || 25)));

    const inserted: Record<string, number> = {};
    let scannedArticles = 0;
    let scannedEpisodes = 0;

    for (const source of sources) {
      const items = (await fetchFeedItems(source, ctrl)).filter((item) => {
        if (!item.published_at) return true;
        return new Date(item.published_at).getTime() > Date.now() - recentArticleDays * 86_400_000;
      });
      scannedArticles += items.length;
      if (!items.length) continue;

      const patterns = (source.podcast_title_patterns || [source.outlet]).map((p) => `%${p}%`);
      const orFilter = patterns.map((p) => `title.ilike.${p},display_title.ilike.${p}`).join(",");
      const { data: episodes, error: epErr } = await admin
        .from("episodes")
        .select("id,podcast_id,title,display_title,description,published_at,podcasts!inner(title,display_title,is_hungarian,language_decision)")
        .or(orFilter, { foreignTable: "podcasts" })
        .eq("podcasts.is_hungarian", true)
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

        let best: { ep: EpisodeRow; score: ReturnType<typeof scoreMatch> } | null = null;
        for (const ep of (episodes || []) as EpisodeRow[]) {
          const s = scoreMatch(ep, article);
          if (!best || s.score > best.score.score) best = { ep, score: s };
        }
        if (!best || best.score.score < needsReview) continue;

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
            podcast_title: podcastTitle(best.ep),
          },
          fetched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      for (let i = 0; i < candidates.length; i += 100) {
        const chunk = candidates.slice(i, i + 100);
        const { error } = await admin.from("episode_article_candidates").upsert(chunk, { onConflict: "episode_id,article_url" });
        if (error) throw error;
        inserted[source.outlet] = (inserted[source.outlet] || 0) + chunk.length;
      }
    }

    const progress = {
      last_run_at: new Date().toISOString(),
      scanned_articles: scannedArticles,
      scanned_episodes: scannedEpisodes,
      upserted_by_outlet: inserted,
      runtime_ms: Date.now() - startedAt,
      policy: "publisher_article_match_v1",
    };
    await admin.from("app_settings").upsert({
      key: "episode_article_pairer_progress",
      value: progress,
      updated_at: new Date().toISOString(),
    }, { onConflict: "key" });

    return json({ ok: true, ...progress });
  } catch (e) {
    const msg = e instanceof Error ? `${e.message}${e.stack ? ` :: ${e.stack.split("\n").slice(0, 3).join(" | ")}` : ""}` : String(e);
    console.error("episode-article-pairer error:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
