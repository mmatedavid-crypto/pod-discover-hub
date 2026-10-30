import { denyUntrustedCaller } from "../_shared/internal-auth.ts";
// language-cleanup-runner: cascades deletion of podcasts that have been classified
// as confirmed non-Hungarian. Writes a row to podcast_language_cleanup_log per podcast
// with full per-table delete counts BEFORE removing data. Safe to re-run; only
// touches podcasts whose `language_decision` is a known foreign rejection.
//
// Body:
//   { dry_run?: boolean (default true), limit?: number (default 200),
//     podcast_ids?: string[] (override: only delete these IDs if they are
//     classified non-Hungarian),
//     block_feed?: boolean (default false) — owner-confirmed permanent deletion:
//     the feed URL goes into podcast_feed_blocklist so it can never be imported again }
//
// Only the service role (internal callers) or a signed-in admin may call this.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { feedBlocklistKey } from "../_shared/feed-blocklist.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const FOREIGN_DELETE_DECISIONS = ["reject_foreign", "confirmed_foreign", "reject_non_hungarian"];

// Episode-scoped tables without a cascading foreign key (would otherwise keep orphans).
const EPISODE_ORPHAN_TABLES = [
  "episode_derivation_state", "episode_organization_map", "episode_source_change_queue",
  "episode_spotify_meta", "episode_best_source_spotify_queue", "episode_best_source_youtube_queue",
  "episode_chapters", "episode_embedding_skips", "episode_topic_slug_map",
  "person_extractor_episode_inputs", "clean_text_repair_queue", "episode_clean_text_quarantine",
  "episode_transcript_lexical_chunks",
];
const PODCAST_ORPHAN_TABLES = ["podcast_language_review_queue", "podcast_embedding_failures"];

function sameToken(a: string, b: string) {
  if (a.length < 32 || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
async function authorized(admin: any, req: Request) {
  const given = req.headers.get("x-internal-token") || "";
  if (given) {
    const { data } = await admin.from("internal_job_tokens").select("token").eq("job", "language-cleanup-runner").maybeSingle();
    if (sameToken(String(data?.token || ""), given)) return true;
  }
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return false;
  if (jwt === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: u } = await admin.auth.getUser(jwt).catch(() => ({ data: null as any }));
  if (!u?.user?.id) return false;
  const { data: role } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!role;
}

function chunks<T>(a: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += n) out.push(a.slice(i, i + n));
  return out;
}

Deno.serve(async (req) => {
  { const denied = await denyUntrustedCaller(req, "language-cleanup-runner"); if (denied) return denied; }
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const started = Date.now();
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  if (!(await authorized(admin, req))) {
    return new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const dryRun = body?.dry_run !== false;
    const blockFeed = body?.block_feed === true;
    const blockReason = String(body?.block_reason || "owner_confirmed_non_hungarian").slice(0, 200);
    const limit = Math.max(1, Math.min(2000, Number(body?.limit) || 200));
    const explicitIds: string[] | null = Array.isArray(body?.podcast_ids) ? body.podcast_ids : null;

    let q = admin.from("podcasts").select("id, title, rss_url, detected_language, hungarian_score, foreign_score, language_evidence, language_rejection_reason, language_decision")
      .in("language_decision", FOREIGN_DELETE_DECISIONS)
      .limit(limit);
    if (explicitIds && explicitIds.length) q = q.in("id", explicitIds);
    const { data: targets, error } = await q;
    if (error) throw error;

    const summary = {
      ok: true,
      dry_run: dryRun,
      block_feed: blockFeed,
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
      orphan_rows_deleted: 0,
      feeds_blocked: 0,
      errors: [] as string[],
      details: [] as any[],
      elapsed_ms: 0,
    };

    for (const t of (targets || [])) {
      const counts = await Promise.all([
        admin.from("episodes").select("id", { count: "exact", head: true }).eq("podcast_id", t.id),
        admin.from("episode_embeddings").select("episode_id", { count: "exact", head: true }).eq("podcast_id", t.id),
        admin.from("podcast_embeddings").select("podcast_id", { count: "exact", head: true }).eq("podcast_id", t.id),
      ]);
      const epCount = counts[0].count || 0;
      const detail: any = {
        podcast_id: t.id, title: t.title, rss_url: t.rss_url,
        will_delete_episodes: epCount,
        will_delete_embeddings: (counts[1].count || 0) + (counts[2].count || 0),
      };

      if (dryRun) { summary.details.push(detail); continue; }

      // Block the feed first: if anything below fails, the show still cannot come back.
      if (blockFeed && t.rss_url) {
        const { error: bErr } = await admin.from("podcast_feed_blocklist").upsert({
          rss_url_key: feedBlocklistKey(t.rss_url), rss_url: t.rss_url, title: t.title,
          reason: blockReason, blocked_by: "language-cleanup-runner",
        }, { onConflict: "rss_url_key" });
        if (bErr) { summary.errors.push(`${t.id}:block:${bErr.message}`); continue; }
        summary.feeds_blocked++;
      }

      const { data: eps } = await admin.from("episodes").select("id").eq("podcast_id", t.id).limit(50000);
      const epIds = (eps || []).map((e: any) => e.id);
      const epBatches = chunks(epIds, 150);

      const aiJobsPod = await admin.from("ai_enrichment_jobs").delete({ count: "exact" }).eq("target_type", "podcast").eq("target_id", t.id);
      let aiJobsEp = 0, epClean = 0;
      for (const b of epBatches) {
        aiJobsEp += (await admin.from("ai_enrichment_jobs").delete({ count: "exact" }).eq("target_type", "episode").in("target_id", b)).count || 0;
        epClean += (await admin.from("episode_clean_text").delete({ count: "exact" }).in("episode_id", b)).count || 0;
        for (const table of EPISODE_ORPHAN_TABLES) {
          const r = await admin.from(table).delete({ count: "exact" }).in("episode_id", b);
          if (r.error) summary.errors.push(`${table}:${r.error.message}`.slice(0, 160));
          else summary.orphan_rows_deleted += r.count || 0;
        }
      }
      for (const table of PODCAST_ORPHAN_TABLES) {
        const r = await admin.from(table).delete({ count: "exact" }).eq("podcast_id", t.id);
        if (r.error) summary.errors.push(`${table}:${r.error.message}`.slice(0, 160));
        else summary.orphan_rows_deleted += r.count || 0;
      }

      const chunksDel = await admin.from("episode_chunks").delete({ count: "exact" }).eq("podcast_id", t.id);
      const epEmb  = await admin.from("episode_embeddings").delete({ count: "exact" }).eq("podcast_id", t.id);
      const trans  = await admin.from("episode_transcripts").delete({ count: "exact" }).eq("podcast_id", t.id);
      const yt     = await admin.from("episode_youtube_links").delete({ count: "exact" }).eq("podcast_id", t.id);
      const podEmb = await admin.from("podcast_embeddings").delete({ count: "exact" }).eq("podcast_id", t.id);
      const podYt  = await admin.from("podcast_youtube_candidates").delete({ count: "exact" }).eq("podcast_id", t.id);
      await admin.from("podcast_boilerplate_blocks").delete().eq("podcast_id", t.id);
      await admin.from("rss_url_history").delete().eq("podcast_id", t.id);
      const eps2   = await admin.from("episodes").delete({ count: "exact" }).eq("podcast_id", t.id);
      if (eps2.error) { summary.errors.push(`${t.id}:episodes:${eps2.error.message}`.slice(0, 200)); continue; }
      if (t.rss_url) {
        const st = await admin.from("pi_feed_staging").delete({ count: "exact" }).eq("rss_url", t.rss_url);
        const dq = await admin.from("discovery_queue").delete({ count: "exact" }).eq("rss_url", t.rss_url);
        summary.staging_deleted += st.count || 0;
        summary.discovery_deleted += dq.count || 0;
      }

      // Audit log BEFORE removing the podcast row
      await admin.from("podcast_language_cleanup_log").insert({
        podcast_id: t.id,
        title: t.title,
        rss_url: t.rss_url,
        detected_language: t.detected_language,
        hungarian_score: t.hungarian_score,
        foreign_score: t.foreign_score,
        deletion_reason: blockFeed ? `${blockReason}:feed_blocked` : (t.language_rejection_reason || t.language_decision || "non_hungarian"),
        deleted_related_episode_count: eps2.count || 0,
        deleted_embedding_count: (epEmb.count || 0) + (podEmb.count || 0),
        deleted_ai_job_count: (aiJobsPod.count || 0) + aiJobsEp,
        evidence: t.language_evidence || {},
      });
      const podDel = await admin.from("podcasts").delete({ count: "exact" }).eq("id", t.id);
      if (podDel.error) { summary.errors.push(`${t.id}:podcast:${podDel.error.message}`.slice(0, 200)); continue; }

      summary.podcasts_deleted          += podDel.count || 0;
      summary.episodes_deleted          += eps2.count || 0;
      summary.episode_embeddings_deleted += epEmb.count || 0;
      summary.podcast_embeddings_deleted += podEmb.count || 0;
      summary.chunks_deleted            += chunksDel.count || 0;
      summary.transcripts_deleted       += trans.count || 0;
      summary.clean_text_deleted        += epClean;
      summary.ai_jobs_deleted           += (aiJobsPod.count || 0) + aiJobsEp;
      summary.youtube_links_deleted     += yt.count || 0;
      summary.youtube_candidates_deleted += podYt.count || 0;
      summary.details.push({ ...detail, deleted: true });
      if (Date.now() - started > 120_000) break;
    }

    summary.elapsed_ms = Date.now() - started;
    return new Response(JSON.stringify(summary, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    const msg = e?.message || JSON.stringify(e);
    console.error("language-cleanup-runner error:", msg, e);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
