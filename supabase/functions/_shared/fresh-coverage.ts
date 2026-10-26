// Fresh-episode coverage rules for pipeline-watchdog (pure). Input: fresh_episode_coverage_v1
// over episodes published 1–7 days ago with clean text. A share above the limit means a stage is
// not producing output for new episodes, whether its runner is failing, paused or gone.
export const COVERAGE_MIN_EPISODES = 20;
export const COVERAGE_LIMITS: Record<string, { field: string; maxShare: number; label: string }> = {
  missing_embedding: { field: "missing_embedding", maxShare: 0.25, label: "search vector" },
  missing_seo: { field: "missing_seo", maxShare: 0.25, label: "SEO description" },
  missing_entities: { field: "missing_entities", maxShare: 0.25, label: "people/organization extraction" },
  topic_pending: { field: "topic_pending", maxShare: 0.5, label: "topics" },
};

export function coverageAlerts(cov: Record<string, unknown> | null | undefined) {
  const total = Number(cov?.clean_episodes) || 0;
  if (total < COVERAGE_MIN_EPISODES) return [];
  const out: { rule: string; severity: "warn"; reason: string; detail: Record<string, number> }[] = [];
  for (const [rule, lim] of Object.entries(COVERAGE_LIMITS)) {
    const missing = Number(cov?.[lim.field]) || 0;
    const share = missing / total;
    if (share > lim.maxShare) {
      out.push({ rule, severity: "warn", reason: `${missing}/${total} fresh episodes (1–7 days) lack ${lim.label} (${Math.round(share * 100)}%)`,
        detail: { missing, total, share: Number(share.toFixed(3)) } });
    }
  }
  return out;
}
