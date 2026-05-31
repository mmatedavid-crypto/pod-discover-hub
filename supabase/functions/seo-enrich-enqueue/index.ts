// Enqueues podcast + episode SEO enrichment jobs based on ai_seo_controls scope.
// Idempotent (input_hash unique per kind/target).
//
// === Enqueue ordering contract (Formula C v3-safe) ===
// 1. Podcast selection: rank_label IN (S,A,B,C,D,E) AND rss_status IN (active,
//    not_checked) AND health_state NOT IN (rss_url_not_found,
//    needs_manual_rss_review, confirmed_dead, quarantined_spam). When
//    require_full_backfill, full_backfill_completed_at must be set.
//    Ordered by podiverzum_rank DESC.
// 2. Job priority is derived from podcast tier: S=100, A=80, B=60, C=40, D/E=20.
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

const TIER_PRIORITY: Record<string, number> = { S: 100, A: 80, B: 60, C: 40, D: 20, E: 20 };
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
  if (r >= 2.5) return 20;
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
    const requireBackfill = body.require_full_backfill ?? ctrl.require_full_backfill ?? true;
    const maxPods = Number(body.max_podcasts ?? ctrl.max_podcasts_per_run ?? 50);
    const maxEps = Number(body.max_episodes ?? ctrl.max_episodes_per_run ?? 300);
    // D is allowed as an indexing/data-quality tier. It is not a public quality promotion.
    const allowedTiers: string[] = body.tiers || ctrl.tiers || ["S", "A", "B", "C", "D", "E"];

    // === PASS 1: Podcast SEO enqueue ===
    // Only podcasts that still need SEO. Limited by maxPods.
    let pq = admin.from("podcasts")
      .select("id, title, display_title, description, category, language, is_hungarian, language_decision, podiverzum_rank, rank_label, shadow_rank_components, full_backfill_completed_at, crawl_state, seo_title, seo_description, rss_status")
      .in("rank_label", allowedTiers)
      .in("rss_status", ["active", "not_checked"])
      .eq("is_hungarian", true)
      .eq("language_decision", "accept_hungarian")
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
      .select("id, title, display_title, language, is_hungarian, language_decision, podiverzum_rank, rank_label, shadow_rank_components, full_backfill_completed_at, rss_status")
      .in("rank_label", allowedTiers)
      .in("rss_status", ["active", "not_checked"])
      .eq("is_hungarian", true)
      .eq("language_decision", "accept_hungarian")
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
    let collectedCount = 0;
    let upsertErr: string | null = null;
    if (epPodIds.length) {
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
      collectedCount = collected.length;

      // Batch-fetch cleaned RSS text for all collected episodes (sponsor/CTA noise removed).
      // Used in the prompt instead of the raw description when length is sufficient.
      const cleanById = new Map<string, string>();
      const collectedIds = collected.map((e) => e.id);
      for (let i = 0; i < collectedIds.length; i += 500) {
        const slice = collectedIds.slice(i, i + 500);
        const { data: cts } = await admin
          .from("episode_clean_text")
          .select("episode_id, cleaned_text")
          .in("episode_id", slice);
        for (const r of cts || []) {
          const t = String((r as any).cleaned_text || "");
          if (t.length >= 80) cleanById.set((r as any).episode_id, t);
        }
      }

      const rows: any[] = [];
      // Strip control chars (Postgres JSONB rejects \u0000) and lone surrogates.
      const sanitize = (s: string) => s
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
        .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1");
      for (const e of collected) {
        const podName = sanitize(podNameById.get(e.podcast_id) || "");
        (e as any).clean_text = cleanById.get(e.id) || null;
        const podMeta: any = epPods.find((p: any) => p.id === e.podcast_id) || {};
        if (!["reject_foreign", "confirmed_foreign", "reject_non_hungarian"].includes(String(podMeta.language_decision || "")) && (podMeta.is_hungarian === true || podMeta.language_decision === "accept_hungarian")) {
          (e as any).output_language_code = "hu";
        } else {
          (e as any).language = podMeta.language || null;
        }
        const prompt = sanitize(episodeUserPrompt(e as any, podName));
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
          .upsert(batch, { onConflict: "kind,target_type,target_id,input_hash", ignoreDuplicates: true, count: "exact" });
        if (error) { upsertErr = error.message; console.log("upsert_error", error); }
        else epJobs += (count ?? batch.length);
      }
    }

    // === PASS 3: Transcript-grounded ai_summary regeneration ===
    // Targets episodes that already have a transcript but whose ai_summary was
    // (or would be) generated from the short description only. These get a new
    // job with a distinct input_hash so they don't conflict with the older
    // description-based job for the same episode.
    const transcriptRegenLimit = Number(body.max_transcript_regen ?? ctrl.max_transcript_regen_per_run ?? 200);
    let transcriptJobs = 0;
    let transcriptCandidates = 0;
    let transcriptUpsertErr: string | null = null;
    if (transcriptRegenLimit > 0) {
      // 1. Fetch most recent transcripts (no FK relationship to episodes — query in two steps).
      const { data: trRows, error: trErr } = await admin
        .from("episode_transcripts")
        .select("episode_id, transcript")
        .order("created_at", { ascending: false })
        .limit(transcriptRegenLimit * 3);
      if (trErr) {
        transcriptUpsertErr = trErr.message;
      } else {
        const transcriptById = new Map<string, string>();
        for (const r of (trRows || [])) {
          const id = (r as any).episode_id;
          if (id && !transcriptById.has(id)) transcriptById.set(id, (r as any).transcript || "");
        }
        const epIds = Array.from(transcriptById.keys());
        // 2. Fetch episode + podcast metadata for those episode ids.
        const sanitize = (s: string) => s
          .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
          .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
          .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1");
        const rows: any[] = [];
        const CHUNK = 150;
        for (let i = 0; i < epIds.length && rows.length < transcriptRegenLimit; i += CHUNK) {
          const slice = epIds.slice(i, i + CHUNK);
          const { data: eps, error: eErr } = await admin
            .from("episodes")
            .select("id, podcast_id, title, display_title, description, ai_summary_source, podcasts!inner(id, title, display_title, language, is_hungarian, language_decision, hosts, rank_label, rss_status, shadow_rank_components, full_backfill_completed_at)")
            .in("id", slice);
          if (eErr) { transcriptUpsertErr = eErr.message; break; }
          for (const ep of (eps || [])) {
            if (rows.length >= transcriptRegenLimit) break;
            if ((ep as any).ai_summary_source === "transcript") continue;
            const pod: any = (ep as any).podcasts;
            if (!pod) continue;
            if (!allowedTiers.includes(String(pod.rank_label || "").toUpperCase())) continue;
            if (!["active", "not_checked"].includes(String(pod.rss_status || ""))) continue;
            if (!isHealthy(pod)) continue;
            if (requireBackfill && !pod.full_backfill_completed_at) continue;
            transcriptCandidates++;
            const podName = sanitize(pod.display_title || pod.title || "");
            const transcript = String(transcriptById.get((ep as any).id) || "");
            if (!["reject_foreign", "confirmed_foreign", "reject_non_hungarian"].includes(String(pod.language_decision || "")) && (pod.is_hungarian === true || pod.language_decision === "accept_hungarian")) {
              (ep as any).output_language_code = "hu";
            } else {
              (ep as any).language = pod.language || null;
            }
            const prompt = sanitize(episodeUserPrompt(ep as any, podName, pod.language, pod.hosts, transcript));
            const hash = await inputHash(prompt + "|tr:" + transcript.slice(0, 200));
            rows.push({
              kind: "seo_episode",
              target_type: "episode",
              target_id: (ep as any).id,
              input_hash: hash,
              priority: podPriority(pod),
              status: "pending",
              result: { prompt, pod_name: podName, source: "transcript" },
            });
          }
        }
        for (let i = 0; i < rows.length; i += 500) {
          const batch = rows.slice(i, i + 500);
          const { error, count } = await admin
            .from("ai_enrichment_jobs")
            .upsert(batch, { onConflict: "kind,target_type,target_id,input_hash", ignoreDuplicates: true, count: "exact" });
          if (error) { transcriptUpsertErr = error.message; console.log("transcript_upsert_error", error); }
          else transcriptJobs += (count ?? batch.length);
        }
      }
    }

    return json({
      ok: true,
      podcasts_queued: podJobs,
      episodes_queued: epJobs,
      transcript_regen_queued: transcriptJobs,
      transcript_candidates: transcriptCandidates,
      transcript_upsert_err: transcriptUpsertErr,
      podcasts_considered: pods.length,
      ep_podcasts_considered: epPods.length,
      ep_episodes_collected: collectedCount,
      upsert_err: upsertErr,
      scope: { require_full_backfill: requireBackfill, tiers: allowedTiers },
    });
  } catch (e: any) {
    return json({ error: e?.message || "error" }, 500);
  }
});
