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
  const now = new Date();
  const candidates = [4, 16].map((h) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 0, 0));
    if (d.getTime() <= now.getTime()) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  });
  candidates.sort((a, b) => a.getTime() - b.getTime());
  return candidates[0];
}

type Health = { label: string; variant: "default" | "secondary" | "destructive" | "outline"; detail: string };

function computeHealth(lastRun: any, lastSuccess: any): Health {
  if (!lastRun) return { label: "Setup", variant: "outline", detail: "No runs yet. Waiting for first scheduled run." };
  const now = Date.now();
  const startedMs = lastRun.started_at ? new Date(lastRun.started_at).getTime() : 0;
  const ageMinSinceStart = (now - startedMs) / 60000;
  if (!lastRun.finished_at && ageMinSinceStart < 10) {
    return { label: "Running", variant: "secondary", detail: "A growth run is currently in progress." };
  }
  if (!lastRun.finished_at && ageMinSinceStart >= 10) {
    return { label: "Timed out", variant: "destructive", detail: "Last run did not finish within 10 minutes." };
  }
  if (lastRun.ok === false) {
    return { label: "Error", variant: "destructive", detail: lastRun.error || "Last run failed." };
  }
  const lastOkMs = lastSuccess?.finished_at ? new Date(lastSuccess.finished_at).getTime() : 0;
  if (!lastOkMs) return { label: "Error", variant: "destructive", detail: "No successful run on record." };
  const ageH = (now - lastOkMs) / 3600000;
  if (ageH <= 18) return { label: "Healthy", variant: "default", detail: "Last successful run within 18 hours." };
  if (ageH <= 36) return { label: "Warning", variant: "secondary", detail: "Last successful run between 18 and 36 hours ago." };
  return { label: "Error", variant: "destructive", detail: "No successful run in more than 36 hours." };
}

export default function GrowthStatusPage() {
  const [loading, setLoading] = useState(true);
  const [lastRun, setLastRun] = useState<any>(null);
  const [lastSuccess, setLastSuccess] = useState<any>(null);
  const [settings, setSettings] = useState<any>(null);
  const [counts, setCounts] = useState({
    podcasts: 0, activePodcasts: 0, episodes: 0, newEpisodes24h: 0,
    newPodcasts24h: 0, avgRank: 0, failedFeeds: 0, queue: 0,
  });
  const [sources, setSources] = useState<Record<string, number>>({});

  useEffect(() => {
    (async () => {
      const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [
        runRes, okRunRes, settingsRes,
        podsRes, activeRes, episodesRes,
        newEpsRes, newPodsRes, avgRes, failedRes, queueRes,
      ] = await Promise.all([
        supabase.from("growth_runs").select("*").order("started_at", { ascending: false }).limit(1),
        supabase.from("growth_runs").select("*").eq("ok", true).not("finished_at", "is", null).order("finished_at", { ascending: false }).limit(1),
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
      setLastSuccess(okRunRes.data?.[0] || null);
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

      const { data: srcRows } = await supabase.from("podcasts").select("source");
      const tally: Record<string, number> = {};
      (srcRows || []).forEach((r: any) => {
        const k = r.source || "manual";
        tally[k] = (tally[k] || 0) + 1;
      });
      setSources(tally);
      setLoading(false);
    })();
  }, []);

  const health = computeHealth(lastRun, lastSuccess);
  const cronActive = !!lastSuccess && (Date.now() - new Date(lastSuccess.finished_at).getTime()) / 3600000 <= 18;

  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-6">
        <div>
          <h1 className="text-3xl font-semibold">Growth status</h1>
          <p className="text-muted-foreground">Read-only view of Podiverzum's autonomous growth.</p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Badge variant={health.variant} className="text-sm px-3 py-1">{health.label}</Badge>
          <span className="text-sm text-muted-foreground">{health.detail}</span>
        </div>

        <div className="flex items-center gap-2 flex-wrap text-sm">
          <Badge variant={settings?.auto_add_enabled ? "default" : "outline"}>
            Auto-add: {settings?.auto_add_enabled ? "ON" : "OFF"}
          </Badge>
          <Badge variant="outline">Min rank ≥ {settings?.min_rank_for_auto_add ?? "—"}</Badge>
          <Badge variant="outline">Max auto-add/run: {settings?.max_auto_add_per_run ?? "—"}</Badge>
          <Badge variant="outline">Cron: {cronActive ? "appears active" : "not confirmed"}</Badge>
        </div>

        {health.label === "Setup" && (
          <Alert>
            <AlertTitle>Waiting for first run</AlertTitle>
            <AlertDescription>
              No growth run has completed yet. The first scheduled run will execute at {nextRunUtc().toUTCString()}.
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
            <CardHeader><CardTitle className="text-base">Last attempted run</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>Started: {fmtDate(lastRun?.started_at)}</div>
              <div>Finished: {fmtDate(lastRun?.finished_at)}</div>
              <div>OK: {lastRun ? String(lastRun.ok) : "—"}</div>
              <div>Trigger: {lastRun?.trigger || "—"}</div>
              {lastRun?.error && <div className="text-destructive">Error: {lastRun.error}</div>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Last successful run</CardTitle></CardHeader>
            <CardContent className="text-sm space-y-1">
              <div>Started: {fmtDate(lastSuccess?.started_at)}</div>
              <div>Finished: {fmtDate(lastSuccess?.finished_at)}</div>
              <div>Trigger: {lastSuccess?.trigger || "—"}</div>
              <div>Next expected: {nextRunUtc().toUTCString()}</div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader><CardTitle className="text-base">Last run stats</CardTitle></CardHeader>
          <CardContent>
            {lastRun?.stats ? (
              <pre className="text-xs bg-muted p-3 rounded overflow-auto">{JSON.stringify(lastRun.stats, null, 2)}</pre>
            ) : <div className="text-sm text-muted-foreground">No stats available.</div>}
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

        <Card>
          <CardHeader><CardTitle className="text-base">Source breakdown</CardTitle></CardHeader>
          <CardContent className="text-sm">
            {Object.keys(sources).length === 0 ? (
              <div className="text-muted-foreground">No podcasts yet.</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {(["pi_recent", "admin_paste", "pi_dump", "discovery_auto", "manual"] as const).map((k) => (
                  <div key={k} className="flex justify-between border rounded px-3 py-2">
                    <span className="text-muted-foreground">{k === "discovery_auto" ? "Podcast Index API" : k}</span>
                    <span className="font-medium">{sources[k] || 0}</span>
                  </div>
                ))}
                {Object.keys(sources).filter((k) => !["pi_recent","admin_paste","pi_dump","discovery_auto","manual"].includes(k)).map((k) => (
                  <div key={k} className="flex justify-between border rounded px-3 py-2">
                    <span className="text-muted-foreground">{k}</span>
                    <span className="font-medium">{sources[k]}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

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
