// Scheduling only: never changes model selection, prompts or acceptance gates.
// Owner decision (2026-10-25): work that runs on a dedicated external API used by no visitor-facing
// process does not compete with visitor work, so the visitor-first gate does not hold it back.
// Its own cost caps, leases and acceptance policy still apply.
export const EXTERNAL_API_JOBS = new Set(["person_relevance_openai_batch"]);

export function priorityBlocker(job: string, counts: Record<string, number>): string | null {
  if (EXTERNAL_API_JOBS.has(job)) return null;
  const first = ["clean_text_pending", "seo_jobs_pending", "embed_podcast_pending", "embed_chunks_missing", "episode_classifier_pending"];
  for (const kind of first) if ((counts[kind] ?? 0) > 0) return kind;
  if (job === "entity_astra_audit" && (counts.public_person_mentions_pending ?? 0) > 0) return "public_person_mentions_pending";
  return null;
}

export function boundedWork(requested: unknown, configured: unknown, fallback: number): number {
  const cap = Math.max(1, Math.floor(Number(configured) || fallback));
  return Math.min(cap, Math.max(1, Math.floor(Number(requested) || cap)));
}

export async function checkProcessingPriority(admin: any, job: string): Promise<string | null> {
  if (EXTERNAL_API_JOBS.has(job)) return null;
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
  if (job === "entity_astra_audit") {
    const mentions = await admin.from("person_episode_mentions")
      .select("id,people!inner(is_public),podcasts!person_episode_mentions_podcast_id_fkey!inner(language_decision,is_hungarian)")
      .in("relevance_status", ["pending", "in_progress"])
      .eq("people.is_public", true).eq("podcasts.is_hungarian", true)
      .eq("podcasts.language_decision", "accept_hungarian").limit(1);
    if (mentions.error) return "priority_check_failed";
    counts.public_person_mentions_pending = mentions.data?.length || 0;
  }
  const blocker = priorityBlocker(job, counts);
  return blocker ? `higher_priority_work:${blocker}` : null;
}
