// Scheduling only: never changes model selection, prompts or acceptance gates.
// Owner decisions (2026-10-25): work that does not compete with visitor-facing processes is not held
// back by the visitor-first gate — the external OpenAI person batch (dedicated API) and the two Astra
// jobs (only problem cases / advisory review, nothing else waits on them). Their own cost caps, leases
// and acceptance policy still apply.
export const EXTERNAL_API_JOBS = new Set(["person_relevance_openai_batch", "entity_description_openai_batch"]);
export const OWNER_GATE_EXEMPT_JOBS = new Set(["entity_astra_audit", "clean_text_astra_review"]);

export function gateExempt(job: string): boolean {
  return EXTERNAL_API_JOBS.has(job) || OWNER_GATE_EXEMPT_JOBS.has(job);
}

export function priorityBlocker(job: string, counts: Record<string, number>): string | null {
  if (gateExempt(job)) return null;
  const first = ["clean_text_pending", "seo_jobs_pending", "embed_podcast_pending", "embed_chunks_missing", "episode_classifier_pending"];
  for (const kind of first) if ((counts[kind] ?? 0) > 0) return kind;
  return null;
}

export function boundedWork(requested: unknown, configured: unknown, fallback: number): number {
  const cap = Math.max(1, Math.floor(Number(configured) || fallback));
  return Math.min(cap, Math.max(1, Math.floor(Number(requested) || cap)));
}

export async function checkProcessingPriority(admin: any, job: string): Promise<string | null> {
  if (gateExempt(job)) return null;
  const { data: row, error } = await admin.from("app_settings").select("value").eq("key", "processing_priority").maybeSingle();
  if (error) return "priority_check_failed";
  if (row?.value?.enabled !== true) return null;
  const counts: Record<string, number> = {};
  const kinds = ["clean_text_pending", "seo_jobs_pending", "embed_podcast_pending", "episode_classifier_pending"];
  const results = await Promise.all(kinds.map(async (kind) => {
    const result = await admin.rpc("count_pipeline_pending", { kind });
    return { kind, ...result };
  }));
  if (results.some((r) => r.error || r.data == null)) return "priority_check_failed";
  for (const result of results) counts[result.kind] = Number(result.data);
  const chunks = await admin.rpc("embed_chunks_candidate_stats", { _model: "google/gemini-embedding-001" });
  if (chunks.error || chunks.data?.missing == null) return "priority_check_failed";
  counts.embed_chunks_missing = Number(chunks.data.missing);
  const blocker = priorityBlocker(job, counts);
  return blocker ? `higher_priority_work:${blocker}` : null;
}
