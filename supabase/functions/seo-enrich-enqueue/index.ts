// Enqueues podcast + episode SEO enrichment jobs based on ai_seo_controls scope.
// Idempotent (input_hash unique per kind/target).
// Tier-aware priority: S>A>B>C. D/E and bad-health states are skipped.
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

    // Select target podcasts: by tier (preferred) + healthy + active/not_checked
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

    // Select target episodes from those podcasts, with tier-aware priority
    const podIds = pods.map((p) => p.id);
    const podPriById = new Map(pods.map((p) => [p.id, podPriority(p)]));
    let epJobs = 0;
    if (podIds.length) {
      const { data: eps, error: eErr } = await admin.from("episodes")
        .select("id, podcast_id, title, display_title, description, ai_summary, seo_title, podcasts!inner(title, display_title)")
        .in("podcast_id", podIds)
        .is("ai_summary", null)
        .order("episode_rank", { ascending: false })
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(maxEps);
      if (eErr) throw eErr;
      for (const e of eps || []) {
        const podName = ((e as any).podcasts?.display_title) || ((e as any).podcasts?.title) || "";
        const prompt = episodeUserPrompt(e as any, podName);
        const hash = await inputHash(prompt);
        const { error } = await admin.from("ai_enrichment_jobs").insert({
          kind: "seo_episode",
          target_type: "episode",
          target_id: e.id,
          input_hash: hash,
          priority: podPriById.get(e.podcast_id) ?? 1,
          status: "pending",
          result: { prompt, pod_name: podName },
        });
        if (!error) epJobs++;
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
