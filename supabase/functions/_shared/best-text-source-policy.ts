// Best processing-text source policy (pure, testable).
//
// Episode metadata/clean text stays on the compact RSS description unless it is
// thin. A full transcript replaces RSS only when the RSS has little real content
// (after link/CTA stripping); otherwise the transcript is only recorded as
// `transcript_available` evidence so a separate, rights-aware transcript index
// can use it later. Transcripts are rss_public_index_only: never public display.
import { conservativeRescueClean } from "./clean-text-validation.ts";
import { compareYoutubeGain, type YoutubeGain } from "./youtube-source-gain.ts";

export const BEST_SOURCE_POLICY_VERSION = "best_text_source_v5_youtube_informative_gain";
export const TRANSCRIPT_ALLOWED_RIGHTS = new Set(["rss_public_index_only", "licensed", "owned"]);

export type EpisodeRow = {
  id: string;
  podcast_id: string;
  title: string | null;
  description: string | null;
  updated_at?: string | null;
};

export function textQuality(text: string): { score: number; dirty: string[]; len: number } {
  const raw = String(text || "").trim();
  const dirty: string[] = [];
  if (/https?:\/\/|www\.|(?:open\.)?spotify\.com|podcasts\.apple\.com|youtube\.com|youtu\.be|instagram\.com|facebook\.com|tiktok\.com|patreon\.com|linktr\.ee/i.test(raw)) dirty.push("links");
  if (/@[A-Za-z0-9_.-]+/.test(raw)) dirty.push("handles");
  if (/^\s*(?:instagram|facebook|youtube|spotify|apple podcasts?|tiktok)\s*[:：-]/im.test(raw)) dirty.push("platform_lines");
  const len = raw.length;
  const lengthScore = len >= 900 ? 1 : len >= 500 ? 0.85 : len >= 220 ? 0.62 : len >= 80 ? 0.35 : len > 0 ? 0.15 : 0;
  return { score: Math.max(0, lengthScore - dirty.length * 0.12), dirty, len };
}

export function transcriptRank(model: string): number {
  if (model === "supadata-youtube") return 100;
  if (model === "spotify-native") return 96;
  if (model === "rss_audio_asr") return 92;
  if (model.startsWith("rss_podcast_transcript_tag:")) return 88;
  if (model === "supadata-youtube-asr") return 84;
  return 70;
}

/** Length of real content after removing links, handles, hashtag walls and CTA lines. */
export function contentLength(text: string): number {
  return conservativeRescueClean(String(text || "")).text.length;
}

export function pickBest(ep: EpisodeRow, spotify: any | null, youtube: any | null, article: any | null, transcript: any | null, ctrl: any, ctx: { recurring?: Set<string> | null } = {}) {
  const gain = Number(ctrl.prefer_external_gain_chars ?? 150);
  const articleGain = Number(ctrl.article_prefer_gain_chars ?? 300);
  const ytMin = Number(ctrl.youtube_min_confidence ?? 0.78);
  const spMin = Number(ctrl.spotify_min_confidence ?? 0.55);
  const articleMin = Number(ctrl.article_min_confidence ?? 0.82);
  const transcriptMinChars = Number(ctrl.transcript_min_chars ?? 900);
  const transcriptThinRssChars = Number(ctrl.transcript_replace_max_rss_content_chars ?? 400);
  const rssText = String(ep.description || "").trim();
  const rssQ = textQuality(rssText);
  const rssContentLen = contentLength(rssText);
  const candidates: any[] = [];

  const transcriptText = String(transcript?.transcript || "").trim();
  const transcriptQ = textQuality(transcriptText);
  const transcriptModel = String(transcript?.model || "");
  const transcriptRights = String(transcript?.rights_status || "rss_public_index_only");
  const transcriptUsable = !!transcriptText
    && transcript?.status === "ok"
    && transcriptText.length >= transcriptMinChars
    && transcriptQ.score >= 0.45
    && TRANSCRIPT_ALLOWED_RIGHTS.has(transcriptRights);
  const transcriptAvailable = transcriptUsable
    ? {
      transcript_id: transcript.id,
      transcript_model: transcriptModel,
      transcript_len: transcriptQ.len,
      content_hash: transcript.content_hash || null,
      rights_status: transcriptRights,
      public_display: false,
    }
    : null;

  if (rssText) {
    candidates.push({
      source_type: "rss",
      source_ref_id: null,
      raw_text: rssText,
      source_confidence: 0.65 + rssQ.score * 0.25,
      reasons: ["rss_description"],
      quality: rssQ,
      evidence: { rss_len: rssQ.len, rss_content_len: rssContentLen, dirty: rssQ.dirty, transcript_available: transcriptAvailable },
    });
  }

  // Transcript replaces the compact description only when the RSS is thin.
  if (transcriptUsable && rssContentLen < transcriptThinRssChars) {
    candidates.push({
      source_type: "transcript",
      source_ref_id: transcript.id,
      raw_text: transcriptText,
      source_confidence: Math.min(0.99, 0.78 + transcriptQ.score * 0.12 + transcriptRank(transcriptModel) / 1000),
      reasons: ["transcript_rss_thin_fallback"],
      quality: transcriptQ,
      evidence: {
        transcript_model: transcriptModel,
        transcript_source: transcript.source || null,
        transcript_language: transcript.language || null,
        transcript_len: transcriptQ.len,
        rss_len: rssQ.len,
        rss_content_len: rssContentLen,
        content_hash: transcript.content_hash || null,
        rights_status: transcriptRights,
        public_display: false,
        // The incremental runner does not load segments (memory); null = not inspected.
        has_segments: Array.isArray(transcript.segments) ? transcript.segments.length > 0 : null,
        segment_count: Array.isArray(transcript.segments) ? transcript.segments.length : null,
        dirty: transcriptQ.dirty,
      },
    });
  }

  const articleText = String(article?.article_text || article?.article_excerpt || "").trim();
  const articleScore = Number(article?.match_score || 0);
  const articleQ = textQuality(articleText);
  if (
    articleText
    && article?.status === "confirmed"
    && articleScore >= articleMin
    // A short RSS is only replaced by an article that actually adds text.
    && (articleQ.len >= rssQ.len + articleGain || (rssQ.len < 220 && articleQ.len > rssQ.len))
  ) {
    candidates.push({
      source_type: "article",
      source_ref_id: article.id,
      raw_text: articleText,
      source_confidence: Math.min(0.97, 0.64 + articleScore * 0.25 + articleQ.score * 0.08),
      reasons: ["confirmed_publisher_article_longer_or_rss_short"],
      quality: articleQ,
      evidence: {
        article_match_score: articleScore,
        article_url: article.article_url,
        article_title: article.article_title,
        article_len: articleQ.len,
        rss_len: rssQ.len,
        outlet: article.outlet,
        match_reasons: article.match_reasons || [],
        article_evidence: article.evidence || {},
        dirty: articleQ.dirty,
        transcript_available: transcriptAvailable,
      },
    });
  }

  const spText = String(spotify?.spotify_description || spotify?.spotify_html_description || "").trim();
  const spConfidence = Number(spotify?.match_confidence || 0);
  const spQ = textQuality(spText);
  if (spText && spConfidence >= spMin && (spQ.len >= rssQ.len + gain || rssQ.len < 120)) {
    candidates.push({
      source_type: "spotify",
      source_ref_id: spotify.id,
      raw_text: spText,
      source_confidence: Math.min(0.92, 0.58 + spConfidence * 0.25 + spQ.score * 0.15),
      reasons: ["spotify_longer_or_rss_short"],
      quality: spQ,
      evidence: {
        spotify_match_confidence: spConfidence,
        spotify_len: spQ.len,
        rss_len: rssQ.len,
        match_method: spotify.match_method,
        dirty: spQ.dirty,
        transcript_available: transcriptAvailable,
      },
    });
  }

  const ytText = String(youtube?.youtube_description || "").trim();
  const ytConfidence = Number(youtube?.match_score || 0);
  const ytQ = textQuality(ytText);
  // Only a verified (v3, confirmed, high-score) match is compared at all.
  const ytVerified = !!ytText
    && youtube?.status === "confirmed"
    && youtube?.validation_reason?.policy === "youtube_episode_match_v3"
    && ytConfidence >= ytMin;
  const ytGain: YoutubeGain | null = ytVerified ? compareYoutubeGain(rssText, ytText, { ...(ctrl.youtube_gain || {}), recurring: ctx.recurring || null }) : null;
  if (ytGain && ytGain.decision === "youtube_better") {
    candidates.push({
      source_type: "youtube",
      source_ref_id: youtube.id,
      raw_text: ytText,
      source_confidence: Math.min(0.98, 0.62 + ytConfidence * 0.25 + ytQ.score * 0.13),
      reasons: ["confirmed_youtube_informative_gain", ...ytGain.reasons],
      quality: ytQ,
      preferred_over_rss: true,
      evidence: {
        youtube_match_score: ytConfidence,
        youtube_confidence: youtube.confidence,
        youtube_status: youtube.status,
        youtube_len: ytQ.len,
        rss_len: rssQ.len,
        youtube_gain: ytGain,
        validation_reason: youtube.validation_reason || {},
        dirty: ytQ.dirty,
        transcript_available: transcriptAvailable,
      },
    });
  }
  // Log the YouTube decision on every candidate, so a kept RSS records why.
  if (ytGain) for (const c of candidates) if (c.source_type !== "youtube") c.evidence = { ...c.evidence, youtube_gain: ytGain };

  if (!candidates.length) return null;
  const score = (c: any) => c.source_confidence + Math.min(0.12, c.quality.len / 12000);
  const sorted = candidates.sort((a, b) => score(b) - score(a));
  // A verified informative YouTube gain beats RSS and a (thin-RSS) transcript;
  // only a confirmed publisher article that scores higher may still win.
  const yt = sorted.find((c) => c.preferred_over_rss);
  if (yt && sorted[0] !== yt && sorted[0].source_type !== "article") return yt;
  return sorted[0];
}

/** Stable identity of a selected source; unchanged fingerprint → no rewrite, no re-clean. */
export async function sourceFingerprint(best: { source_type: string; source_ref_id: string | null; raw_text: string; evidence?: any }): Promise<string> {
  const contentHash = best.evidence?.content_hash || "";
  const avail = best.evidence?.transcript_available?.content_hash || "";
  const basis = `${BEST_SOURCE_POLICY_VERSION}|${best.source_type}|${best.source_ref_id || ""}|${contentHash}|${avail}|${best.raw_text}`;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(basis));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Only a change of the selected processing text requires a re-clean. */
export function needsReclean(prev: { source_type?: string | null; raw_text?: string | null } | null, next: { source_type: string; raw_text: string }): boolean {
  if (!prev) return next.source_type !== "rss";
  return prev.source_type !== next.source_type || String(prev.raw_text || "").trim() !== String(next.raw_text || "").trim();
}
