// Shared ingestion-time gate: classifies a podcast candidate using the heuristic
// HU classifier and returns the decision-shaped fields ready to apply to a
// `podcasts` row (or to skip insertion).
//
// Callers MUST honour the return value:
//   - 'reject_foreign'  → do NOT insert; optionally log to podcast_language_cleanup_log
//   - 'review_uncertain'→ insert with is_hungarian=false, decision=review_uncertain
//                         and enqueue into podcast_language_review_queue
//   - 'accept_hungarian'→ insert with is_hungarian=true,  decision=accept_hungarian
import { classifyHungarianPodcastCandidate, LanguageCandidate, LanguageResult } from "./hu-language-classifier.ts";

export interface GateApplyFields {
  is_hungarian: boolean;
  language_decision: "accept_hungarian" | "review_uncertain" | "reject_foreign";
  hungarian_score: number;
  foreign_score: number;
  detected_language: string;
  language_checked_at: string;
  language_evidence: Record<string, unknown>;
  language_rejection_reason: string | null;
}

export function runHuIngestionGate(c: LanguageCandidate): { result: LanguageResult; fields: GateApplyFields } {
  const result = classifyHungarianPodcastCandidate(c);
  const isHu = result.language_decision === "accept_hungarian";
  return {
    result,
    fields: {
      is_hungarian: isHu,
      language_decision: result.language_decision,
      hungarian_score: result.hungarian_score,
      foreign_score: result.foreign_score,
      detected_language: result.detected_language,
      language_checked_at: new Date().toISOString(),
      language_evidence: result.evidence,
      language_rejection_reason: result.rejection_reason,
    },
  };
}

// Helper: enqueue a review-uncertain podcast for manual review (admin gate page)
export async function enqueueLanguageReview(admin: any, podcastRow: { id: string; title?: string|null; rss_url?: string|null; website_url?: string|null }, result: LanguageResult) {
  try {
    await admin.from("podcast_language_review_queue").upsert({
      podcast_id: podcastRow.id,
      title: podcastRow.title,
      rss_url: podcastRow.rss_url,
      website_url: podcastRow.website_url,
      detected_language: result.detected_language,
      hungarian_score: result.hungarian_score,
      foreign_score: result.foreign_score,
      reason: result.rejection_reason || "review_uncertain",
      evidence: result.evidence,
      status: "pending",
    }, { onConflict: "podcast_id" });
  } catch (e) {
    console.error("enqueueLanguageReview failed:", e);
  }
}

// Helper: log a foreign rejection that was prevented at ingestion time
// (no podcast row was inserted). Uses podcast_language_cleanup_log with podcast_id=null.
export async function logIngestionRejection(admin: any, candidate: { title?: string|null; rss_url?: string|null }, result: LanguageResult, source: string) {
  try {
    await admin.from("podcast_language_cleanup_log").insert({
      podcast_id: null,
      title: candidate.title || null,
      rss_url: candidate.rss_url || null,
      detected_language: result.detected_language,
      hungarian_score: result.hungarian_score,
      foreign_score: result.foreign_score,
      deletion_reason: `ingestion_reject:${source}:${result.rejection_reason || "foreign"}`,
      deleted_related_episode_count: 0,
      deleted_embedding_count: 0,
      deleted_ai_job_count: 0,
      evidence: result.evidence,
    });
  } catch (e) {
    console.error("logIngestionRejection failed:", e);
  }
}
