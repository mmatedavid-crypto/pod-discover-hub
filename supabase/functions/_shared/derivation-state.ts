// Clean-text version tracking for derived results (entity / topic / SEO).
// The DB owns the fingerprint (public.clean_text_content_hash: whitespace-normalized
// sha256 of cleaned_text) and per-episode state (episode_derivation_state, maintained
// by a trigger on episode_clean_text). Runners read text + hash in one consistent
// call and report which hash a result was built from; the DB marks it "current"
// only when that hash still equals the live clean text, so a change that lands
// while a run is in flight is never lost.

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

/** Best-effort: a failed mark leaves the episode stale (re-dispatched later), never wrongly current. */
export async function markDerivation(admin: any, stage: DerivationStage, items: DerivationMark[]): Promise<void> {
  const list = items.filter((i) => i.episode_id && (i.used_hash || i.result === "not_applicable" || i.result === "blocked" || i.result === "error"));
  for (let i = 0; i < list.length; i += 200) {
    const { error } = await admin.rpc("mark_episode_derivation_v1", { p_stage: stage, p_items: list.slice(i, i + 200) });
    if (error) console.warn("mark_episode_derivation_v1", stage, error.message);
  }
}

export function normalizeForPrompt(text: string): string {
  return String(text || "").replace(/\s+/g, " ").trim();
}

/**
 * Which clean-text version a pre-built SEO prompt used: the live hash only when the
 * prompt actually contains the start of the live clean text (enqueue-time prompts can
 * be older than the current text). Otherwise null = not built from the current version.
 */
export function promptUsedCleanHash(prompt: string, cleanText: string, hash: string | null): string | null {
  if (!hash) return null;
  const norm = normalizeForPrompt(cleanText);
  if (norm.length < 80) return null;
  return String(prompt || "").includes(norm.slice(0, 200)) ? hash : null;
}

/** ai_enrichment_jobs input_hash for a stale-derivation SEO job: one job per clean-text version. */
export function derivationSeoJobKey(cleanHash: string): string {
  return `derivation:clean:${cleanHash}`;
}
