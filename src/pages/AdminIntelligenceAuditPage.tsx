import { useCallback, useEffect, useMemo, useState } from "react";
import type { ComponentType } from "react";
import Layout from "@/components/Layout";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAdminAccess } from "@/hooks/useAdminAccess";
import { useNoindex } from "@/lib/useNoindex";
import { pct, scoreAuditEpisode, summarizeAudit, type AuditEpisode, type EpisodeAuditScore } from "@/lib/intelligenceAudit";
import { AlertTriangle, Brain, Database, Gauge, RefreshCw, Search, ShieldCheck, Sparkles } from "lucide-react";

const SAMPLE_LIMIT = 80;

type DataQualityTopEpisode = {
  episode_id?: string;
  podcast?: string;
  title?: string;
  rank_label?: string | null;
  published_at?: string | null;
  priority_score?: number;
  issue_codes?: string[];
  raw_length?: number;
  clean_length?: number;
  retention_ratio?: number | null;
  entity_signal_count?: number;
};

type QualityIndicatorTopEpisode = {
  episode_id?: string;
  podcast?: string;
  title?: string;
  rank_label?: string | null;
  podiverzum_rank?: number | null;
  computed_episode_score?: number;
  legacy_episode_rank?: number | null;
  quality_priority_score?: number;
  quality_issue_codes?: string[];
  data_issue_codes?: string[];
};

type DataQualitySnapshot = {
  generated_at?: string;
  recent_days?: number;
  eligible_hu_episodes?: number;
  recent_eligible_hu_episodes?: number;
  episodes_with_issues?: number;
  recent_episodes_with_issues?: number;
  episodes_with_quality_indicator_issues?: number;
  recent_episodes_with_quality_indicator_issues?: number;
  issue_counts?: Record<string, number>;
  recent_issue_counts?: Record<string, number>;
  quality_indicator_issue_counts?: Record<string, number>;
  recent_quality_indicator_issue_counts?: Record<string, number>;
  top_episodes?: DataQualityTopEpisode[];
  top_quality_indicator_episodes?: QualityIndicatorTopEpisode[];
};

type RepairPlanItem = {
  rank?: number;
  episode_id?: string;
  podcast?: string;
  title?: string;
  rank_label?: string | null;
  podiverzum_rank?: number | null;
  published_at?: string | null;
  repair_action?: string;
  issue_codes?: string[];
  may_require_ai?: boolean;
  safety_policy?: string;
  priority_score?: number;
};

type DataRepairPlan = {
  generated_at?: string;
  dry_run?: boolean;
  limit?: number;
  recent_days?: number;
  include_ai?: boolean;
  eligible_repair_actions?: number;
  planned_repair_actions?: number;
  action_counts?: Record<string, number>;
  planned_action_counts?: Record<string, number>;
  ai_counts?: Record<string, number>;
  items?: RepairPlanItem[];
  next_safe_steps?: string[];
};

type DataRepairApplyRun = {
  ok?: boolean;
  dry_run?: boolean;
  action?: string;
  scanned?: number;
  planned?: number;
  applied?: number;
  skipped?: number;
  error?: string | null;
};

export default function AdminIntelligenceAuditPage() {
  useNoindex("Intelligence Audit — Admin");
  const { loading: adminLoading, isAdmin } = useAdminAccess();
  const [rows, setRows] = useState<AuditEpisode[]>([]);
  const [embeddedIds, setEmbeddedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [reprocessBusy, setReprocessBusy] = useState(false);
  const [reprocessPlan, setReprocessPlan] = useState<{ candidate_count?: number; staged?: number; error?: string } | null>(null);
  const [candidateRun, setCandidateRun] = useState<{ processed?: number; passed?: number; rejected?: number; error?: string } | null>(null);
  const [promotionRun, setPromotionRun] = useState<{ scanned?: number; promoted?: number; unchanged?: number; error?: string } | null>(null);
  const [snapshot, setSnapshot] = useState<DataQualitySnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [repairPlan, setRepairPlan] = useState<DataRepairPlan | null>(null);
  const [repairPlanError, setRepairPlanError] = useState<string | null>(null);
  const [repairApplyBusy, setRepairApplyBusy] = useState(false);
  const [repairApplyRun, setRepairApplyRun] = useState<DataRepairApplyRun | null>(null);
  const [filter, setFilter] = useState<"all" | "bad" | "watch">("all");

  const load = useCallback(async () => {
    if (!isAdmin) return;
    setLoading(true);
    setSnapshotError(null);
    setRepairPlanError(null);
    const [snapshotRes, repairPlanRes] = await Promise.all([
      supabase.rpc("get_data_quality_snapshot_v1" as never, {
        _recent_days: 30,
        _sample_limit: 12,
      } as never),
      supabase.rpc("get_data_repair_plan_v1" as never, {
        _limit: 30,
        _recent_days: 90,
        _include_ai: false,
      } as never),
    ]);
    if (snapshotRes.error) {
      setSnapshot(null);
      setSnapshotError(snapshotRes.error.message);
    } else {
      setSnapshot((snapshotRes.data || null) as DataQualitySnapshot | null);
    }
    if (repairPlanRes.error) {
      setRepairPlan(null);
      setRepairPlanError(repairPlanRes.error.message);
    } else {
      setRepairPlan((repairPlanRes.data || null) as DataRepairPlan | null);
    }

    const { data, error } = await supabase
      .from("episodes")
      .select(
        "id,title,description,clean_text_status,ai_entities_version,ai_summary,people,mentioned,companies,organizations,topics,tickers,published_at,podcasts!inner(title,display_title,is_hungarian,shadow_rank_tier)",
      )
      .eq("podcasts.is_hungarian", true)
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(SAMPLE_LIMIT);

    if (error) {
      setRows([]);
      setEmbeddedIds(new Set());
      setLoading(false);
      return;
    }

    const sample = ((data || []) as unknown as AuditEpisode[]);
    const ids = sample.map((r) => r.id);
    const [emb, clean] = ids.length
      ? await Promise.all([
          supabase.from("episode_embeddings").select("episode_id").in("episode_id", ids),
          supabase.from("episode_clean_text").select("episode_id,cleaned_text,cleaner_method,removed_categories,updated_at").in("episode_id", ids),
        ])
      : [{ data: [] }, { data: [] }];

    const cleanById = new Map(
      ((clean.data || []) as Array<{
        episode_id: string;
        cleaned_text: string | null;
        cleaner_method: string | null;
        removed_categories: string[] | null;
        updated_at: string | null;
      }>).map((r) => [r.episode_id, r]),
    );

    setRows(sample.map((row) => ({ ...row, episode_clean_text: cleanById.get(row.id) || null })));
    setEmbeddedIds(new Set(((emb.data || []) as { episode_id: string }[]).map((r) => r.episode_id)));
    setLoading(false);
  }, [isAdmin]);

  useEffect(() => {
    if (adminLoading || !isAdmin) return;
    load();
  }, [adminLoading, isAdmin, load]);

  const callReprocessAdmin = async (action: "plan" | "stage") => {
    setReprocessBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/intelligence-reprocess-admin?action=${action}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ mode: "bad_or_old", limit: 250, tiers: ["S", "A", "B", "C"], dry_run: action === "plan" }),
      });
      const data = await r.json();
      setReprocessPlan(data);
    } catch (e) {
      setReprocessPlan({ error: e instanceof Error ? e.message : "request failed" });
    } finally {
      setReprocessBusy(false);
    }
  };

  const runCandidateCleaner = async () => {
    setReprocessBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/episode-clean-text-candidate-runner`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ batch: 100 }),
      });
      const data = await r.json();
      setCandidateRun(data);
    } catch (e) {
      setCandidateRun({ error: e instanceof Error ? e.message : "request failed" });
    } finally {
      setReprocessBusy(false);
    }
  };

  const promoteCandidates = async () => {
    setReprocessBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/episode-clean-text-candidate-promoter`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ limit: 100 }),
      });
      const data = await r.json();
      setPromotionRun(data);
      if (data?.ok) await load();
    } catch (e) {
      setPromotionRun({ error: e instanceof Error ? e.message : "request failed" });
    } finally {
      setReprocessBusy(false);
    }
  };

  const runNoAiRepairApply = async (dryRun: boolean) => {
    setRepairApplyBusy(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/data-repair-apply-runner`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ action: "neutralize_legacy_episode_rank", limit: 100, dry_run: dryRun }),
      });
      const data = await r.json();
      setRepairApplyRun(data);
      if (data?.ok && !dryRun) await load();
    } catch (e) {
      setRepairApplyRun({ ok: false, error: e instanceof Error ? e.message : "request failed" });
    } finally {
      setRepairApplyBusy(false);
    }
  };

  const scores = useMemo(() => rows.map((row) => scoreAuditEpisode(row, embeddedIds)), [rows, embeddedIds]);
  const summary = useMemo(() => summarizeAudit(scores), [scores]);
  const visible = scores.filter((s) => filter === "all" || s.risk === filter);

  if (adminLoading) return <Layout><div className="container mx-auto py-20">Betöltés...</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Nincs jogosultság.</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-8 max-w-7xl space-y-6">
        <header className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Podiverzum intelligence layer</div>
            <h1 className="text-2xl sm:text-3xl font-semibold mt-1 flex items-center gap-2">
              <Brain className="h-6 w-6 text-primary" /> Intelligence Audit
            </h1>
          </div>
          <Button onClick={load} disabled={loading} variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh sample
          </Button>
        </header>

        <section className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          <Stat icon={ShieldCheck} label="Clean text" value={pct(summary.cleanDone, summary.sampleSize)} sub={`${summary.cleanDone}/${summary.sampleSize}`} />
          <Stat icon={Search} label="Embedded" value={pct(summary.embedded, summary.sampleSize)} sub={`${summary.embedded}/${summary.sampleSize}`} />
          <Stat icon={Sparkles} label="Entity v4" value={pct(summary.entityBackfilled, summary.sampleSize)} sub={`${summary.entityBackfilled}/${summary.sampleSize}`} />
          <Stat label="Dirty clean" value={summary.dirtyCleanText} tone={summary.dirtyCleanText ? "bad" : "ok"} />
          <Stat label="Overclean" value={summary.overCleaned} tone={summary.overCleaned ? "bad" : "ok"} />
          <Stat label="Underclean" value={summary.underCleaned} tone={summary.underCleaned ? "warn" : "ok"} />
          <Stat label="No entities" value={summary.noEntities} tone={summary.noEntities ? "bad" : "ok"} />
          <Stat label="No summary" value={summary.noSummary} tone={summary.noSummary ? "warn" : "ok"} />
        </section>

        <SnapshotPanel snapshot={snapshot} error={snapshotError} />
        <RepairPlanPanel
          plan={repairPlan}
          error={repairPlanError}
          applyRun={repairApplyRun}
          applyBusy={repairApplyBusy}
          onPreviewApply={() => runNoAiRepairApply(true)}
          onApply={() => runNoAiRepairApply(false)}
        />

        <Card className="p-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Button size="sm" variant={filter === "all" ? "default" : "secondary"} onClick={() => setFilter("all")}>All</Button>
            <Button size="sm" variant={filter === "bad" ? "default" : "secondary"} onClick={() => setFilter("bad")}>Bad</Button>
            <Button size="sm" variant={filter === "watch" ? "default" : "secondary"} onClick={() => setFilter("watch")}>Watch</Button>
            <Button size="sm" variant="outline" disabled={reprocessBusy} onClick={() => callReprocessAdmin("plan")}>
              Plan safe refresh
            </Button>
            <Button size="sm" variant="outline" disabled={reprocessBusy || !reprocessPlan?.candidate_count} onClick={() => callReprocessAdmin("stage")}>
              Stage refresh plan
            </Button>
            <Button size="sm" variant="outline" disabled={reprocessBusy || !reprocessPlan?.staged} onClick={runCandidateCleaner}>
              Generate candidates
            </Button>
            <Button size="sm" variant="outline" disabled={reprocessBusy || !candidateRun?.passed} onClick={promoteCandidates}>
              Promote passed
            </Button>
            <div className="text-xs text-muted-foreground ml-auto">
              Recent Hungarian sample: {summary.sampleSize} episodes. This is a diagnostic sample, not a full corpus scan.
            </div>
          </div>
          {reprocessPlan && (
            <div className="mt-3 text-xs text-muted-foreground">
              {reprocessPlan.error
                ? `Reprocess admin error: ${reprocessPlan.error}`
                : reprocessPlan.staged !== undefined
                  ? `Staged ${reprocessPlan.staged} episodes for safe clean-text refresh. Existing clean text remains live until promotion.`
                  : `Plan found ${reprocessPlan.candidate_count ?? 0} bad/old clean-text rows in the selected batch.`}
            </div>
          )}
          {candidateRun && (
            <div className="mt-2 text-xs text-muted-foreground">
              {candidateRun.error
                ? `Candidate runner error: ${candidateRun.error}`
                : `Generated ${candidateRun.processed ?? 0} candidates: ${candidateRun.passed ?? 0} passed, ${candidateRun.rejected ?? 0} rejected. Live clean text was not overwritten.`}
            </div>
          )}
          {promotionRun && (
            <div className="mt-2 text-xs text-muted-foreground">
              {promotionRun.error
                ? `Candidate promotion error: ${promotionRun.error}`
                : `Promoted ${promotionRun.promoted ?? 0} changed clean-text rows. ${promotionRun.unchanged ?? 0} unchanged rows were skipped without invalidating AI work.`}
            </div>
          )}
        </Card>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-xs">
            <thead className="bg-secondary text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2">Episode</th>
                <th className="text-right px-3 py-2">Raw</th>
                <th className="text-right px-3 py-2">Clean</th>
                <th className="text-right px-3 py-2">Keep</th>
                <th className="text-left px-3 py-2">Signals</th>
                <th className="text-left px-3 py-2">Missing</th>
                <th className="text-right px-3 py-2">Entities</th>
                <th className="text-left px-3 py-2">Risk</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((s) => <AuditRow key={s.id} score={s} />)}
            </tbody>
          </table>
        </div>
      </div>
    </Layout>
  );
}

function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon?: ComponentType<{ className?: string }>;
  tone?: "default" | "ok" | "warn" | "bad";
}) {
  const toneClass = tone === "bad" ? "text-destructive" : tone === "warn" ? "text-amber-500" : tone === "ok" ? "text-emerald-500" : "text-foreground";
  return (
    <div className="p-3 rounded-lg border border-border bg-card min-h-[88px]">
      <div className="flex items-center gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {label}
      </div>
      <div className={`text-xl font-semibold mt-1 ${toneClass}`}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function SnapshotPanel({ snapshot, error }: { snapshot: DataQualitySnapshot | null; error: string | null }) {
  if (error) {
    return (
      <Card className="p-4 border-amber-500/30 bg-amber-500/5">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
          <AlertTriangle className="h-4 w-4" />
          DB quality snapshot unavailable
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {error}. The sample audit below still works; the full snapshot appears after the latest Supabase migration is deployed.
        </div>
      </Card>
    );
  }

  if (!snapshot) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Database className="h-4 w-4" />
          Loading DB-wide quality snapshot...
        </div>
      </Card>
    );
  }

  const eligible = Number(snapshot.eligible_hu_episodes || 0);
  const recentEligible = Number(snapshot.recent_eligible_hu_episodes || 0);
  const issueTotal = Number(snapshot.episodes_with_issues || 0);
  const recentIssueTotal = Number(snapshot.recent_episodes_with_issues || 0);
  const qualityIssueTotal = Number(snapshot.episodes_with_quality_indicator_issues || 0);
  const recentQualityIssueTotal = Number(snapshot.recent_episodes_with_quality_indicator_issues || 0);

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Database className="h-5 w-5 text-primary" />
            DB-wide quality snapshot
          </h2>
          <div className="text-xs text-muted-foreground">
            {snapshot.generated_at ? `Generated ${new Date(snapshot.generated_at).toLocaleString()}` : "Generated by Supabase RPC"}
          </div>
        </div>
        <Badge variant="outline">Recent window: {snapshot.recent_days || 30}d</Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
        <Stat icon={Database} label="HU episodes" value={eligible} sub={`recent ${recentEligible}`} />
        <Stat label="Data issues" value={pct(issueTotal, eligible)} sub={`${issueTotal}/${eligible}`} tone={issueTotal ? "warn" : "ok"} />
        <Stat label="Recent data issues" value={pct(recentIssueTotal, recentEligible)} sub={`${recentIssueTotal}/${recentEligible}`} tone={recentIssueTotal ? "warn" : "ok"} />
        <Stat icon={Gauge} label="Quality badge issues" value={pct(qualityIssueTotal, eligible)} sub={`${qualityIssueTotal}/${eligible}`} tone={qualityIssueTotal ? "bad" : "ok"} />
        <Stat label="Recent badge issues" value={pct(recentQualityIssueTotal, recentEligible)} sub={`${recentQualityIssueTotal}/${recentEligible}`} tone={recentQualityIssueTotal ? "bad" : "ok"} />
        <Stat label="Top repair rows" value={(snapshot.top_episodes || []).length + (snapshot.top_quality_indicator_episodes || []).length} />
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <IssueCounts title="Data issue counts" counts={snapshot.issue_counts || {}} recentCounts={snapshot.recent_issue_counts || {}} />
        <IssueCounts title="Quality indicator issue counts" counts={snapshot.quality_indicator_issue_counts || {}} recentCounts={snapshot.recent_quality_indicator_issue_counts || {}} />
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <TopDataQualityRows rows={snapshot.top_episodes || []} />
        <TopQualityIndicatorRows rows={snapshot.top_quality_indicator_episodes || []} />
      </div>
    </section>
  );
}

function RepairPlanPanel({
  plan,
  error,
  applyRun,
  applyBusy,
  onPreviewApply,
  onApply,
}: {
  plan: DataRepairPlan | null;
  error: string | null;
  applyRun: DataRepairApplyRun | null;
  applyBusy: boolean;
  onPreviewApply: () => void;
  onApply: () => void;
}) {
  if (error) {
    return (
      <Card className="p-4 border-amber-500/30 bg-amber-500/5">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-600">
          <AlertTriangle className="h-4 w-4" />
          Data repair plan unavailable
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {error}. The planner appears after the latest Supabase migration is deployed.
        </div>
      </Card>
    );
  }

  if (!plan) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4" />
          Loading dry-run repair plan...
        </div>
      </Card>
    );
  }

  const items = plan.items || [];
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" />
            Dry-run data repair plan
          </h2>
          <div className="text-xs text-muted-foreground">
            No mutation, no AI spend. Recent window: {plan.recent_days || 90}d. AI included: {plan.include_ai ? "yes" : "no"}.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={applyBusy} onClick={onPreviewApply}>
            Preview no-AI apply
          </Button>
          <Button size="sm" variant="outline" disabled={applyBusy} onClick={onApply}>
            Apply legacy rank reset
          </Button>
          <Badge variant={plan.dry_run === false ? "destructive" : "outline"}>{plan.dry_run === false ? "apply mode" : "dry-run"}</Badge>
        </div>
      </div>

      {applyRun && (
        <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${
          applyRun.error ? "border-destructive/30 bg-destructive/10 text-destructive" : "border-border bg-secondary/40 text-muted-foreground"
        }`}>
          {applyRun.error
            ? `No-AI repair apply error: ${applyRun.error}`
            : `${applyRun.dry_run ? "Previewed" : "Applied"} ${applyRun.action || "repair"}: planned ${applyRun.planned ?? 0}, applied ${applyRun.applied ?? 0}, skipped ${applyRun.skipped ?? 0}.`}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
        <Stat label="Eligible actions" value={plan.eligible_repair_actions || 0} />
        <Stat label="Planned actions" value={plan.planned_repair_actions || 0} />
        <Stat label="No-AI actions" value={plan.ai_counts?.false || 0} tone="ok" />
        <Stat label="AI actions" value={plan.ai_counts?.true || 0} tone={plan.ai_counts?.true ? "warn" : "ok"} />
      </div>

      <div className="grid lg:grid-cols-2 gap-3 mt-4">
        <IssueCounts title="Planned action counts" counts={plan.planned_action_counts || {}} recentCounts={{}} />
        <Card className="p-4">
          <div className="text-sm font-medium">Safe sequence</div>
          <div className="mt-3 space-y-2">
            {(plan.next_safe_steps || []).map((step) => (
              <div key={step} className="text-xs text-muted-foreground">{step}</div>
            ))}
          </div>
        </Card>
      </div>

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-xs">
          <thead className="bg-secondary text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">Action</th>
              <th className="text-left px-3 py-2">Episode</th>
              <th className="text-left px-3 py-2">Issues</th>
              <th className="text-left px-3 py-2">Policy</th>
              <th className="text-right px-3 py-2">Priority</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={5} className="px-3 py-4 text-muted-foreground">No planned repair actions.</td></tr>
            ) : items.slice(0, 30).map((item) => (
              <tr key={`${item.rank}:${item.episode_id}:${item.repair_action}`} className="border-t border-border/60">
                <td className="px-3 py-2 min-w-[170px]">
                  <div className="font-mono text-[11px]">{item.repair_action || "repair"}</div>
                  <div className="text-muted-foreground">{item.may_require_ai ? "AI gated" : "no AI"}</div>
                </td>
                <td className="px-3 py-2 min-w-[260px]">
                  <div className="font-medium line-clamp-1">{item.title || "Untitled episode"}</div>
                  <div className="text-muted-foreground line-clamp-1">{item.podcast || "Unknown podcast"}</div>
                </td>
                <td className="px-3 py-2 min-w-[220px]"><BadgeList values={item.issue_codes || []} empty="-" /></td>
                <td className="px-3 py-2 min-w-[240px] text-muted-foreground">{item.safety_policy || "-"}</td>
                <td className="px-3 py-2 text-right tabular-nums">{item.priority_score ?? 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function IssueCounts({ title, counts, recentCounts }: { title: string; counts: Record<string, number>; recentCounts: Record<string, number> }) {
  const items = Object.entries(counts).sort((a, b) => Number(b[1]) - Number(a[1])).slice(0, 10);
  return (
    <Card className="p-4">
      <div className="text-sm font-medium">{title}</div>
      {items.length === 0 ? (
        <div className="mt-2 text-xs text-muted-foreground">No issues detected.</div>
      ) : (
        <div className="mt-3 space-y-2">
          {items.map(([code, total]) => (
            <div key={code} className="flex items-center justify-between gap-3 text-xs">
              <span className="truncate font-mono text-muted-foreground">{code}</span>
              <span className="tabular-nums whitespace-nowrap">
                {total}
                {Object.keys(recentCounts).length > 0 && <span className="text-muted-foreground"> / recent {recentCounts[code] || 0}</span>}
              </span>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TopDataQualityRows({ rows }: { rows: DataQualityTopEpisode[] }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-medium">Highest-priority repair queue</div>
      <div className="mt-3 space-y-3">
        {rows.length === 0 ? <div className="text-xs text-muted-foreground">No repair rows.</div> : rows.map((row) => {
          const keep = row.retention_ratio == null ? "-" : `${Math.round(Number(row.retention_ratio) * 100)}%`;
          return (
            <div key={row.episode_id || `${row.podcast}:${row.title}`} className="border-t border-border/60 pt-3 first:border-t-0 first:pt-0">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-medium line-clamp-1">{row.title || "Untitled episode"}</div>
                  <div className="text-[11px] text-muted-foreground line-clamp-1">{row.podcast || "Unknown podcast"}</div>
                </div>
                <Badge variant="outline" className="shrink-0">P{row.priority_score ?? 0}</Badge>
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                raw {row.raw_length ?? 0} · clean {row.clean_length ?? 0} · keep {keep} · entities {row.entity_signal_count ?? 0}
              </div>
              <BadgeList values={row.issue_codes || []} empty="complete" />
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function TopQualityIndicatorRows({ rows }: { rows: QualityIndicatorTopEpisode[] }) {
  return (
    <Card className="p-4">
      <div className="text-sm font-medium">Quality indicator queue</div>
      <div className="mt-3 space-y-3">
        {rows.length === 0 ? <div className="text-xs text-muted-foreground">No quality indicator issues.</div> : rows.map((row) => (
          <div key={row.episode_id || `${row.podcast}:${row.title}`} className="border-t border-border/60 pt-3 first:border-t-0 first:pt-0">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-xs font-medium line-clamp-1">{row.title || "Untitled episode"}</div>
                <div className="text-[11px] text-muted-foreground line-clamp-1">{row.podcast || "Unknown podcast"}</div>
              </div>
              <Badge variant="outline" className="shrink-0">P{row.quality_priority_score ?? 0}</Badge>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              shown {Number(row.podiverzum_rank ?? 0).toFixed(1)} · computed ep {Math.round(Number(row.computed_episode_score ?? 0))} · legacy {row.legacy_episode_rank ?? "-"}
            </div>
            <BadgeList values={row.quality_issue_codes || []} empty="ok" />
            {(row.data_issue_codes || []).length > 0 && (
              <div className="mt-1">
                <BadgeList values={row.data_issue_codes || []} empty="data ok" />
              </div>
            )}
          </div>
        ))}
      </div>
    </Card>
  );
}

function AuditRow({ score }: { score: EpisodeAuditScore }) {
  const riskClass =
    score.risk === "bad" ? "bg-destructive/10 text-destructive border-destructive/30"
    : score.risk === "watch" ? "bg-amber-500/10 text-amber-600 border-amber-500/30"
    : "bg-emerald-500/10 text-emerald-600 border-emerald-500/30";

  return (
    <tr className="border-t border-border/60">
      <td className="px-3 py-2 min-w-[280px]">
        <div className="font-medium line-clamp-1">{score.title}</div>
        <div className="text-muted-foreground line-clamp-1">{score.podcastTitle}</div>
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{score.rawLength}</td>
      <td className="px-3 py-2 text-right tabular-nums">{score.cleanLength}</td>
      <td className="px-3 py-2 text-right tabular-nums">{score.retentionRatio === null ? "-" : `${Math.round(score.retentionRatio * 100)}%`}</td>
      <td className="px-3 py-2">
        <BadgeList values={score.dirtySignals} empty="clean" />
      </td>
      <td className="px-3 py-2">
        <BadgeList values={score.missingSignals} empty="complete" />
      </td>
      <td className="px-3 py-2 text-right tabular-nums">{score.entityCount}</td>
      <td className="px-3 py-2">
        <Badge variant="outline" className={riskClass}>{score.risk}</Badge>
      </td>
    </tr>
  );
}

function BadgeList({ values, empty }: { values: string[]; empty: string }) {
  if (!values.length) return <span className="text-muted-foreground">{empty}</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((v) => <Badge key={v} variant="secondary" className="text-[10px]">{v}</Badge>)}
    </div>
  );
}
