// Language-audit-runner: scans all podcasts, computes language decision using the
// pure-heuristic HU classifier, optionally writes results to DB and to the review queue.
//
// Body:
//   { dry_run?: boolean (default true), limit?: number (default 5000),
//     recheck_after_hours?: number (default 720 — re-classify after 30d) }
//
// Returns counts + sample rejections (dry-run shows what WOULD be done).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { classifyHungarianPodcastCandidate, LanguageResult } from "../_shared/hu-language-classifier.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TIME_BUDGET_MS = 110_000;
const BATCH_SIZE = 200;
const EP_FETCH = 8;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dry_run !== false; // default TRUE for safety
    const limit = Math.max(50, Math.min(20000, Number(body?.limit) || 5000));
    const recheckHours = Math.max(0, Number(body?.recheck_after_hours) || 720);
    const onlyUnchecked = body?.only_unchecked === true;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let q = admin
      .from("podcasts")
      .select("id, title, description, language, rss_url, website_url, category, is_hungarian, language_decision, language_checked_at")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (onlyUnchecked) {
      q = q.is("language_checked_at", null);
    } else if (recheckHours > 0) {
      const cutoff = new Date(Date.now() - recheckHours * 3600_000).toISOString();
      q = q.or(`language_checked_at.is.null,language_checked_at.lt.${cutoff}`);
    }

    const { data: podcasts, error } = await q;
    if (error) throw error;

    let scanned = 0;
    let accepted = 0;
    let rejected = 0;
    let review = 0;
    const sampleRejected: any[] = [];
    const sampleReview: any[] = [];
    const langCounts: Record<string, number> = {};

    for (const p of podcasts || []) {
      if (Date.now() - started > TIME_BUDGET_MS) break;

      // Pull latest episodes for evidence
      const { data: eps } = await admin
        .from("episodes")
        .select("title, description")
        .eq("podcast_id", p.id)
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(EP_FETCH);

      const result: LanguageResult = classifyHungarianPodcastCandidate({
        title: p.title,
        description: p.description,
        author: null,
        rss_language: p.language,
        rss_url: p.rss_url,
        website_url: p.website_url,
        episode_titles: (eps || []).map((e: any) => e.title),
        episode_descriptions: (eps || []).map((e: any) => e.description).slice(0, 4),
        categories: p.category ? [p.category] : [],
      });

      scanned++;
      langCounts[result.detected_language] = (langCounts[result.detected_language] || 0) + 1;
      if (result.language_decision === "accept_hungarian") accepted++;
      else if (result.language_decision === "reject_foreign") {
        rejected++;
        if (sampleRejected.length < 30) sampleRejected.push({
          id: p.id, title: p.title, rss_url: p.rss_url,
          detected: result.detected_language, foreign: result.foreign_score, hu: result.hungarian_score,
          reason: result.rejection_reason,
        });
      } else {
        review++;
        if (sampleReview.length < 30) sampleReview.push({
          id: p.id, title: p.title, rss_url: p.rss_url,
          detected: result.detected_language, foreign: result.foreign_score, hu: result.hungarian_score,
        });
      }

      if (!dryRun) {
        const isHu = result.language_decision === "accept_hungarian";
        await admin.from("podcasts").update({
          language_decision: result.language_decision,
          is_hungarian: isHu,
          hungarian_score: result.hungarian_score,
          foreign_score: result.foreign_score,
          detected_language: result.detected_language,
          language_checked_at: new Date().toISOString(),
          language_evidence: result.evidence,
          language_rejection_reason: result.rejection_reason,
        }).eq("id", p.id);

        if (result.language_decision === "review_uncertain") {
          await admin.from("podcast_language_review_queue").upsert({
            podcast_id: p.id,
            title: p.title,
            rss_url: p.rss_url,
            website_url: p.website_url,
            detected_language: result.detected_language,
            hungarian_score: result.hungarian_score,
            foreign_score: result.foreign_score,
            reason: result.rejection_reason || "review_uncertain",
            evidence: result.evidence,
            status: "pending",
          }, { onConflict: "podcast_id", ignoreDuplicates: false });
        }
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      dry_run: dryRun,
      elapsed_ms: Date.now() - started,
      scanned,
      accepted_hungarian: accepted,
      rejected_foreign: rejected,
      review_uncertain: review,
      detected_language_counts: langCounts,
      sample_rejected: sampleRejected,
      sample_review: sampleReview,
      remaining_in_batch: (podcasts?.length || 0) - scanned,
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    const msg = e?.message || e?.error_description || e?.hint || JSON.stringify(e);
    console.error("language-audit-runner error:", msg, e);
    return new Response(JSON.stringify({ error: msg, raw: e }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
