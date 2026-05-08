import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type LastRun = {
  ts?: string;
  mode?: string;
  considered?: number;
  updated?: number;
  skipped?: number;
  errors?: number;
  duration_ms?: number;
  remaining_needing_change?: number;
  remaining_legacy_labels?: number;
  null_rank_label_count?: number;
  mismatch_count?: number;
};

type Status = {
  total_podcasts?: number;
  null_rank_label?: number;
  legacy_label_count?: number;
  mismatch_count?: number;
  shadow_null_count?: number;
  shadow_tier_mismatch?: number;
  remaining_needing_change?: number;
  latest_rank_updated_at?: string | null;
  latest_shadow_computed_at?: string | null;
  last_run?: { last_run?: LastRun };
};

export function FormulaCRunnerPanel() {
  const [status, setStatus] = useState<Status | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const { data } = await supabase.rpc("formula_c_status" as any);
      setStatus((data as any) || null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, []);

  const lr = status?.last_run?.last_run;
  const remaining = status?.remaining_needing_change ?? 0;
  const errors = lr?.errors ?? 0;
  const lastTs = lr?.ts ? new Date(lr.ts) : null;
  const ageSec = lastTs ? Math.floor((Date.now() - lastTs.getTime()) / 1000) : null;
  const health =
    !lastTs ? "idle" :
    errors > 0 ? "error" :
    ageSec !== null && ageSec > 30 * 60 ? "stale" :
    remaining === 0 ? "idle" : "healthy";
  const healthCls =
    health === "healthy" ? "bg-green-500/15 text-green-700 dark:text-green-400 border-green-500/30" :
    health === "error"   ? "bg-destructive/15 text-destructive border-destructive/30" :
    health === "stale"   ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30" :
    "bg-muted text-muted-foreground border-border";

  return (
    <section className="p-4 rounded-lg border border-border bg-card">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">Formula C runner — automation status</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Cron <code>podiverzum-formula-c-runner</code> every 10 minutes, batch 50.
            Reassigns S/A/B/C/D/E from <code>podiverzum_rank</code> using the v3 ladder.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`text-xs px-2 py-1 rounded border ${healthCls}`}>{health}</span>
          <button
            onClick={refresh}
            disabled={loading}
            className="text-xs px-2 py-1 rounded border border-border hover:bg-muted"
          >
            {loading ? "…" : "Refresh"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
        <Cell label="Last run" value={lastTs ? `${lastTs.toLocaleTimeString()} (${ageSec}s ago)` : "never"} />
        <Cell label="Updated last run" value={lr?.updated ?? "—"} />
        <Cell label="Errors last run" value={errors} bad={errors > 0} />
        <Cell label="Run duration (ms)" value={lr?.duration_ms ?? "—"} />
        <Cell label="Remaining needing change" value={remaining} bad={remaining > 0} />
        <Cell label="Legacy labels remaining" value={status?.legacy_label_count ?? "—"} bad={(status?.legacy_label_count ?? 0) > 0} />
        <Cell label="NULL rank_label" value={status?.null_rank_label ?? "—"} bad={(status?.null_rank_label ?? 0) > 0} />
        <Cell label="Mismatch (label vs ladder)" value={status?.mismatch_count ?? "—"} bad={(status?.mismatch_count ?? 0) > 0} />
        <Cell label="Shadow NULL" value={status?.shadow_null_count ?? "—"} />
        <Cell label="Shadow tier mismatch" value={status?.shadow_tier_mismatch ?? "—"} />
        <Cell label="Latest rank_updated_at" value={status?.latest_rank_updated_at ? new Date(status.latest_rank_updated_at).toLocaleString() : "—"} />
        <Cell label="Latest shadow_computed_at" value={status?.latest_shadow_computed_at ? new Date(status.latest_shadow_computed_at).toLocaleString() : "—"} />
      </div>
    </section>
  );
}

function Cell({ label, value, bad }: { label: string; value: any; bad?: boolean }) {
  return (
    <div className="p-2 rounded border border-border">
      <div className="text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold ${bad ? "text-destructive" : ""}`}>{String(value)}</div>
    </div>
  );
}
