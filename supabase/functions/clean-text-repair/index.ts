// Admin-only clean-text repair: audit → stage (dry run) → canary apply (≤100,
// backed up, compare-and-swap) → rollback. Deterministic only, $0, no AI calls.
// Never touches the corpus without an explicit confirm token and passing gates.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { checkBackgroundJobsAllowed } from "../_shared/incident-guard.ts";
import { heuristicClean, validateExtractOnlyTrim } from "../_shared/episode-text-cleaner.ts";
import {
  CLEAN_TEXT_QUALITY_VERSION,
  RESCUE_METHOD_SUFFIX,
  decideCleanText,
  htmlToPlain,
} from "../_shared/clean-text-validation.ts";
import { applyYoutubeReclean, computeSelections, planSpotifyReclean, planYoutubeReclean, upsertSelections } from "../_shared/best-text-source-core.ts";
import { RSS_REPAIR_KINDS, RSS_REPAIR_MAX_CANARY, planRssRepair, type RssRepairPlan } from "../_shared/clean-text-rss-repair.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

const KINDS = new Set(["empty_substantive", "empty_any", "short_from_long"]);
const REPAIR_STAGED = "repair_staged";
const REPAIR_REJECTED = "repair_rejected";

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function isAdmin(admin: any, authHeader: string | null) {
  if (!authHeader) return false;
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (token && token === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) return true;
  const { data: u } = await admin.auth.getUser(token);
  if (!u?.user) return false;
  const { data: r } = await admin.from("user_roles").select("role").eq("user_id", u.user.id).eq("role", "admin").maybeSingle();
  return !!r;
}

type Staged = {
  episode_id: string;
  cleaner_method: string;
  source_hash: string;
  cleaned_text: string;
  removed_categories: string[];
  quality_status: string;
  quality_reasons: string[];
  quality_score: number;
  expected_source_hash: string | null;
  expected_cleaned_sha256: string | null;
  verdict_status: string;
  overlap: number;
  source_type: string;
};

/** Canary gate: stricter than the runner gate. */
function canaryEligible(s: Staged): boolean {
  return s.quality_status === REPAIR_STAGED
    && s.verdict_status === "valid"
    && s.cleaned_text.length >= 80
    && s.overlap >= 0.98
    && !/https?:\/\/|<a\s|www\./i.test(s.cleaned_text);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const startedAt = Date.now();
  try {
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    if (!(await isAdmin(admin, req.headers.get("Authorization")))) return json({ ok: false, error: "forbidden" }, 403);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "audit");

    if (action === "audit") {
      const { data, error } = await admin.rpc("clean_text_quality_audit_v1");
      if (error) throw error;
      return json({ ok: true, action, audit: data, elapsed_ms: Date.now() - startedAt });
    }

    if (action === "rollback") {
      const batchId = String(body.batch_id || "");
      if (!/^[0-9a-f-]{36}$/i.test(batchId)) return json({ ok: false, error: "batch_id required" }, 400);
      const { data, error } = await admin.rpc("rollback_clean_text_repair_v1", { p_batch_id: batchId });
      if (error) throw error;
      return json({ ok: true, action, result: data });
    }

    if (action === "youtube_metrics") {
      const { data, error } = await admin.rpc("youtube_source_quality_metrics_v1");
      if (error) throw error;
      return json({ ok: true, action, metrics: data, elapsed_ms: Date.now() - startedAt });
    }

    const loadBestCtrl = async () => {
      const { data } = await admin.from("app_settings").select("value").eq("key", "episode_best_text_source_controls").maybeSingle();
      return (data?.value || {}) as any;
    };

    // Read-only: one page of the verified-YouTube target set (keyset on episode_id).
    if (action === "youtube_dry_run") {
      const pageSize = Math.max(1, Math.min(50, Number(body.limit || 40)));
      let ids: string[];
      if (Array.isArray(body.episode_ids)) {
        ids = body.episode_ids.map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, pageSize);
      } else {
        const { data: tg, error } = await admin.rpc("best_source_youtube_gain_targets_v1", { p_after: body.after || null, p_limit: pageSize });
        if (error) throw error;
        ids = ((tg || []) as any[]).map((r) => String(r.episode_id));
      }
      const ctrl = await loadBestCtrl();
      const sel = await computeSelections(admin, ids, ctrl);
      const ytDecisions = sel.decisions.filter((d) => d.next_source === "youtube");
      const plans = await planYoutubeReclean(admin, ytDecisions.map((d) => ({ episode_id: d.episode_id, podcast_id: d.podcast_id, raw_text: d.raw_text, source_fingerprint: d.source_fingerprint, evidence: d.evidence })), { allowCleanerUpdate: body.allow_cleaner_update === true });
      const gain: Record<string, number> = {};
      const next: Record<string, number> = {};
      const outcomes: Record<string, number> = {};
      const reasons: Record<string, number> = {};
      for (const d of sel.decisions) {
        next[d.next_source] = (next[d.next_source] || 0) + 1;
        const g = d.gain?.decision || "not_evaluated";
        gain[g] = (gain[g] || 0) + 1;
      }
      for (const p of plans) {
        outcomes[p.outcome] = (outcomes[p.outcome] || 0) + 1;
        for (const r of p.reasons) if (p.outcome !== "apply") reasons[r] = (reasons[r] || 0) + 1;
      }
      const sampleN = Math.max(0, Math.min(20, Number(body.samples ?? 0)));
      const byId = new Map(sel.decisions.map((d) => [d.episode_id, d]));
      return json({
        ok: true, action, dry_run: true, page_size: pageSize, targets: ids.length,
        next_after: ids.length ? ids[ids.length - 1] : null, done: ids.length < pageSize,
        scanned: sel.stats.scanned, gain, next_source: next, reclean_outcomes: outcomes, reject_reasons: reasons,
        eligible_ids: plans.filter((p) => p.outcome === "apply").map((p) => p.episode_id),
        samples: plans.slice(0, sampleN).map((p) => ({
          episode_id: p.episode_id, outcome: p.outcome, reasons: p.reasons, prior_method: p.prior_method,
          prior_len: p.prior_len, next_len: p.next_len, preview: p.preview, gain: byId.get(p.episode_id)?.gain || null,
          ...(body.full_text === true ? { next_text: p.item?.cleaned_text ?? null } : {}),
        })),
        elapsed_ms: Date.now() - startedAt,
      });
    }

    // Read-only: one page of the staged verified-Spotify target set (keyset on episode_id).
    if (action === "spotify_dry_run") {
      // ≤15 per call: 30 long Spotify notes across many shows exceeded edge CPU.
      const pageSize = Math.max(1, Math.min(15, Number(body.limit || 15)));
      let ids: string[];
      if (Array.isArray(body.episode_ids)) {
        ids = body.episode_ids.map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, pageSize);
      } else {
        const { data: tg, error } = await admin.rpc("best_source_spotify_targets_v1", { p_after: body.after || null, p_limit: pageSize });
        if (error) throw error;
        ids = ((tg || []) as any[]).map((r) => String(r.episode_id));
      }
      const ctrl = await loadBestCtrl();
      const sel = await computeSelections(admin, ids, ctrl);
      const spDecisions = sel.decisions.filter((d) => d.next_source === "spotify");
      const plans = await planSpotifyReclean(admin, spDecisions.map((d) => ({ episode_id: d.episode_id, podcast_id: d.podcast_id, raw_text: d.raw_text, source_fingerprint: d.source_fingerprint, evidence: d.evidence })));
      const gain: Record<string, number> = {}, next: Record<string, number> = {}, outcomes: Record<string, number> = {}, reasons: Record<string, number> = {};
      for (const d of sel.decisions) {
        next[d.next_source] = (next[d.next_source] || 0) + 1;
        const g = d.spotify_gain?.decision || (d.evidence?.spotify_gain?.decision) || "not_evaluated";
        gain[g] = (gain[g] || 0) + 1;
      }
      for (const p of plans) {
        outcomes[p.outcome] = (outcomes[p.outcome] || 0) + 1;
        for (const r of p.reasons) if (p.outcome !== "apply") reasons[r] = (reasons[r] || 0) + 1;
      }
      const sampleN = Math.max(0, Math.min(20, Number(body.samples ?? 0)));
      return json({
        ok: true, action, dry_run: true, page_size: pageSize, targets: ids.length,
        next_after: ids.length ? ids[ids.length - 1] : null, done: ids.length < pageSize,
        scanned: sel.stats.scanned, spotify_gain: gain, next_source: next, reclean_outcomes: outcomes, reject_reasons: reasons,
        eligible_ids: plans.filter((p) => p.outcome === "apply").map((p) => p.episode_id),
        samples: plans.slice(0, sampleN).map((p) => ({
          episode_id: p.episode_id, outcome: p.outcome, reasons: p.reasons, prior_method: p.prior_method,
          prior_len: p.prior_len, next_len: p.next_len, preview: p.preview,
          ...(body.full_text === true ? { next_text: p.item?.cleaned_text ?? null } : {}),
        })),
        elapsed_ms: Date.now() - startedAt,
      });
    }

    const guard = await checkBackgroundJobsAllowed(admin, "clean-text-repair");
    if (guard.blocked) return json({ ok: true, skipped: true, reason: guard.reason });

    // Canary: select best source for explicit ids, then a backed-up CAS re-clean (≤50).
    if (action === "youtube_canary") {
      if (body.confirm !== "apply_youtube_canary") return json({ ok: false, error: "confirm=apply_youtube_canary required" }, 400);
      const ids: string[] = Array.isArray(body.episode_ids) ? body.episode_ids.map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 50) : [];
      if (!ids.length) return json({ ok: false, error: "episode_ids required (≤50)" }, 400);
      const ctrl = await loadBestCtrl();
      const sel = await computeSelections(admin, ids, ctrl);
      const upserted = await upsertSelections(admin, sel.rows);
      const yt = sel.decisions.filter((d) => d.next_source === "youtube");
      // Fresh fingerprints/evidence from the rows just written.
      const { data: rows, error: rErr } = await admin.from("episode_best_text_source")
        .select("episode_id,podcast_id,raw_text,source_fingerprint,evidence,source_type").in("episode_id", yt.map((d) => d.episode_id));
      if (rErr) throw rErr;
      const cands = ((rows || []) as any[]).filter((r) => r.source_type === "youtube");
      // allow_cleaner_update: re-apply the current deterministic YouTube cleaner to
      // earlier automatic (never reviewed-canary) YouTube re-cleans; still backed up + CAS.
      const plans = await planYoutubeReclean(admin, cands, { allowCleanerUpdate: body.allow_cleaner_update === true });
      const batchId = crypto.randomUUID();
      const result = await applyYoutubeReclean(admin, plans, batchId);
      const outcomes: Record<string, number> = {};
      for (const p of plans) outcomes[p.outcome] = (outcomes[p.outcome] || 0) + 1;
      return json({
        ok: true, action, batch_id: Number(result?.applied || 0) ? batchId : null, requested: ids.length, upserted_best_source: upserted,
        youtube_selected: yt.length, outcomes, result,
        applied_ids: plans.filter((p) => p.outcome === "apply" && !(result?.conflict_episode_ids || []).includes(p.episode_id)).map((p) => p.episode_id),
        rejected: plans.filter((p) => p.outcome === "reject").map((p) => ({ episode_id: p.episode_id, reasons: p.reasons })),
        elapsed_ms: Date.now() - startedAt,
      });
    }

    // Spotify canary: best source for explicit ids, then a backed-up CAS re-clean (≤50).
    if (action === "spotify_canary") {
      if (body.confirm !== "apply_spotify_canary") return json({ ok: false, error: "confirm=apply_spotify_canary required" }, 400);
      // ≤15 per call (edge CPU); a 30–50 canary is several calls, each its own backed-up batch.
      const ids: string[] = Array.isArray(body.episode_ids) ? body.episode_ids.map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 15) : [];
      if (!ids.length) return json({ ok: false, error: "episode_ids required (≤15 per call)" }, 400);
      const ctrl = await loadBestCtrl();
      const sel = await computeSelections(admin, ids, ctrl);
      const upserted = await upsertSelections(admin, sel.rows);
      const sp = sel.decisions.filter((d) => d.next_source === "spotify");
      const { data: rows, error: rErr } = await admin.from("episode_best_text_source")
        .select("episode_id,podcast_id,raw_text,source_fingerprint,evidence,source_type").in("episode_id", sp.map((d) => d.episode_id));
      if (rErr) throw rErr;
      const cands = ((rows || []) as any[]).filter((r) => r.source_type === "spotify");
      const plans = await planSpotifyReclean(admin, cands);
      const batchId = crypto.randomUUID();
      const result = await applyYoutubeReclean(admin, plans, batchId);
      const outcomes: Record<string, number> = {};
      for (const p of plans) outcomes[p.outcome] = (outcomes[p.outcome] || 0) + 1;
      return json({
        ok: true, action, batch_id: Number(result?.applied || 0) ? batchId : null, requested: ids.length, upserted_best_source: upserted,
        spotify_selected: sp.length, outcomes, result,
        applied_ids: plans.filter((p) => p.outcome === "apply" && !(result?.conflict_episode_ids || []).includes(p.episode_id)).map((p) => p.episode_id),
        rejected: plans.filter((p) => p.outcome === "reject").map((p) => ({ episode_id: p.episode_id, reasons: p.reasons })),
        elapsed_ms: Date.now() - startedAt,
      });
    }

    // RSS repair (empty / overcut / missing): read-only dry run, or a canary of
    // explicitly reviewed episode ids (≤50), backed up + CAS, rollback per batch.
    if (action === "rss_dry_run" || action === "rss_canary") {
      const rkind = String(body.kind || "");
      if (!(RSS_REPAIR_KINDS as readonly string[]).includes(rkind)) return json({ ok: false, error: "unknown kind" }, 400);
      const isCanary = action === "rss_canary";
      if (isCanary && body.confirm !== "apply_rss_canary") return json({ ok: false, error: "confirm=apply_rss_canary required" }, 400);
      const ids: string[] | null = Array.isArray(body.episode_ids)
        ? body.episode_ids.map(String).filter((x: string) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, isCanary ? RSS_REPAIR_MAX_CANARY : 200)
        : null;
      if (isCanary && !ids?.length) return json({ ok: false, error: "explicit reviewed episode_ids required" }, 400);
      const pageLimit = ids ? Math.min(200, ids.length) : Math.max(1, Math.min(100, Number(body.limit || 50)));
      const offset = ids ? 0 : Math.max(0, Number(body.offset || 0));
      const { data: targets, error } = await admin.rpc("clean_text_repair_targets_v2", { p_kind: rkind, p_limit: pageLimit, p_offset: offset, p_episode_ids: ids });
      if (error) throw error;
      const { data: ctRow } = await admin.from("app_settings").select("value").eq("key", "episode_clean_text_controls").maybeSingle();
      const method = String((ctRow?.value as any)?.method_version || "deterministic_v4");
      const plans: RssRepairPlan[] = [];
      for (const t of (targets || []) as any[]) plans.push(await planRssRepair(t, { method }));
      const outcomes: Record<string, number> = {}, reasons: Record<string, number> = {};
      for (const p of plans) {
        outcomes[p.outcome] = (outcomes[p.outcome] || 0) + 1;
        if (p.outcome !== "apply") for (const r of p.reasons) reasons[r] = (reasons[r] || 0) + 1;
      }
      if (!isCanary) {
        const sampleN = Math.max(0, Math.min(50, Number(body.samples ?? 0)));
        return json({
          ok: true, action, kind: rkind, dry_run: true, offset, targets: (targets || []).length,
          next_offset: offset + (targets || []).length, done: (targets || []).length < pageLimit,
          outcomes, reject_reasons: reasons,
          apply_ids: plans.filter((p) => p.outcome === "apply").map((p) => p.episode_id),
          samples: plans.slice(0, sampleN).map((p) => ({ episode_id: p.episode_id, outcome: p.outcome, reasons: p.reasons, prior_len: p.prior_len, prior_method: p.prior_method, next_len: p.next_len, lost_from_source: p.lost_from_source, preview: p.preview })),
          elapsed_ms: Date.now() - startedAt,
        });
      }
      const items = plans.filter((p) => p.outcome === "apply" && p.item).map((p) => p.item!);
      if (!items.length) return json({ ok: true, action, applied: 0, reason: "no_eligible_rows", outcomes, reject_reasons: reasons });
      const batchId = crypto.randomUUID();
      const { data: res, error: applyErr } = await admin.rpc("apply_clean_text_repair_v1", { p_batch_id: batchId, p_items: items });
      if (applyErr) throw applyErr;
      return json({
        ok: true, action, kind: rkind, batch_id: batchId, result: res, outcomes, reject_reasons: reasons,
        applied_ids: items.map((i: any) => i.episode_id).filter((id: string) => !((res as any)?.conflict_episode_ids || []).includes(id)),
        rejected: plans.filter((p) => p.outcome !== "apply").map((p) => ({ episode_id: p.episode_id, reasons: p.reasons })),
        elapsed_ms: Date.now() - startedAt,
      });
    }

    const kind = String(body.kind || "empty_substantive");
    if (!KINDS.has(kind)) return json({ ok: false, error: "unknown kind" }, 400);
    const limit = Math.max(1, Math.min(action === "apply" ? 100 : 200, Number(body.limit || 50)));

    if (action === "stage") {
      const dryRun = body.dry_run !== false; // default: compute only, write nothing
      const { data: targets, error } = await admin.rpc("clean_text_repair_targets_v1", { p_kind: kind, p_limit: limit });
      if (error) throw error;
      const staged: Staged[] = [];
      const counts: Record<string, number> = {};
      for (const t of (targets || []) as any[]) {
        const sourceType = t.best_source_type && t.best_source_type !== "rss" ? String(t.best_source_type) : "rss";
        const raw = String(sourceType !== "rss" ? t.best_raw_text : (t.description || t.summary || "")).trim();
        const v4 = heuristicClean(raw);
        const decision = decideCleanText({ raw, v4, priorCleanedText: null });
        const key = decision.action + (decision.action === "write" ? (decision.rescued ? ":rescue" : ":v4") : "");
        counts[key] = (counts[key] || 0) + 1;
        if (decision.action !== "write") continue;
        const method = `deterministic_v4${sourceType !== "rss" ? `+${sourceType}` : ""}${decision.rescued ? `+${RESCUE_METHOD_SUFFIX}` : ""}`;
        const transcriptHash = sourceType === "transcript" && typeof t.best_evidence?.content_hash === "string" ? t.best_evidence.content_hash : "";
        const source_hash = transcriptHash || await sha256Hex(`${method}::${raw}`);
        const extract = validateExtractOnlyTrim(htmlToPlain(raw), decision.text, { minOverlap: 0.97, maxAddedTokenRatio: 0.03, minCompressionRatio: 0 });
        staged.push({
          episode_id: t.episode_id,
          cleaner_method: method,
          source_hash,
          cleaned_text: decision.text,
          removed_categories: Array.from(new Set([...decision.removed, `source_${sourceType}`])),
          quality_status: extract.ok ? REPAIR_STAGED : REPAIR_REJECTED,
          quality_reasons: decision.rescued ? decision.v4_verdict.reasons.map((r) => `v4_${r}`) : decision.verdict.reasons,
          quality_score: Math.min(1, decision.verdict.metrics.retention_vs_content),
          expected_source_hash: t.current_source_hash ?? null,
          expected_cleaned_sha256: t.current_source_hash == null && t.current_cleaned_text == null ? null : await sha256Hex(String(t.current_cleaned_text || "")),
          verdict_status: decision.verdict.status,
          overlap: extract.overlap,
          source_type: sourceType,
        });
      }
      const eligible = staged.filter(canaryEligible);
      if (!dryRun && staged.length) {
        const rows = staged.map((s) => ({
          episode_id: s.episode_id,
          cleaner_method: s.cleaner_method,
          source_hash: s.source_hash,
          cleaned_text: s.cleaned_text,
          removed_categories: s.removed_categories,
          quality_status: s.quality_status,
          quality_reasons: [...s.quality_reasons, `verdict_${s.verdict_status}`, `overlap_${s.overlap}`, `expected_hash_${s.expected_source_hash ?? "none"}`],
          quality_score: s.quality_score,
          updated_at: new Date().toISOString(),
        }));
        const { error: upErr } = await admin.from("episode_clean_text_candidates").upsert(rows, { onConflict: "episode_id,cleaner_method,source_hash" });
        if (upErr) throw upErr;
      }
      return json({
        ok: true,
        action,
        kind,
        dry_run: dryRun,
        targets: (targets || []).length,
        decisions: counts,
        staged: staged.length,
        canary_eligible: eligible.length,
        samples: staged.slice(0, Number(body.samples ?? 8)).map((s) => ({
          episode_id: s.episode_id,
          method: s.cleaner_method,
          verdict: s.verdict_status,
          overlap: s.overlap,
          len: s.cleaned_text.length,
          preview: s.cleaned_text.slice(0, 280),
        })),
        elapsed_ms: Date.now() - startedAt,
      });
    }

    if (action === "apply") {
      if (body.confirm !== "apply_canary") return json({ ok: false, error: "confirm=apply_canary required" }, 400);
      // Recompute from live data (never trust stale staging) and apply only canary-eligible rows.
      const { data: targets, error } = await admin.rpc("clean_text_repair_targets_v1", { p_kind: kind, p_limit: Math.min(200, limit * 2) });
      if (error) throw error;
      const onlyIds = Array.isArray(body.episode_ids) ? new Set(body.episode_ids.map(String)) : null;
      const items: any[] = [];
      for (const t of (targets || []) as any[]) {
        if (items.length >= limit) break;
        if (onlyIds && !onlyIds.has(String(t.episode_id))) continue;
        const sourceType = t.best_source_type && t.best_source_type !== "rss" ? String(t.best_source_type) : "rss";
        const raw = String(sourceType !== "rss" ? t.best_raw_text : (t.description || t.summary || "")).trim();
        const decision = decideCleanText({ raw, v4: heuristicClean(raw), priorCleanedText: null });
        if (decision.action !== "write") continue;
        const extract = validateExtractOnlyTrim(htmlToPlain(raw), decision.text, { minOverlap: 0.97, maxAddedTokenRatio: 0.03, minCompressionRatio: 0 });
        const method = `deterministic_v4${sourceType !== "rss" ? `+${sourceType}` : ""}${decision.rescued ? `+${RESCUE_METHOD_SUFFIX}` : ""}`;
        const s: Staged = {
          episode_id: t.episode_id,
          cleaner_method: method,
          source_hash: (sourceType === "transcript" && typeof t.best_evidence?.content_hash === "string" ? t.best_evidence.content_hash : "") || await sha256Hex(`${method}::${raw}`),
          cleaned_text: decision.text,
          removed_categories: Array.from(new Set([...decision.removed, `source_${sourceType}`])),
          quality_status: extract.ok ? REPAIR_STAGED : REPAIR_REJECTED,
          quality_reasons: decision.rescued ? decision.v4_verdict.reasons.map((r) => `v4_${r}`) : decision.verdict.reasons,
          quality_score: 1,
          expected_source_hash: t.current_source_hash ?? null,
          expected_cleaned_sha256: await sha256Hex(String(t.current_cleaned_text || "")),
          verdict_status: decision.verdict.status,
          overlap: extract.overlap,
          source_type: sourceType,
        };
        if (!canaryEligible(s)) continue;
        items.push({
          episode_id: s.episode_id,
          cleaned_text: s.cleaned_text,
          source_hash: s.source_hash,
          cleaner_method: s.cleaner_method,
          removed_categories: s.removed_categories,
          quality_status: s.verdict_status,
          quality_reasons: s.quality_reasons,
          quality_version: CLEAN_TEXT_QUALITY_VERSION,
          source_type: s.source_type,
          expected_source_hash: s.expected_source_hash,
          expected_cleaned_sha256: s.expected_cleaned_sha256,
        });
      }
      if (!items.length) return json({ ok: true, action, applied: 0, reason: "no_canary_eligible_rows" });
      const batchId = crypto.randomUUID();
      const { data, error: applyErr } = await admin.rpc("apply_clean_text_repair_v1", { p_batch_id: batchId, p_items: items });
      if (applyErr) throw applyErr;
      // Mark matching staged candidates as promoted for traceability.
      const now = new Date().toISOString();
      for (const it of items) {
        await admin.from("episode_clean_text_candidates").update({ quality_status: "promoted", promoted_at: now, updated_at: now })
          .eq("episode_id", it.episode_id).eq("cleaner_method", it.cleaner_method).eq("source_hash", it.source_hash);
      }
      return json({ ok: true, action, batch_id: batchId, result: data, episode_ids: items.map((i) => i.episode_id), elapsed_ms: Date.now() - startedAt });
    }

    return json({ ok: false, error: "unknown action" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : (() => { try { return JSON.stringify(e); } catch { return String(e); } })();
    console.error("[clean-text-repair] fatal:", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
