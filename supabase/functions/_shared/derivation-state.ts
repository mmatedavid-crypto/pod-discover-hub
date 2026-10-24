// Clean-text version tracking for derived results (entity / topic / SEO).
// The DB owns the fingerprint (public.clean_text_content_hash: whitespace-normalized
// sha256 of cleaned_text) and per-episode state (episode_derivation_state, maintained
// by a trigger on episode_clean_text). Runners read text + hash in one consistent
// call, record the exact input version they used, and persist results only through
// the apply_episode_*_v1 RPCs: result write and state change happen in one transaction
// serialized against clean-text updates, so a change that lands while a run is in
// flight is never lost and an older result never overwrites a newer one.

export type DerivationInput = { text: string; method: string; hash: string | null };
export type DerivationStage = "entity" | "topic" | "seo";
export type DerivationMark = { episode_id: string; used_hash: string | null; result?: "done" | "not_applicable" | "blocked" | "error"; reason?: string };

export async function loadDerivationInputs(admin: any, ids: string[]): Promise<Map<string, DerivationInput>> {
  const out = new Map<string, DerivationInput>();
  const uniq = Array.from(new Set(ids.filter(Boolean)));
  for (let i = 0; i < uniq.length; i += 200) {
    const { data, error } = await admin.rpc("get_episode_derivation_inputs_v1", { p_ids: uniq.slice(i, i + 200) });
    if (error) throw error;
    for (const r of (data || []) as any[]) {
      out.set(String(r.episode_id), { text: String(r.cleaned_text || ""), method: String(r.cleaner_method || ""), hash: r.clean_hash ? String(r.clean_hash) : null });
    }
  }
  return out;
}

/** Skips / errors only (no result write). Best-effort: a failed mark leaves the stage stale/queued, never wrongly current. */
export async function markDerivation(admin: any, stage: DerivationStage, items: DerivationMark[]): Promise<void> {
  const list = items.filter((i) => i.episode_id && (i.used_hash || i.result === "not_applicable" || i.result === "blocked" || i.result === "error"));
  for (let i = 0; i < list.length; i += 200) {
    const { error } = await admin.rpc("mark_episode_derivation_v1", { p_stage: stage, p_items: list.slice(i, i + 200) });
    if (error) console.warn("mark_episode_derivation_v1", stage, error.message);
  }
}

// ---------------- SEO input provenance (exact, recorded when the prompt is built) ----------------

export const SEO_INPUT_POLICY = "seo-input-v1";

export type SeoInputProvenance = {
  policy: typeof SEO_INPUT_POLICY;
  /** What the prompt is primarily built from. */
  primary: "transcript" | "clean_text" | "description" | "none";
  /** True when the clean text actually went into the prompt (mirrors episodeUserPrompt: ≥80 chars). */
  clean_used: boolean;
  /** Fingerprint of the clean-text version that went into the prompt (from the same DB read). */
  clean_hash: string | null;
  clean_method: string | null;
};

/** Mirrors the input rules of episodeUserPrompt (_shared/seo-prompt.ts). */
export function seoInputProvenance(a: { transcript?: string | null; cleanText?: string | null; cleanHash?: string | null; cleanMethod?: string | null; description?: string | null }): SeoInputProvenance {
  const hasTranscript = typeof a.transcript === "string" && a.transcript.trim().length > 200;
  const cleanUsed = String(a.cleanText || "").trim().length >= 80;
  const primary = hasTranscript ? "transcript" : cleanUsed ? "clean_text" : String(a.description || "").trim() ? "description" : "none";
  return {
    policy: SEO_INPUT_POLICY,
    primary,
    clean_used: cleanUsed,
    clean_hash: cleanUsed ? (a.cleanHash ?? null) : null,
    clean_method: cleanUsed ? (a.cleanMethod ?? null) : null,
  };
}

/**
 * May a pre-built (enqueue-time) prompt be sent? Never infer a version from prompt text:
 * - recorded provenance whose clean version is still live → use it;
 * - recorded provenance from an older clean version, or a prompt without clean text while
 *   usable clean text now exists → rebuild from the current approved input first;
 * - legacy prompt without provenance → may run, but its freshness stays unknown (never current).
 */
export function prebuiltPromptDecision(prov: any, live: { hash: string | null; usable: boolean }): "use" | "rebuild" | "use_unknown" {
  if (!prov || prov.policy !== SEO_INPUT_POLICY) return "use_unknown";
  if (prov.clean_used) return prov.clean_hash && live.hash && prov.clean_hash === live.hash ? "use" : "rebuild";
  return live.usable ? "rebuild" : "use";
}

/** The clean-text version a finished SEO result is recorded against: only the one that went into the prompt. */
export function seoUsedCleanHash(prov: SeoInputProvenance | null | undefined): string | null {
  return prov && prov.policy === SEO_INPUT_POLICY && prov.clean_used ? prov.clean_hash : null;
}

/** RPC "primary" argument: legacy jobs without provenance are "unknown". */
export function seoPrimary(prov: SeoInputProvenance | null | undefined): string {
  return prov && prov.policy === SEO_INPUT_POLICY ? prov.primary : "unknown";
}

/** ai_enrichment_jobs input_hash for a stale-derivation SEO job: one job per clean-text version. */
export function derivationSeoJobKey(cleanHash: string): string {
  return `derivation:clean:${cleanHash}`;
}

/**
 * Derivation mark for an SEO job that exhausted its attempts: "blocked" for exactly the
 * clean-text version the job was built for (its recorded provenance, or the version key of a
 * stale-derivation job). Null when the version is unknown — then nothing is marked.
 */
export function terminalSeoFailureMark(
  job: { kind?: string; target_id?: string; input_hash?: string | null },
  prov: SeoInputProvenance | null,
  error: string,
): DerivationMark | null {
  if (job?.kind !== "seo_episode" || !job.target_id) return null;
  const key = String(job.input_hash || "");
  const used = seoUsedCleanHash(prov) || (key.startsWith("derivation:clean:") ? key.slice("derivation:clean:".length) : null);
  if (!used) return null;
  return { episode_id: job.target_id, used_hash: used, result: "blocked", reason: `seo_job_failed:${String(error || "error")}`.slice(0, 120) };
}

/** Effective stale-derivation dispatch batch: 10..60 (stored per_run / daily cap still bound it in SQL). */
export function dispatchBatchClamp(n: number): number {
  return Math.max(10, Math.min(60, Math.floor(Number.isFinite(n) ? n : 20)));
}

/** Next batch after a successful dispatch: grow when fast (<3 s), shrink when slow (>5 s). */
export function nextDispatchBatch(current: number, ms: number): number {
  if (ms < 3000) return dispatchBatchClamp(current + 10);
  if (ms > 5000) return dispatchBatchClamp(current - 10);
  return dispatchBatchClamp(current);
}

