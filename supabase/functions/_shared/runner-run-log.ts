// Durable run log in public.pipeline_runner_runs: one row per invocation that actually
// starts work, closed with outcome ok/error. A worker killed by the platform leaves the
// row "running" with a stale heartbeat, which the health snapshot counts as killed, so
// cron dispatch success is never mistaken for a completed run. Telemetry only: a failed
// log write never affects the run.
export function runLog(admin: any, runner: string) {
  let id: string | null = null;
  return {
    get id() { return id; },
    async start(meta: Record<string, unknown> = {}) {
      try {
        const { data } = await admin.from("pipeline_runner_runs").insert({ runner, stage: "start", meta }).select("id").single();
        id = data?.id ?? null;
      } catch (_) { id = null; }
    },
    async beat(stage: string) {
      if (!id) return;
      try { await admin.from("pipeline_runner_runs").update({ stage, heartbeat_at: new Date().toISOString() }).eq("id", id); } catch (_) { /* telemetry */ }
    },
    async finish(outcome: "ok" | "error", meta: Record<string, unknown> = {}, error?: string | null) {
      if (!id) return;
      try {
        const now = new Date().toISOString();
        await admin.from("pipeline_runner_runs").update({ outcome, finished_at: now, heartbeat_at: now, stage: "done", meta, error: error ? String(error).slice(0, 500) : null }).eq("id", id);
      } catch (_) { /* telemetry */ }
    },
  };
}
