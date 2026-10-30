import { denyUntrustedCaller } from "../_shared/internal-auth.ts";
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
import { activeDerivationCatchup, derivationSeoJobKey, dispatchBatchClamp, loadDerivationInputs, nextDispatchBatch, runFullEnqueuePass, seoInputProvenance, startDispatchBatch } from "../_shared/derivation-state.ts";

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
  { const denied = await denyUntrustedCaller(req, "seo-enrich-enqueue"); if (denied) return denied; }
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const __guard = await checkBackgroundJobsAllowed(admin, "seo-enrich-enqueue");
    if (__guard.blocked) return new Response(JSON.stringify({ ok: true, skipped: true, reason: __guard.reason }), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });
    const body = await req.json().catch(() => ({}));
    const { data: ctrlRow } = await admin.from("app_settings").select("value").eq("key", "ai_seo_controls").maybeSingle();
    const ctrl = (ctrlRow?.value || {}) as any;
    // Temporary catch-up (pipeline_catchup_state): the cron may run every minute; the full
    // (podcast / episode / transcript) passes keep their old 5-minute rhythm, only the
    // derivation dispatch (PASS 4) runs on every call.
    const { data: cuRow } = await admin.from("app_settings").select("value").eq("key", "pipeline_catchup_state").maybeSingle();
    const catchup = activeDerivationCatchup(cuRow?.value);
    const fullPass = runFullEnqueuePass(catchup, new Date(), body.full_pass === true);
    const requireBackfill = body.require_full_backfill ?? ctrl.require_full_backfill ?? true;
    const maxPods = Number(body.max_podcasts ?? ctrl.max_podcasts_per_run ?? 50);
    const maxEps = Number(body.max_episodes ?? ctrl.max_episodes_per_run ?? 300);
    // D is allowed as an indexing/data-quality tier. It is not a public quality promotion.
    const allowedTiers: string[] = body.tiers || ctrl.tiers || ["S", "A", "B", "C", "D", "E"];

    // === PASS 1: Podcast SEO enqueue ===
    // Only podcasts that still need SEO. Limited by maxPods.
    let pq = admin.from("podcasts")
      .select("id, title, display_title, description, category, language, language_decision, podiverzum_rank, rank_label, shadow_rank_components, full_backfill_completed_at, crawl_state, seo_title, seo_description, rss_status")
      .in("rank_label", allowedTiers)
      .in("rss_status", ["active", "not_checked"])
      .eq("language_decision", "accept_hungarian")
      .or("seo_title.is.null,seo_description.is.null")
      .order("podiverzum_rank", { ascending: false })
      .limit(maxPods);
    if (requireBackfill) pq = pq.not("full_backfill_completed_at", "is", null);
    const { data: podsRaw, error: pErr } = fullPass ? await pq : { data: [] as any[], error: null };
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
      .select("id, title, display_title, language, language_decision, podiverzum_rank, rank_label, shadow_rank_components, full_backfill_completed_at, rss_status")
      .in("rank_label", allowedTiers)
      .in("rss_status", ["active", "not_checked"])
      .eq("language_decision", "accept_hungarian")
      .order("podiverzum_rank", { ascending: false })
      .limit(2000);
    if (requireBackfill) epPq = epPq.not("full_backfill_completed_at", "is", null);
    const { data: epPodsRaw, error: epPErr } = fullPass ? await epPq : { data: [] as any[], error: null };
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
      // Text + fingerprint come from one consistent read, so the recorded provenance is
      // exactly the clean-text version that goes into the prompt.
      const collectedIds = collected.map((e) => e.id);
      const cleanById = await loadDerivationInputs(admin, collectedIds);

      const rows: any[] = [];
      // Strip control chars (Postgres JSONB rejects \u0000) and lone surrogates.
      const sanitize = (s: string) => s
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
        .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "")
        .replace(/(^|[^\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "$1");
      for (const e of collected) {
        const podName = sanitize(podNameById.get(e.podcast_id) || "");
        const ci = cleanById.get(e.id);
        (e as any).clean_text = ci?.text || null;
        const podMeta: any = epPods.find((p: any) => p.id === e.podcast_id) || {};
        if (podMeta.language_decision === "accept_hungarian") {
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
          result: { prompt, pod_name: podName, input_provenance: seoInputProvenance({ cleanText: ci?.text, cleanHash: ci?.hash, cleanMethod: ci?.method, description: e.description }) },
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
    const transcriptRegenLimit = fullPass ? Number(body.max_transcript_regen ?? ctrl.max_transcript_regen_per_run ?? 200) : 0;
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
            .select("id, podcast_id, title, display_title, description, ai_summary_source, podcasts!inner(id, title, display_title, language, language_decision, hosts, rank_label, rss_status, shadow_rank_components, full_backfill_completed_at)")
            .in("id", slice)
            .eq("podcasts.language_decision", "accept_hungarian");
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
            if (pod.language_decision === "accept_hungarian") {
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
              result: { prompt, pod_name: podName, source: "transcript", input_provenance: seoInputProvenance({ transcript, cleanText: (ep as any).clean_text, description: (ep as any).description }) },
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

    // === PASS 4: clean-text content changed after SEO/topic/entity were built ===
    // dispatch_stale_derivations_v1 (bounded per run + per day) re-opens topic and
    // entity work in their own queues and returns the episodes whose SEO is stale.
    // SEO jobs carry no pre-built prompt: the runner builds it from the clean text
    // live at run time and records that version's hash. One job per clean-text
    // version (input_hash), so a second pass over the same version is a no-op.
    let derivationDispatched = 0, derivationSeoJobs = 0;
    let derivationErr: string | null = null;
    let eff_report: number | null = null;
    if (body.skip_derivation !== true) {
      // Adaptive effective batch (app_settings.derivation_dispatch_tuning, owned by this caller):
      // the stored per_run / daily_cap in derivation_dispatch_controls stay the upper bounds.
      // A statement timeout rolls the whole dispatch back (nothing half-written); the batch is
      // halved and retried once, and the smaller size is kept for the next run. Fast runs grow
      // it again in steps of 10 (10..60). Never raises any timeout.
      const { data: tuneRow } = await admin.from("app_settings").select("value").eq("key", "derivation_dispatch_tuning").maybeSingle();
      const tune = (tuneRow?.value || {}) as any;
      const explicit = body.derivation_limit != null;
      // During an active catch-up its stored tuning (start 30, grow < 5 s, shrink > 6.5 s, all
      // bounded under the 8 s timeout) replaces the conservative 3 s / 5 s defaults.
      const start = startDispatchBatch(tune, catchup);
      let eff = explicit
        ? Math.max(0, Math.min(60, Number(body.derivation_limit)))
        : start.limit;
      const attempt = async (limit: number) => {
        const t0 = Date.now();
        const r = await admin.rpc("dispatch_stale_derivations_v1", { p_limit: limit, p_dry_run: body.derivation_dry_run === true });
        return { ...r, ms: Date.now() - t0, limit };
      };
      let res = await attempt(eff);
      const attempts: any[] = [{ limit: res.limit, ms: res.ms, error: res.error?.message || null }];
      if (res.error && /statement timeout|canceling statement/i.test(res.error.message) && eff > 10) {
        eff = dispatchBatchClamp(Math.floor(eff / 2));
        res = await attempt(eff);
        attempts.push({ limit: res.limit, ms: res.ms, error: res.error?.message || null });
      }
      eff_report = eff;
      const stale = res.data;
      const dErr = res.error;
      // Another dispatch is still running (no-overlap guard): skip, keep the tuning unchanged.
      const busy = !!dErr && /dispatch_busy/i.test(dErr.message);
      if (dErr && !busy) console.warn("dispatch_stale_derivations_v1 failed", attempts);
      if (!explicit && body.derivation_dry_run !== true && !busy) {
        const next = dErr ? dispatchBatchClamp(Math.floor(eff / 2)) : nextDispatchBatch(eff, res.ms, catchup?.tuning);
        await admin.from("app_settings").upsert({
          key: "derivation_dispatch_tuning",
          value: { effective_limit: next, last_limit: eff, last_ms: res.ms, last_outcome: dErr ? "error" : "ok",
                   last_error: dErr?.message || null, attempts, at: new Date().toISOString(),
                   catchup_marker: start.marker, thresholds: catchup?.tuning || { grow_below_ms: 3000, shrink_above_ms: 5000 },
                   note: "Adaptive dispatch batch (10..60) kept by seo-enrich-enqueue; bounds from derivation_dispatch_controls." },
          updated_at: new Date().toISOString(),
        }, { onConflict: "key" });
      }
      if (dErr) derivationErr = busy ? "dispatch_busy_skipped" : dErr.message;
      const list = (stale || []) as any[];
      derivationDispatched = list.length;
      const seoRows = list.filter((r) => r.seo_dispatch && r.clean_hash).map((r) => ({
        kind: "seo_episode",
        target_type: "episode",
        target_id: r.episode_id,
        input_hash: derivationSeoJobKey(String(r.clean_hash)),
        priority: 90,
        status: "pending",
        result: { source: "clean_text_changed", clean_hash: r.clean_hash },
      }));
      if (seoRows.length && body.derivation_dry_run !== true) {
        const { error, count } = await admin
          .from("ai_enrichment_jobs")
          .upsert(seoRows, { onConflict: "kind,target_type,target_id,input_hash", ignoreDuplicates: true, count: "exact" });
        if (error) derivationErr = error.message;
        else derivationSeoJobs = count ?? seoRows.length;
      }
    }

    return json({
      ok: true,
      podcasts_queued: podJobs,
      episodes_queued: epJobs,
      transcript_regen_queued: transcriptJobs,
      transcript_candidates: transcriptCandidates,
      transcript_upsert_err: transcriptUpsertErr,
      derivation_dispatched: derivationDispatched,
      derivation_seo_jobs: derivationSeoJobs,
      derivation_err: derivationErr,
      derivation_limit: eff_report,
      full_pass: fullPass,
      catchup_active: !!catchup,
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
