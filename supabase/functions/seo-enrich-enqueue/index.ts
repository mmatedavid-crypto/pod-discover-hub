// Enqueues podcast + episode SEO enrichment jobs based on ai_seo_controls scope.
// Idempotent (input_hash unique per kind/target).
//
// === Enqueue ordering contract (Formula C v3-safe) ===
// 1. Podcast selection: rank_label IN (S,A,B,C) AND rss_status IN (active,
//    not_checked) AND health_state NOT IN (rss_url_not_found,
//    needs_manual_rss_review, confirmed_dead, quarantined_spam). When
//    require_full_backfill, full_backfill_completed_at must be set.
//    Ordered by podiverzum_rank DESC.
// 2. Job priority is derived from podcast tier: S=100, A=80, B=60, C=40.
//    D/E are excluded entirely.
// 3. Episode ordering inside a podcast: published_at DESC, nullsFirst=false.
// 4. Legacy `episodes.episode_rank` / `episode_rank_label` are intentionally
//    IGNORED — they are frozen outputs of the deprecated `recompute-ranks`
//    function and incompatible with Formula C v3.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { inputHash, podcastUserPrompt, episodeUserPrompt } from "../_shared/seo-prompt.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const TIER_PRIORITY: Record<string, number> = { S: 100, A: 80, B: 60, C: 40 };
const BAD_HEALTH = new Set([
  "rss_url_not_found",
  "needs_manual_rss_review",
  "confirmed_dead",
  "quarantined_spam",
]);

function podPriority(p: any): number {
  const tier = String(p.rank_label || "").toUpperCase();
  if (TIER_PRIORITY[tier] != null) return TIER_PRIORITY[tier];
  // fallback to numeric rank if no label
  const r = Number(p.podiverzum_rank || 0);
  if (r >= 8.5) return 100;
  if (r >= 7.0) return 80;
  if (r >= 5.5) return 60;
  if (r >= 4.0) return 40;
  return 1;
}

function isHealthy(p: any): boolean {
  const hs = p?.shadow_rank_components?.health_state || null;
  if (hs && BAD_HEALTH.has(hs)) return false;
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const __guard = await checkBackgroundJobsAllowed(admin, "seo-enrich-enqueue");
    if (__guard.blocked) return new Response(JSON.stringify({ ok: true, skipped: true, reason: __guard.reason }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    const body = await req.json().catch(() => ({}));
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "ai_seo_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    const minRank = Number(body.min_rank ?? ctrl.min_rank ?? 8);
    const requireBackfill = body.require_full_backfill ?? ctrl.require_full_backfill ?? true;
    const maxPods = Number(body.max_podcasts ?? ctrl.max_podcasts_per_run ?? 50);
    const maxEps = Number(body.max_episodes ?? ctrl.max_episodes_per_run ?? 300);
    // Tiers eligible for enqueue. D/E excluded.
    const allowedTiers: string[] = body.tiers || ctrl.tiers || ["S", "A", "B", "C"];

    // === PASS 1: Podcast SEO enqueue ===
    // Only podcasts that still need SEO. Limited by maxPods.
    let pq = admin.from("podcasts")
      .select("id, title, display_title, description, category, podiverzum_rank, rank_label, shadow_rank_components, full_backfill_completed_at, crawl_state, seo_title, seo_description, rss_status")
      .in("rank_label", allowedTiers)
      .in("rss_status", ["active", "not_checked"])
      .or("seo_title.is.null,seo_description.is.null")
      .order("podiverzum_rank", { ascending: false })
      .limit(maxPods);
    if (requireBackfill) pq = pq.not("full_backfill_completed_at", "is", null);
    const { data: podsRaw, error: pErr } = await pq;
    if (pErr) throw pErr;
    const pods = (podsRaw || []).filter(isHealthy);

    let podJobs = 0;
    for (const p of pods) {
      if (p.seo_title && p.seo_description) continue;
      const prompt = podcastUserPrompt(p as any);
      const hash = await inputHash(prompt);
      const { error } = await admin.from("ai_enrichment_jobs").insert({
        kind: "seo_podcast",
        target_type: "podcast",
        target_id: p.id,
        input_hash: hash,
        priority: podPriority(p),
        status: "pending",
        result: { prompt },
      });
      if (!error) podJobs++;
    }

    // === PASS 2: Episode SEO enqueue (INDEPENDENT of pass 1) ===
    // BUGFIX: previously episodes were restricted to the maxPods set above,
    // which filtered to podcasts still missing SEO. Since podcast SEO is ~92%
    // complete, this starved the episode queue (~590 podcasts only). Now we
    // enqueue episodes from ALL eligible S/A/B/C podcasts independently.
    let epPq = admin.from("podcasts")
      .select("id, title, display_title, podiverzum_rank, rank_label, shadow_rank_components, full_backfill_completed_at, rss_status")
      .in("rank_label", allowedTiers)
      .in("rss_status", ["active", "not_checked"])
      .order("podiverzum_rank", { ascending: false })
      .limit(2000);
    if (requireBackfill) epPq = epPq.not("full_backfill_completed_at", "is", null);
    const { data: epPodsRaw, error: epPErr } = await epPq;
    if (epPErr) throw epPErr;
    const epPods = (epPodsRaw || []).filter(isHealthy);
    const epPodIds = epPods.map((p) => p.id);
    const podPriById = new Map(epPods.map((p) => [p.id, podPriority(p)]));
    const podNameById = new Map(epPods.map((p) => [p.id, (p as any).display_title || (p as any).title || ""]));

    let epJobs = 0;
    if (epPodIds.length) {
      // Chunk podcast IDs to avoid PostgREST URL length limits (.in with 2000 uuids → 74kb URL).
      const CHUNK = 150;
      const collected: any[] = [];
      for (let i = 0; i < epPodIds.length && collected.length < maxEps; i += CHUNK) {
        const slice = epPodIds.slice(i, i + CHUNK);
        const remaining = maxEps - collected.length;
        const { data: eps, error: eErr } = await admin.from("episodes")
          .select("id, podcast_id, title, display_title, description")
          .in("podcast_id", slice)
          .is("ai_summary", null)
          .order("published_at", { ascending: false, nullsFirst: false })
          .limit(remaining);
        if (eErr) throw eErr;
        for (const e of eps || []) collected.push(e);
      }

      // Bulk insert. Conflicts on input_hash are silently skipped.
      const rows: any[] = [];
      for (const e of collected) {
        const podName = podNameById.get(e.podcast_id) || "";
        const prompt = episodeUserPrompt(e as any, podName);
        const hash = await inputHash(prompt);
        rows.push({
          kind: "seo_episode",
          target_type: "episode",
          target_id: e.id,
          input_hash: hash,
          priority: podPriById.get(e.podcast_id) ?? 1,
          status: "pending",
          result: { prompt, pod_name: podName },
        });
      }
      for (let i = 0; i < rows.length; i += 500) {
        const batch = rows.slice(i, i + 500);
        const { error, count } = await admin
          .from("ai_enrichment_jobs")
          .upsert(batch, { onConflict: "input_hash", ignoreDuplicates: true, count: "exact" });
        if (!error) epJobs += (count ?? batch.length);
      }
    }

    return json({
      ok: true,
      podcasts_queued: podJobs,
      episodes_queued: epJobs,
      podcasts_considered: pods.length,
      scope: { min_rank: minRank, require_full_backfill: requireBackfill, tiers: allowedTiers },
    });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
