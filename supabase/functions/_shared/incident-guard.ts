// Central kill-switch for background jobs.
// Reads `app_settings.background_jobs` => { enabled: boolean, incident_mode: boolean }.
// If incident_mode=true OR enabled=false, returns blocked=true; caller should exit early.
// Public reads do NOT use this guard.
export async function checkBackgroundJobsAllowed(admin: any, jobName: string): Promise<{ blocked: boolean; reason?: string }> {
  try {
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "background_jobs")
      .maybeSingle();
    const v = (data?.value || {}) as any;
    const enabled = v.enabled !== false; // default true
    const incident = v.incident_mode === true;
    if (incident) return { blocked: true, reason: `incident_mode=true (job=${jobName})` };
    if (!enabled) return { blocked: true, reason: `background_jobs_enabled=false (job=${jobName})` };
    return { blocked: false };
  } catch {
    // Fail-open: never block public reads, but background jobs run normally if flag missing
    return { blocked: false };
  }
}
