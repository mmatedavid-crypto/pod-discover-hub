import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";

function fmtDate(s?: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}

function nextRunUtc(): Date {
  // Twice daily: 04:00 UTC and 16:00 UTC
  const now = new Date();
  const candidates = [4, 16].map((h) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 0, 0));
    if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  });
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0];
}

export default function GrowthStatusPage() {
  const [loading, setLoading] = useState(true);
  const [lastRun, setLastRun] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [counts, setCounts] = useState({
    podcasts: 0, activePodcasts: 0, episodes: 0, newEpisodes24h: 0,
    newPodcasts24h: 0, avgRank: 0, failedFeeds: 0, queue: 0,
  });
  const [cronWarning, setCronWarning] = useState(false);

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

      const [
        runRes, settingsRes,
        podsRes, activeRes, episodesRes,
        newEpsRes, newPodsRes, avgRes, failedRes, queueRes,
      ] = await Promise.all([
        supabase.from("growth_runs").select("*").order("started_at", { ascending: false }).limit(1),
        supabase.from("app_settings").select("value").eq("key", "growth").maybeSingle(),
        supabase.from("podcasts").select("id", { count: "exact", head: true }),
        supabase.from("podcasts").select("id", { count: "exact", head: true }).eq("rss_status", "active"),
        supabase.from("episodes").select("id", { count: "exact", head: true }),
        supabase.from("episodes").select("id", { count: "exact", head: true }).gte("created_at", since),
        supabase.from("podcasts").select("id", { count: "exact", head: true }).gte("created_at", since).eq("source", "discovery_auto"),
        supabase.from("podcasts").select("podiverzum_rank"),
        supabase.from("podcasts").select("id", { count: "exact", head: true }).eq("rss_status", "failed"),
        supabase.from("discovery_queue").select("id", { count: "exact", head: true }).eq("status", "pending"),
      ]);

      const ranks = (avgRes.data || []).map((r: any) => r.podiverzum_rank || 0);
      const avg = ranks.length ? ranks.reduce((a: number, b: number) => a + b, 0) / ranks.length : 0;

      setLastRun(runRes.data?.[0] || null);
      setSettings((settingsRes.data?.value as any) || null);
      setCounts({
        podcasts: podsRes.count || 0,
        activePodcasts: activeRes.count || 0,
        episodes: episodesRes.count || 0,
        newEpisodes24h: newEpsRes.count || 0,
        newPodcasts24h: newPodsRes.count || 0,
        avgRank: Math.round(avg * 10) / 10,
        failedFeeds: failedRes.count || 0,
        queue: queueRes.count || 0,
      });

      // Cron warning: if no successful run in last 20h, assume schedule unconfirmed
      const last = runRes.data?.[0];
      const ageH = last?.started_at ? (Date.now() - new Date(last.started_at).getTime()) / 3600000 : 9999;
      setCronWarning(!last || ageH > 20);
      setLoading(false);
    })();
  }, []);

  const lastAgeH = lastRun?.finished_at && lastRun?.ok
    ? (Date.now() - new Date(lastRun.finished_at).getTime()) / 3600000 : 9999;
  let health: { label: string; variant: "default" | "secondary" | "destructive" } = { label: "Error", variant: "destructive" };
  if (lastAgeH <= 18) health = { label: "Healthy", variant: "default" };
  else if (lastAgeH <= 36) health = { label: "Warning", variant: "secondary" };

  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Growth status</h1>
          <p className="text-muted-foreground">Read-only view of Podiverzum's autonomous growth.</p>
        </div>

        <div className="flex items-center gap-3">
          <Badge variant={health.variant} className="text-sm px-3 py-1">{health.label}</Badge>
          <span className="text-sm text-muted-foreground">
            Autonomous growth: {settings?.autonomous_growth_enabled ? "ON" : "OFF"} · Auto-add: {settings?.auto_add_enabled ? "ON" : "OFF"}
          </span>
        </div>

        {cronWarning && (
          <Alert variant="destructive">
            <AlertTitle>Automatic schedule not confirmed yet</AlertTitle>
            <AlertDescription>
              No recent successful run within the expected 12-hour window. An admin needs to schedule the two daily cron jobs (04:00 UTC and 16:00 UTC) on Lovable Cloud.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Stat title="Total podcasts" value={counts.podcasts} />
          <Stat title="Active podcasts" value={counts.activePodcasts} />
          <Stat title="Total episodes" value={counts.episodes} />
          <Stat title="Average Podiverzum Rank" value={counts.avgRank} />
          <Stat title="New episodes (24h)" value={counts.newEpisodes24h} />
          <Stat title="New podcasts auto-added (24h)" value={counts.newPodcasts24h} />
          <Stat title="Failed feeds" value={counts.failedFeeds} />
          <Stat title="Approval queue" value={counts.queue} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Last growth run</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>Started: {fmtDate(lastRun?.started_at)}</div>
              <div>Finished: {fmtDate(lastRun?.finished_at)}</div>
              <div>Status: {lastRun?.ok ? "Success" : (lastRun ? "Failed" : "—")}</div>
              <div>Trigger: {lastRun?.trigger || "—"}</div>
              <div>Next expected: {nextRunUtc().toUTCString()}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Current limits</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>Min rank for auto-add: {settings?.min_rank_for_auto_add ?? "—"}</div>
              <div>Max auto-add per run: {settings?.max_auto_add_per_run ?? "—"}</div>
              <div>Max discovery per run: {settings?.max_discovery_per_run ?? "—"}</div>
              <div>Max episode age (days): {settings?.max_episode_age_days ?? "—"}</div>
              <div>Language filter: {settings?.language ?? "—"}</div>
            </CardContent>
          </Card>
        </div>
        {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      </div>
    </Layout>
  );
}

function Stat({ title, value }: { title: string; value: number | string }) {
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-medium">{title}</CardTitle></CardHeader>
      <CardContent><div className="text-2xl font-semibold">{value}</div></CardContent>
    </Card>
  );
}
