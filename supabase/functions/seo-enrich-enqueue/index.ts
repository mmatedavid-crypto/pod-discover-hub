// Enqueues podcast + episode SEO enrichment jobs based on ai_seo_controls scope.
// Idempotent (input_hash unique per kind/target).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { inputHash, podcastUserPrompt, episodeUserPrompt } from "../_shared/seo-prompt.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: any, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json().catch(() => ({}));
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "ai_seo_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    const minRank = Number(body.min_rank ?? ctrl.min_rank ?? 8);
    const requireBackfill = body.require_full_backfill ?? ctrl.require_full_backfill ?? true;
    const maxPods = Number(body.max_podcasts ?? ctrl.max_podcasts_per_run ?? 50);
    const maxEps = Number(body.max_episodes ?? ctrl.max_episodes_per_run ?? 300);

    // Select target podcasts
    let pq = admin.from("podcasts")
      .select("id, title, display_title, description, category, podiverzum_rank, full_backfill_completed_at, crawl_state, seo_title, seo_description")
      .gte("podiverzum_rank", minRank)
      .order("podiverzum_rank", { ascending: false })
      .limit(maxPods);
    if (requireBackfill) pq = pq.not("full_backfill_completed_at", "is", null);
    const { data: pods, error: pErr } = await pq;
    if (pErr) throw pErr;

    let podJobs = 0;
    for (const p of pods || []) {
      if (p.seo_title && p.seo_description) continue;
      const prompt = podcastUserPrompt(p as any);
      const hash = await inputHash(prompt);
      const { error } = await admin.from("ai_enrichment_jobs").insert({
        kind: "seo_podcast",
        target_type: "podcast",
        target_id: p.id,
        input_hash: hash,
        priority: p.podiverzum_rank || 0,
        status: "pending",
        result: { prompt },
      });
      if (!error) podJobs++;
    }

    // Select target episodes from those podcasts
    const podIds = (pods || []).map((p) => p.id);
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
          priority: 5,
          status: "pending",
          result: { prompt, pod_name: podName },
        });
        if (!error) epJobs++;
      }
    }

    return json({ ok: true, podcasts_queued: podJobs, episodes_queued: epJobs, scope: { min_rank: minRank, require_full_backfill: requireBackfill } });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
