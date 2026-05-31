// language-cleanup-runner: cascades deletion of podcasts that have been classified
// as confirmed non-Hungarian. Writes a row to podcast_language_cleanup_log per podcast
// with full per-table delete counts BEFORE removing data. Safe to re-run; only
// touches podcasts whose `language_decision` is a known foreign rejection.
//
// Body:
//   { dry_run?: boolean (default true), limit?: number (default 200),
//     podcast_ids?: string[] (override: only delete these IDs if they are
//     classified non-Hungarian) }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FOREIGN_DELETE_DECISIONS = ["reject_foreign", "confirmed_foreign", "reject_non_hungarian"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dry_run !== false;
    const limit = Math.max(1, Math.min(2000, Number(body?.limit) || 200));
    const explicitIds: string[] | null = Array.isArray(body?.podcast_ids) ? body.podcast_ids : null;

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let q = admin.from("podcasts").select("id, title, rss_url, detected_language, hungarian_score, foreign_score, language_evidence, language_rejection_reason, language_decision")
      .in("language_decision", FOREIGN_DELETE_DECISIONS)
      .limit(limit);
    if (explicitIds && explicitIds.length) q = q.in("id", explicitIds);
    const { data: targets, error } = await q;
    if (error) throw error;

    const summary = {
      ok: true,
      dry_run: dryRun,
      scanned: targets?.length || 0,
      podcasts_deleted: 0,
      episodes_deleted: 0,
      episode_embeddings_deleted: 0,
      podcast_embeddings_deleted: 0,
      chunks_deleted: 0,
      transcripts_deleted: 0,
      clean_text_deleted: 0,
      ai_jobs_deleted: 0,
      staging_deleted: 0,
      discovery_deleted: 0,
      youtube_links_deleted: 0,
      youtube_candidates_deleted: 0,
      details: [] as any[],
      elapsed_ms: 0,
    };

    for (const t of (targets || [])) {
      // Gather counts first (always)
      const counts = await Promise.all([
        admin.from("episodes").select("id", { count: "exact", head: true }).eq("podcast_id", t.id),
        admin.from("episode_embeddings").select("episode_id", { count: "exact", head: true }).eq("podcast_id", t.id),
        admin.from("podcast_embeddings").select("podcast_id", { count: "exact", head: true }).eq("podcast_id", t.id),
      ]);
      const epCount = counts[0].count || 0;
      const epEmbCount = counts[1].count || 0;
      const podEmbCount = counts[2].count || 0;

      const detail: any = {
        podcast_id: t.id, title: t.title, rss_url: t.rss_url,
        will_delete_episodes: epCount,
        will_delete_embeddings: epCount + epEmbCount + podEmbCount,
      };

      if (dryRun) { summary.details.push(detail); continue; }

      // Collect episode IDs for FK cleanup of episode-scoped tables
      const { data: eps } = await admin.from("episodes").select("id").eq("podcast_id", t.id).limit(50000);
      const epIds = (eps || []).map((e: any) => e.id);

      const aiJobsPod = await admin.from("ai_enrichment_jobs").delete({ count: "exact" }).eq("target_type", "podcast").eq("target_id", t.id);
      let aiJobsEp = { count: 0 } as any;
      if (epIds.length) aiJobsEp = await admin.from("ai_enrichment_jobs").delete({ count: "exact" }).eq("target_type", "episode").in("target_id", epIds);

      const chunks = await admin.from("episode_chunks").delete({ count: "exact" }).eq("podcast_id", t.id);
      const epEmb  = await admin.from("episode_embeddings").delete({ count: "exact" }).eq("podcast_id", t.id);
      let epClean  = { count: 0 } as any;
      if (epIds.length) epClean = await admin.from("episode_clean_text").delete({ count: "exact" }).in("episode_id", epIds);
      const trans  = await admin.from("episode_transcripts").delete({ count: "exact" }).eq("podcast_id", t.id);
      const yt     = await admin.from("episode_youtube_links").delete({ count: "exact" }).eq("podcast_id", t.id);
      const podEmb = await admin.from("podcast_embeddings").delete({ count: "exact" }).eq("podcast_id", t.id);
      const podYt  = await admin.from("podcast_youtube_candidates").delete({ count: "exact" }).eq("podcast_id", t.id);
      await admin.from("podcast_boilerplate_blocks").delete().eq("podcast_id", t.id);
      await admin.from("rss_url_history").delete().eq("podcast_id", t.id);
      const eps2   = await admin.from("episodes").delete({ count: "exact" }).eq("podcast_id", t.id);
      if (t.rss_url) {
        const st = await admin.from("pi_feed_staging").delete({ count: "exact" }).eq("rss_url", t.rss_url);
        const dq = await admin.from("discovery_queue").delete({ count: "exact" }).eq("rss_url", t.rss_url);
        summary.staging_deleted += st.count || 0;
        summary.discovery_deleted += dq.count || 0;
      }

      // Write audit log BEFORE removing the podcast row
      await admin.from("podcast_language_cleanup_log").insert({
        podcast_id: t.id,
        title: t.title,
        rss_url: t.rss_url,
        detected_language: t.detected_language,
        hungarian_score: t.hungarian_score,
        foreign_score: t.foreign_score,
        deletion_reason: t.language_rejection_reason || t.language_decision || "non_hungarian",
        deleted_related_episode_count: eps2.count || 0,
        deleted_embedding_count: (epEmb.count || 0) + (podEmb.count || 0),
        deleted_ai_job_count: (aiJobsPod.count || 0) + (aiJobsEp.count || 0),
        evidence: t.language_evidence || {},
      });
      const podDel = await admin.from("podcasts").delete({ count: "exact" }).eq("id", t.id);

      summary.podcasts_deleted          += podDel.count || 0;
      summary.episodes_deleted          += eps2.count || 0;
      summary.episode_embeddings_deleted += epEmb.count || 0;
      summary.podcast_embeddings_deleted += podEmb.count || 0;
      summary.chunks_deleted            += chunks.count || 0;
      summary.transcripts_deleted       += trans.count || 0;
      summary.clean_text_deleted        += epClean.count || 0;
      summary.ai_jobs_deleted           += (aiJobsPod.count || 0) + (aiJobsEp.count || 0);
      summary.youtube_links_deleted     += yt.count || 0;
      summary.youtube_candidates_deleted += podYt.count || 0;
      summary.details.push({ ...detail, deleted: true });
    }

    summary.elapsed_ms = Date.now() - started;
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message || JSON.stringify(e);
    console.error("language-cleanup-runner error:", msg, e);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
