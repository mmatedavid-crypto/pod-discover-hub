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
  } catch (e) {
    // Fail-CLOSED: if the guard check itself fails (e.g. DB under pressure),
    // block background work. Public frontend reads do NOT use this guard.
    return { blocked: true, reason: `background_guard_check_failed (job=${jobName}): ${(e as any)?.message || e}` };
  }
}

export async function checkSocialAutomationAllowed(admin: any, jobName: string): Promise<{ blocked: boolean; reason?: string }> {
  try {
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "social_automation_controls")
      .maybeSingle();
    const v = (data?.value || {}) as any;
    if (v.enabled === false) return { blocked: true, reason: `social_automation_disabled (job=${jobName})` };
    if (v.allow_manual_posting === false && jobName.includes("manual")) {
      return { blocked: true, reason: `social_manual_posting_disabled (job=${jobName})` };
    }
    return { blocked: false };
  } catch (e) {
    return { blocked: true, reason: `social_automation_guard_failed (job=${jobName}): ${(e as any)?.message || e}` };
  }
}
