import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNoindex } from "@/lib/useNoindex";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCover } from "@/components/PodcastCover";
import { toast } from "sonner";
import { slugify } from "@/lib/slug";
import { FormulaCRunnerPanel } from "@/components/admin/FormulaCRunnerPanel";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type FilterKey = "all" | "active" | "failed" | "failed_404" | "not_checked" | "no_image" | "no_episodes" | "inactive" | "rank_high" | "rank_mid" | "rank_low";
type SortKey = "created" | "rank";

const is404 = (err?: string | null) => !!err && /\b404\b|not\s*found/i.test(err);

type Health = "healthy" | "weak" | "broken" | "unknown" | "hidden";
const healthOf = (p: any, epCount: number): Health => {
  if (p.rss_status === "inactive") return "hidden";
  if (p.rss_status === "failed") return "broken";
  if (p.rss_status === "active") return epCount > 0 ? "healthy" : "weak";
  return "unknown";
};
const healthBadge: Record<Health, string> = {
  healthy: "bg-green-500/15 text-green-700 dark:text-green-400",
  weak: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  broken: "bg-destructive/15 text-destructive",
  unknown: "bg-muted text-muted-foreground",
  hidden: "bg-muted text-muted-foreground",
};

export default function AdminPage() {
  useNoindex("Admin — Podiverzum");
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminFallbackActive, setAdminFallbackActive] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [cats, setCats] = useState<any[]>([]);
  const [podcasts, setPodcasts] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [bulk, setBulk] = useState<{ running: boolean; total: number; processed: number; success: number; failed: number; new: number; duplicates: number } | null>(null);
  const [aiCtrl, setAiCtrl] = useState({ enabled: true, max_per_day: 100, max_per_podcast_per_click: 15 });
  const [aiLastRun, setAiLastRun] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("all");
  const [sortKey, setSortKey] = useState<SortKey>("created");
  
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<any>({});
  const [episodeCounts, setEpisodeCounts] = useState<Record<string, number>>({});
  const nav = useNavigate();

  // form
  const [form, setForm] = useState({
    title: "", description: "", rss_url: "", apple_url: "", spotify_url: "",
    youtube_url: "", website_url: "", image_url: "", category: "",
    featured: false, featured_rank: "" as string | number,
  });

  const refresh = async () => {
    const { data } = await supabase.from("podcasts").select("*").order("created_at", { ascending: false });
    setPodcasts(data || []);
    await loadEpisodeCounts(data || []);
    await loadStats(data || []);
  };

  const loadEpisodeCounts = async (pods: any[]) => {
    if (!pods.length) { setEpisodeCounts({}); return; }
    const { data } = await supabase.from("episodes").select("podcast_id");
    const counts: Record<string, number> = {};
    (data || []).forEach((e: any) => { counts[e.podcast_id] = (counts[e.podcast_id] || 0) + 1; });
    setEpisodeCounts(counts);
  };

  const loadStats = async (pods: any[]) => {
    const totalPodcasts = pods.length;
    const active = pods.filter((p) => p.rss_status === "active").length;
    const failed = pods.filter((p) => p.rss_status === "failed").length;
    const notChecked = pods.filter((p) => !p.rss_status || p.rss_status === "not_checked").length;
    const lastFetched = pods
      .map((p) => p.last_fetched_at).filter(Boolean)
      .sort().slice(-1)[0] || null;
    const duplicatesSkipped = pods.reduce((sum, p) => sum + (p.last_fetch_duplicate_count || 0), 0);
    const errors = pods.filter((p) => p.last_fetch_error).map((p) => ({
      id: p.id, title: p.title, error: p.last_fetch_error,
    }));
    const { count: epCount } = await supabase
      .from("episodes").select("*", { count: "exact", head: true });
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const { count: summariesToday } = await supabase
      .from("episodes").select("*", { count: "exact", head: true })
      .not("summary", "is", null)
      .gte("updated_at", todayStart.toISOString());
    const aiCostToday = ((summariesToday || 0) * 0.0003);

    // Formula C v3 audit
    const tierCounts: Record<string, number> = {};
    const legacyByLabel: Record<string, number> = {};
    let lastRankUpdated: string | null = null;
    let lastShadowComputed: string | null = null;
    let legacyLabelLeaks = 0;
    let missingShadow = 0;
    let missingPodiverzumRank = 0;
    let staleRankUpdated14d = 0;
    let legacyMissingShadow = 0;
    const cutoff14 = Date.now() - 14 * 86400_000;
    const VALID = new Set(["S", "A", "B", "C", "D", "E"]);
    for (const p of pods) {
      const lbl = p.rank_label || "(unranked)";
      tierCounts[lbl] = (tierCounts[lbl] || 0) + 1;
      const isLegacy = !!p.rank_label && !VALID.has(p.rank_label);
      if (isLegacy) {
        legacyLabelLeaks++;
        legacyByLabel[p.rank_label] = (legacyByLabel[p.rank_label] || 0) + 1;
        if (p.shadow_rank == null) legacyMissingShadow++;
      }
      if (p.shadow_rank == null) missingShadow++;
      if (p.podiverzum_rank == null) missingPodiverzumRank++;
      if (p.rank_updated_at) {
        if (!lastRankUpdated || p.rank_updated_at > lastRankUpdated) lastRankUpdated = p.rank_updated_at;
        if (new Date(p.rank_updated_at).getTime() < cutoff14) staleRankUpdated14d++;
      }
      if (p.shadow_computed_at && (!lastShadowComputed || p.shadow_computed_at > lastShadowComputed)) {
        lastShadowComputed = p.shadow_computed_at;
      }
    }

    const auditAt = new Date().toISOString();
    const audit = {
      tierCounts, legacyByLabel, legacyLabelLeaks, legacyMissingShadow,
      missingShadow, missingPodiverzumRank, staleRankUpdated14d,
      lastRankUpdated, lastShadowComputed, auditAt,
    };
    // Persist audit log to console for ops visibility.
    console.info("[formula-c-audit]", JSON.stringify(audit));

    setStats({
      totalPodcasts, totalEpisodes: epCount || 0, active, failed, notChecked,
      lastFetched, summariesToday: summariesToday || 0, aiCostToday,
      duplicatesSkipped, errors,
      formulaC: { ...audit, tierCounts, lastRankUpdated, legacyLabelLeaks },
    });
  };

  const exportLegacyLabelCsv = () => {
    const VALID = new Set(["S", "A", "B", "C", "D", "E"]);
    const rows = podcasts.filter((p) => p.rank_label && !VALID.has(p.rank_label));
    const cols = ["id","title","rank_label","podiverzum_rank","shadow_rank","rank_updated_at","shadow_computed_at","rss_status","health_state","full_backfill_completed_at","created_at"];
    const esc = (v: any) => {
      if (v == null) return "";
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    };
    const lines = [cols.join(",")];
    for (const p of rows) {
      lines.push(cols.map((c) => esc(c === "health_state" ? p.shadow_rank_components?.health_state : (p as any)[c])).join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `legacy-rank-label-leaks-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} rows`);
  };


  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user.id || null);
    });
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      setUserId(uid);
      const { data: hasAdminRole, error: roleCheckError } = await (supabase as any).rpc("has_role", {
        _user_id: uid,
        _role: "admin",
      });
      if (roleCheckError) console.error("Admin role check failed", roleCheckError);
      const fallbackAdmin = uid === TEMP_ADMIN_USER_ID;
      const admin = hasAdminRole === true || fallbackAdmin;
      setAdminFallbackActive(hasAdminRole !== true && fallbackAdmin);
      setIsAdmin(admin);
      const { data: c } = await supabase.from("categories").select("*").order("sort_order");
      setCats(c || []);
      if (admin) {
        await refresh();
        await loadAiSettings();
      }
      setReady(true);
    })();
    return () => sub.subscription.unsubscribe();
  }, [nav]);

  const signOut = async () => { await supabase.auth.signOut(); nav("/"); };

  const loadAiSettings = async () => {
    const { data } = await supabase.from("app_settings").select("key,value,updated_at").in("key", ["ai_controls", "ai_last_run"]);
    const ctrl = data?.find((r: any) => r.key === "ai_controls")?.value as any;
    const last = data?.find((r: any) => r.key === "ai_last_run") as any;
    if (ctrl) setAiCtrl({
      enabled: ctrl.enabled !== false,
      max_per_day: ctrl.max_per_day ?? 100,
      max_per_podcast_per_click: ctrl.max_per_podcast_per_click ?? 15,
    });
    if (last) setAiLastRun((last.value?.at as string) || last.updated_at);
  };

  const saveAiSettings = async () => {
    const { error } = await supabase.from("app_settings").upsert({
      key: "ai_controls",
      value: {
        enabled: aiCtrl.enabled,
        max_per_day: Number(aiCtrl.max_per_day) || 0,
        max_per_podcast_per_click: Number(aiCtrl.max_per_podcast_per_click) || 0,
      },
      updated_at: new Date().toISOString(),
    });
    if (error) toast.error(error.message); else toast.success("AI settings saved");
  };

  const refreshAll = async (mode: "all" | "failed" | "not_checked" = "all") => {
    setBulk({ running: true, total: 0, processed: 0, success: 0, failed: 0, new: 0, duplicates: 0 });
    const { data, error } = await supabase.functions.invoke("refresh-all-rss", { body: { mode, limit: 40 } });
    if (error) {
      toast.error(`Bulk refresh failed: ${error.message}`);
      setBulk(null);
      return;
    }
    setBulk({
      running: false,
      total: data?.total || 0,
      processed: data?.processed || 0,
      success: data?.success || 0,
      failed: data?.failed || 0,
      new: data?.new_episodes || 0,
      duplicates: data?.duplicates_skipped || 0,
      remaining: data?.remaining || 0,
      mode,
    } as any);
    const rem = data?.remaining ? ` · ${data.remaining} remaining` : "";
    toast.success(`Refreshed ${data?.success}/${data?.total} (${mode})${rem}`);
    await refresh();
  };

  const markInactive = async (id: string) => {
    await supabase.from("podcasts").update({ rss_status: "inactive", last_fetch_error: null }).eq("id", id);
    toast.success("Marked inactive");
    await refresh();
  };

  const bulkMark404Inactive = async () => {
    const targets = podcasts.filter((p) => p.rss_status === "failed" && is404(p.last_fetch_error));
    if (!targets.length) return toast.info("No 404 feeds found");
    if (!confirm(`Mark ${targets.length} feed(s) returning 404 as inactive?`)) return;
    const { error } = await supabase
      .from("podcasts")
      .update({ rss_status: "inactive" })
      .in("id", targets.map((p) => p.id));
    if (error) return toast.error(error.message);
    toast.success(`Marked ${targets.length} inactive`);
    await refresh();
  };

  const bulkHideFailed = async () => {
    const targets = podcasts.filter((p) => p.rss_status === "failed" && !p.featured);
    if (!targets.length) return toast.info("No failed non-featured feeds");
    if (!confirm(`Hide ${targets.length} failed feed(s) from the public site (set inactive)?`)) return;
    const { error } = await supabase
      .from("podcasts")
      .update({ rss_status: "inactive" })
      .in("id", targets.map((p) => p.id));
    if (error) return toast.error(error.message);
    toast.success(`Hid ${targets.length} feeds`);
    await refresh();
  };

  const bulkDeleteFailedEmpty = async () => {
    const targets = podcasts.filter((p) => p.rss_status === "failed" && !(episodeCounts[p.id] > 0));
    if (!targets.length) return toast.info("No failed feeds with zero episodes");
    if (!confirm(`Permanently DELETE ${targets.length} failed feed(s) with no episodes? This cannot be undone.`)) return;
    if (!confirm(`Confirm again: delete ${targets.length} podcasts?`)) return;
    const { error } = await supabase.from("podcasts").delete().in("id", targets.map((p) => p.id));
    if (error) return toast.error(error.message);
    toast.success(`Deleted ${targets.length} feeds`);
    await refresh();
  };

  const findReplacement = (p: any) => {
    nav(`/admin/discovery?title=${encodeURIComponent(p.title)}&podcast_id=${p.id}`);
  };

  const startEdit = (p: any) => {
    setEditingId(p.id);
    setEditForm({
      title: p.title || "", rss_url: p.rss_url || "", image_url: p.image_url || "",
      category: p.category || "", website_url: p.website_url || "",
      apple_url: p.apple_url || "", spotify_url: p.spotify_url || "", youtube_url: p.youtube_url || "",
    });
  };
  const saveEdit = async (id: string) => {
    const payload: any = { ...editForm };
    Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
    const { error } = await supabase.from("podcasts").update(payload).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setEditingId(null);
    await refresh();
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    const slug = slugify(form.title);
    const payload: any = {
      ...form,
      slug,
      featured_rank: form.featured_rank ? Number(form.featured_rank) : null,
    };
    Object.keys(payload).forEach((k) => { if (payload[k] === "") payload[k] = null; });
    const { error } = await supabase.from("podcasts").insert(payload);
    if (error) {
      const dup = error.code === "23505" || /duplicate|unique/i.test(error.message);
      return toast.error(dup ? "This RSS feed already exists." : error.message);
    }
    toast.success("Podcast added");
    setForm({ title: "", description: "", rss_url: "", apple_url: "", spotify_url: "", youtube_url: "", website_url: "", image_url: "", category: "", featured: false, featured_rank: "" });
    await refresh();
  };

  const fetchRss = async (id: string) => {
    setBusyId(id);
    const { data, error } = await supabase.functions.invoke("fetch-rss", { body: { podcast_id: id, limit: 25 } });
    setBusyId(null);
    if (error) {
      toast.error(`RSS failed: ${error.message}`);
    } else if (data?.error) {
      toast.error(`RSS failed: ${data.error}`);
    } else {
      toast.success(`Imported ${data?.count ?? 0} of ${data?.items ?? 0} episodes`);
    }
    await refresh();
  };

  const aiPodcast = async (id: string) => {
    setBusyId(id);
    const { error } = await supabase.functions.invoke("ai-enrich", { body: { type: "podcast", id } });
    setBusyId(null);
    if (error) return toast.error(error.message);
    toast.success("Summary generated");
    await refresh();
  };

  const aiAllEpisodes = async (id: string) => {
    setBusyId(id);
    const limit = Math.max(1, Number(aiCtrl.max_per_podcast_per_click) || 15);
    const { data: eps } = await supabase.from("episodes").select("id").eq("podcast_id", id).is("summary", null).limit(limit);
    let ok = 0, blocked = false;
    for (const e of eps || []) {
      const { data, error } = await supabase.functions.invoke("ai-enrich", { body: { type: "episode", id: e.id } });
      if (error || (data as any)?.error) {
        const msg = (data as any)?.error || error?.message || "";
        if (/disabled|cap reached/i.test(msg)) { toast.error(msg); blocked = true; break; }
      } else ok++;
    }
    setBusyId(null);
    if (!blocked) toast.success(`Enriched ${ok} episodes`);
    await refresh(); await loadAiSettings();
  };

  const toggleFeatured = async (p: any) => {
    await supabase.from("podcasts").update({ featured: !p.featured }).eq("id", p.id);
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete podcast and its episodes?")) return;
    await supabase.from("podcasts").delete().eq("id", id);
    refresh();
  };


  const setManualBoost = async (id: string, boost: number) => {
    const clamped = Math.max(-3, Math.min(3, boost));
    const { error } = await supabase.from("podcasts").update({ manual_rank_boost: clamped }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Manual boost saved. Will apply on next Formula C v3 ranking pass.");
    await refresh();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = podcasts.filter((p) => {
      const r = p.podiverzum_rank ?? 1;
      if (filter === "active" && p.rss_status !== "active") return false;
      if (filter === "failed" && p.rss_status !== "failed") return false;
      if (filter === "failed_404" && !(p.rss_status === "failed" && is404(p.last_fetch_error))) return false;
      if (filter === "not_checked" && p.rss_status !== "not_checked") return false;
      if (filter === "inactive" && p.rss_status !== "inactive") return false;
      if (filter === "no_image" && p.image_url) return false;
      if (filter === "no_episodes" && (episodeCounts[p.id] || 0) > 0) return false;
      if (filter === "rank_high" && r < 8) return false;
      if (filter === "rank_mid" && (r < 4 || r > 7)) return false;
      if (filter === "rank_low" && r > 3) return false;
      if (q && !(`${p.title} ${p.category || ""} ${p.rss_url || ""}`.toLowerCase().includes(q))) return false;
      return true;
    });
    if (sortKey === "rank") {
      list.sort((a, b) => (b.podiverzum_rank ?? 1) - (a.podiverzum_rank ?? 1));
    }
    return list;
  }, [podcasts, filter, search, episodeCounts, sortKey]);

  const counts = useMemo(() => ({
    all: podcasts.length,
    active: podcasts.filter((p) => p.rss_status === "active").length,
    failed: podcasts.filter((p) => p.rss_status === "failed").length,
    failed_404: podcasts.filter((p) => p.rss_status === "failed" && is404(p.last_fetch_error)).length,
    not_checked: podcasts.filter((p) => p.rss_status === "not_checked").length,
    inactive: podcasts.filter((p) => p.rss_status === "inactive").length,
    no_image: podcasts.filter((p) => !p.image_url).length,
    no_episodes: podcasts.filter((p) => !(episodeCounts[p.id] > 0)).length,
    rank_high: podcasts.filter((p) => ["S", "A"].includes(p.rank_label as string)).length,
    rank_mid: podcasts.filter((p) => ["B", "C"].includes(p.rank_label as string)).length,
    rank_low: podcasts.filter((p) => ["D", "E"].includes(p.rank_label as string)).length,
  }), [podcasts, episodeCounts]);

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return (
    <Layout>
      <div className="container mx-auto py-20 max-w-md">
        <h1 className="text-2xl font-semibold">Not authorized</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          You're signed in as <code>{userId}</code> but don't have the admin role.
          Run this SQL in your backend (replace with your user id):
        </p>
        <pre className="mt-4 p-3 rounded-md bg-secondary text-xs overflow-x-auto">
INSERT INTO public.user_roles (user_id, role)
VALUES ('{userId}', 'admin');
        </pre>
        <button onClick={signOut} className="mt-4 text-sm text-accent">Sign out</button>
      </div>
    </Layout>
  );

  return (
    <Layout>
      <div className="container mx-auto py-10 space-y-10">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h1 className="text-3xl font-semibold">Admin</h1>
          <div className="flex gap-3 text-sm flex-wrap items-center">
            <a href="/admin/growth" className="text-muted-foreground hover:text-foreground">Growth</a>
            <a href="/admin/queue" className="text-muted-foreground hover:text-foreground">Queue</a>
            <a href="/admin/discovery" className="text-muted-foreground hover:text-foreground">Discovery</a>
            <a href="/admin/feedback" className="text-muted-foreground hover:text-foreground">Feedback</a>
            <a href="/admin/search-insights" className="text-muted-foreground hover:text-foreground">Search insights</a>
            <a href="/admin/analytics" className="text-muted-foreground hover:text-foreground">Analytics</a>
            <a href="/admin/live" className="text-emerald-500 hover:text-emerald-400">● Élő</a>
            <button onClick={signOut} className="text-muted-foreground hover:text-accent">Sign out</button>
          </div>
        </div>

        {adminFallbackActive && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            Temporary admin fallback active.
          </div>
        )}

        <section className="p-4 rounded-lg border border-border bg-card">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="font-semibold">Bulk RSS refresh</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                Fetches every podcast with RSS that's <code>active</code> or <code>not_checked</code>. Skips podcasts without an <code>rss_url</code>. Failures are isolated.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => refreshAll("all")} disabled={bulk?.running} className="px-3 py-2 rounded-md bg-primary text-primary-foreground text-sm disabled:opacity-50">
                {bulk?.running ? "Refreshing…" : "Fetch all"}
              </button>
              <button onClick={() => refreshAll("failed")} disabled={bulk?.running} className="px-3 py-2 rounded-md bg-secondary text-sm disabled:opacity-50">Retry failed</button>
              <button onClick={() => refreshAll("not_checked")} disabled={bulk?.running} className="px-3 py-2 rounded-md bg-secondary text-sm disabled:opacity-50">Fetch not checked</button>
              {!!(bulk as any)?.remaining && (
                <button onClick={() => refreshAll(((bulk as any).mode || "all"))} disabled={bulk?.running} className="px-3 py-2 rounded-md bg-accent text-accent-foreground text-sm disabled:opacity-50">
                  Run another batch ({(bulk as any).remaining} left)
                </button>
              )}
            </div>
          </div>
          {bulk && (
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mt-4 text-xs">
              <div className="p-2 rounded border border-border"><div className="text-muted-foreground">Total</div><div className="text-base font-semibold">{bulk.total}</div></div>
              <div className="p-2 rounded border border-border"><div className="text-muted-foreground">Processed</div><div className="text-base font-semibold">{bulk.processed}</div></div>
              <div className="p-2 rounded border border-border"><div className="text-muted-foreground">Successful</div><div className="text-base font-semibold">{bulk.success}</div></div>
              <div className="p-2 rounded border border-border"><div className="text-muted-foreground">Failed</div><div className={`text-base font-semibold ${bulk.failed ? "text-destructive" : ""}`}>{bulk.failed}</div></div>
              <div className="p-2 rounded border border-border"><div className="text-muted-foreground">New episodes</div><div className="text-base font-semibold">{bulk.new}</div></div>
              <div className="p-2 rounded border border-border"><div className="text-muted-foreground">Duplicates</div><div className="text-base font-semibold">{bulk.duplicates}</div></div>
            </div>
          )}
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">How to schedule this once a day</summary>
            <div className="mt-2 space-y-2">
              <p>Two options — pick one:</p>
              <p><strong>A. External cron (easiest):</strong> Use cron-job.org / GitHub Actions / Vercel Cron to <code>POST</code> daily to:</p>
              <pre className="p-2 rounded bg-secondary overflow-x-auto">{`POST ${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refresh-all-rss
Header: apikey: <publishable key>`}</pre>
              <p><strong>B. Postgres pg_cron + pg_net</strong> inside Lovable Cloud:</p>
              <pre className="p-2 rounded bg-secondary overflow-x-auto">{`select cron.schedule(
  'podiverzum-refresh-rss-daily',
  '0 4 * * *',
  $$ select net.http_post(
    url:='${import.meta.env.VITE_SUPABASE_URL}/functions/v1/refresh-all-rss',
    headers:='{"Content-Type":"application/json"}'::jsonb,
    body:='{}'::jsonb
  ); $$
);`}</pre>
            </div>
          </details>
        </section>

        <section className="p-4 rounded-lg border border-border bg-card">
          <h2 className="font-semibold">AI cost controls</h2>
          <div className="grid sm:grid-cols-3 gap-3 mt-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={aiCtrl.enabled} onChange={(e) => setAiCtrl({ ...aiCtrl, enabled: e.target.checked })} />
              AI enrichment enabled
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground">Max enrichments / day</span>
              <input type="number" value={aiCtrl.max_per_day} onChange={(e) => setAiCtrl({ ...aiCtrl, max_per_day: Number(e.target.value) })} className="mt-1 px-2 py-1 w-full rounded-md border border-border bg-background" />
            </label>
            <label className="text-sm">
              <span className="block text-xs text-muted-foreground">Max episodes per podcast per click</span>
              <input type="number" value={aiCtrl.max_per_podcast_per_click} onChange={(e) => setAiCtrl({ ...aiCtrl, max_per_podcast_per_click: Number(e.target.value) })} className="mt-1 px-2 py-1 w-full rounded-md border border-border bg-background" />
            </label>
          </div>
          <div className="flex items-center justify-between gap-3 mt-3">
            <div className="text-xs text-muted-foreground">
              Last AI run: {aiLastRun ? new Date(aiLastRun).toLocaleString() : "never"}
            </div>
            <button onClick={saveAiSettings} className="px-3 py-1.5 rounded-md bg-secondary text-sm">Save settings</button>
          </div>
        </section>

        <FormulaCRunnerPanel />

        {stats?.formulaC && (
          <section className="p-4 rounded-lg border border-border bg-card">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div>
                <h2 className="font-semibold">Formula C v3 — ranking status</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Live ranking is powered by Formula C v3 (<code>stage4-persist</code> + shadow ranking pipeline).
                  Legacy <code>recompute-ranks</code> is deprecated and unreachable from the UI.
                </p>
              </div>
              <div className="text-xs text-muted-foreground">
                Last <code>rank_updated_at</code>:{" "}
                <span className="font-medium text-foreground">
                  {stats.formulaC.lastRankUpdated ? new Date(stats.formulaC.lastRankUpdated).toLocaleString() : "never"}
                </span>
              </div>
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-7 gap-2 mt-3">
              {(["S","A","B","C","D","E","(unranked)"] as const).map((t) => {
                const n = stats.formulaC.tierCounts[t] || 0;
                const cls = t === "S" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/30"
                  : t === "A" ? "bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30"
                  : t === "B" ? "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30"
                  : t === "C" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30"
                  : "bg-muted text-muted-foreground border-border";
                return (
                  <div key={t} className={`p-2 rounded border ${cls}`}>
                    <div className="text-[10px] uppercase tracking-wide opacity-80">Tier {t}</div>
                    <div className="text-lg font-semibold">{n}</div>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 text-xs">
              <div className="p-2 rounded border border-border"><div className="text-muted-foreground">Missing shadow_rank</div><div className="text-base font-semibold">{stats.formulaC.missingShadow}</div></div>
              <div className="p-2 rounded border border-border"><div className="text-muted-foreground">Missing podiverzum_rank</div><div className={`text-base font-semibold ${stats.formulaC.missingPodiverzumRank ? "text-destructive" : ""}`}>{stats.formulaC.missingPodiverzumRank}</div></div>
              <div className="p-2 rounded border border-border"><div className="text-muted-foreground">rank_updated_at &gt; 14d old</div><div className="text-base font-semibold">{stats.formulaC.staleRankUpdated14d}</div></div>
              <div className="p-2 rounded border border-border"><div className="text-muted-foreground">Last shadow_computed_at</div><div className="text-base font-semibold">{stats.formulaC.lastShadowComputed ? new Date(stats.formulaC.lastShadowComputed).toLocaleDateString() : "—"}</div></div>
            </div>
            {stats.formulaC.legacyLabelLeaks > 0 && (
              <div className="mt-3 p-3 rounded border border-amber-500/40 bg-amber-500/10 text-xs text-amber-800 dark:text-amber-300 space-y-2">
                <div>
                  ⚠ <strong>{stats.formulaC.legacyLabelLeaks}</strong> podcast(s) carry legacy
                  rank_label values (
                  {Object.entries(stats.formulaC.legacyByLabel).map(([k, v]) => `${k}:${v}`).join(", ")}
                  ). Of these, <strong>{stats.formulaC.legacyMissingShadow}</strong> have no
                  <code> shadow_rank</code> — Formula C v3 has not yet processed them.
                </div>
                <div>
                  Source: ingestion functions <code>pi-dump-process</code>,
                  <code> queue-import</code>, <code>queue-import-runner</code>,
                  <code> queue-drainer</code> hardcode legacy "Excellent"/"Strong"/"Indexed"
                  labels at INSERT time. They are overwritten by Formula C v3
                  <code> stage4-persist</code> on its next pass. <strong>Not stale leaks
                  from <code>recompute-ranks</code></strong> — newly imported podcasts awaiting
                  shadow ranking. Do not delete; will normalize via Phase 4 migration.
                </div>
                <button
                  onClick={exportLegacyLabelCsv}
                  className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-xs"
                >
                  Export legacy-label CSV ({stats.formulaC.legacyLabelLeaks})
                </button>
              </div>
            )}
            <details className="mt-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Enqueue ordering contract (read-only)</summary>
              <ul className="mt-2 ml-4 list-disc space-y-1">
                <li>Podcast selection: <code>rank_label</code> ∈ {"{S,A,B,C}"}, healthy, ordered by <code>podiverzum_rank DESC</code>.</li>
                <li>Job priority by tier: S=100, A=80, B=60, C=40 (D/E excluded).</li>
                <li>Episode ordering inside a podcast: <code>published_at DESC</code>.</li>
                <li>Legacy <code>episode_rank</code> / <code>episode_rank_label</code> are intentionally ignored.</li>
              </ul>
            </details>
            <div className="mt-2 text-[10px] text-muted-foreground">
              Audit at: {new Date(stats.formulaC.auditAt).toLocaleString()}
            </div>
          </section>
        )}

        {stats && (
          <section>
            <h2 className="font-semibold mb-3">Production overview</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: "Total podcasts", value: stats.totalPodcasts },
                { label: "Total episodes", value: stats.totalEpisodes },
                { label: "Active RSS feeds", value: stats.active },
                { label: "Failed RSS feeds", value: stats.failed, danger: stats.failed > 0 },
                { label: "Not checked", value: stats.notChecked },
                { label: "Summaries today", value: stats.summariesToday },
                { label: "Est. AI cost today", value: `$${stats.aiCostToday.toFixed(4)}` },
                { label: "Duplicates skipped", value: stats.duplicatesSkipped },
              ].map((s: any) => (
                <div key={s.label} className="p-3 rounded-lg border border-border bg-card">
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                  <div className={`text-2xl font-semibold mt-1 ${s.danger ? "text-destructive" : ""}`}>{s.value}</div>
                </div>
              ))}
            </div>
            <div className="text-xs text-muted-foreground mt-2">
              Last RSS refresh: {stats.lastFetched ? new Date(stats.lastFetched).toLocaleString() : "never"}
            </div>
            {stats.errors.length > 0 && (
              <div className="mt-4 p-3 rounded-lg border border-destructive/30 bg-destructive/5">
                <div className="text-sm font-medium mb-2">Feeds with errors ({stats.errors.length})</div>
                <ul className="text-xs space-y-1 max-h-40 overflow-y-auto">
                  {stats.errors.map((e: any) => (
                    <li key={e.id} className="truncate"><span className="font-medium">{e.title}:</span> <span className="text-destructive">{e.error}</span></li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <section>
          <h2 className="font-semibold mb-3">Add podcast</h2>
          <form onSubmit={create} className="grid sm:grid-cols-2 gap-3 p-4 rounded-lg border border-border bg-card">
            <input required placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="px-3 py-2 rounded-md border border-border bg-background" />
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className="px-3 py-2 rounded-md border border-border bg-background">
              <option value="">Category…</option>
              {cats.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
            <input placeholder="RSS feed URL" value={form.rss_url} onChange={(e) => setForm({ ...form, rss_url: e.target.value })} className="sm:col-span-2 px-3 py-2 rounded-md border border-border bg-background" />
            <input placeholder="Image URL" value={form.image_url} onChange={(e) => setForm({ ...form, image_url: e.target.value })} className="sm:col-span-2 px-3 py-2 rounded-md border border-border bg-background" />
            <input placeholder="Apple URL" value={form.apple_url} onChange={(e) => setForm({ ...form, apple_url: e.target.value })} className="px-3 py-2 rounded-md border border-border bg-background" />
            <input placeholder="Spotify URL" value={form.spotify_url} onChange={(e) => setForm({ ...form, spotify_url: e.target.value })} className="px-3 py-2 rounded-md border border-border bg-background" />
            <input placeholder="YouTube URL" value={form.youtube_url} onChange={(e) => setForm({ ...form, youtube_url: e.target.value })} className="px-3 py-2 rounded-md border border-border bg-background" />
            <input placeholder="Website URL" value={form.website_url} onChange={(e) => setForm({ ...form, website_url: e.target.value })} className="px-3 py-2 rounded-md border border-border bg-background" />
            <textarea placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="sm:col-span-2 px-3 py-2 rounded-md border border-border bg-background min-h-[80px]" />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.featured} onChange={(e) => setForm({ ...form, featured: e.target.checked })} />
              Featured / top
            </label>
            <input placeholder="Featured rank (1=top)" value={form.featured_rank} onChange={(e) => setForm({ ...form, featured_rank: e.target.value })} className="px-3 py-2 rounded-md border border-border bg-background" />
            <button className="sm:col-span-2 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium">Add podcast</button>
          </form>
        </section>

        <section>
          <div className="sticky top-0 z-10 -mx-4 px-4 sm:mx-0 sm:px-0 py-2 bg-background/95 backdrop-blur border-b border-border">
            <div className="flex flex-wrap gap-1.5 items-center">
              {([
                ["all", `All (${counts.all})`],
                ["active", `Active (${counts.active})`],
                ["failed", `Failed (${counts.failed})`],
                ["failed_404", `Failed 404 only (${counts.failed_404})`],
                ["not_checked", `Not checked (${counts.not_checked})`],
                ["inactive", `Inactive (${counts.inactive})`],
                ["no_image", `No image (${counts.no_image})`],
                ["no_episodes", `No episodes (${counts.no_episodes})`],
                ["rank_high", `Rank 8–10 (${counts.rank_high})`],
                ["rank_mid", `Rank 4–7 (${counts.rank_mid})`],
                ["rank_low", `Rank 1–3 (${counts.rank_low})`],
              ] as [FilterKey, string][]).map(([k, label]) => (
                <button
                  key={k}
                  onClick={() => setFilter(k)}
                  className={`px-2.5 py-1 rounded-full text-xs border ${filter === k ? "bg-primary text-primary-foreground border-primary" : "bg-card border-border text-muted-foreground"}`}
                >{label}</button>
              ))}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search…"
                className="ml-auto px-2 py-1 rounded-md border border-border bg-background text-xs w-32 sm:w-48"
              />
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2 items-center">
              <button onClick={bulkMark404Inactive} className="px-2.5 py-1 rounded-md bg-secondary text-xs">Mark all failed 404 inactive</button>
              <button onClick={bulkHideFailed} className="px-2.5 py-1 rounded-md bg-secondary text-xs">Hide failed feeds from public site</button>
              <button onClick={bulkDeleteFailedEmpty} className="px-2.5 py-1 rounded-md bg-destructive text-destructive-foreground text-xs">Delete failed feeds with no episodes</button>
              <select value={sortKey} onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="px-2 py-1 rounded-md border border-border bg-background text-xs">
                <option value="created">Sort: newest</option>
                <option value="rank">Sort: rank ↓</option>
              </select>
            </div>
          </div>

          <h2 className="font-semibold mt-4 mb-2 text-sm text-muted-foreground">Showing {filtered.length} of {podcasts.length}</h2>
          <div className="border border-border rounded-lg bg-card divide-y divide-border">
            {filtered.map((p) => {
              const epCount = episodeCounts[p.id] || 0;
              const statusBadge =
                p.rss_status === "active" ? "bg-green-500/15 text-green-700 dark:text-green-400" :
                p.rss_status === "failed" ? "bg-destructive/15 text-destructive" :
                p.rss_status === "inactive" ? "bg-muted text-muted-foreground" :
                "bg-amber-500/15 text-amber-700 dark:text-amber-400";
              const isEditing = editingId === p.id;
              return (
                <div key={p.id} className="p-2.5 sm:p-3">
                  <div className="flex items-start gap-2.5">
                    <div className="w-12 h-12 shrink-0">
                      <PodcastCover title={p.title} src={p.image_url} size="sm" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <div className="font-medium text-sm truncate max-w-full">{p.title}</div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${statusBadge}`}>{p.rss_status || "not_checked"}</span>
                        {(() => { const h = healthOf(p, epCount); return (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${healthBadge[h]}`}>{h}</span>
                        ); })()}
                        {p.rss_status === "failed" && is404(p.last_fetch_error) && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-destructive/15 text-destructive">404</span>
                        )}
                        {p.featured && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-accent-foreground">★</span>}
                        {(() => {
                          const r = Number(p.podiverzum_rank ?? 1);
                          const cls = r >= 8 ? "bg-green-500/15 text-green-700 dark:text-green-400"
                            : r >= 6 ? "bg-blue-500/15 text-blue-700 dark:text-blue-400"
                            : r >= 4 ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                            : "bg-red-500/15 text-red-700 dark:text-red-400";
                          return <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${cls}`} title={`Live Podiverzum rank · tier ${p.rank_label || "—"}`}>Rank {r.toFixed(2)}{p.rank_label ? ` · ${p.rank_label}` : ""}</span>;
                        })()}
                        {(() => {
                          const hs = (p.shadow_rank_components as any)?.health_state;
                          if (!hs) return null;
                          const ok = hs === "healthy" || hs === "recovered_rss_url";
                          return <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ok ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" : "bg-orange-500/15 text-orange-700 dark:text-orange-400"}`} title="health_state">{hs}</span>;
                        })()}
                        {p.crawl_priority && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary text-muted-foreground" title="crawl_priority">{p.crawl_priority}</span>
                        )}
                        <span className="text-[10px] text-muted-foreground">{epCount} ep</span>
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                        {p.category || "—"}
                        {p.refresh_interval_minutes ? <span className="ml-2 opacity-70">· refresh {p.refresh_interval_minutes}m</span> : null}
                      </div>
                      <div className={`text-[11px] mt-0.5 break-all ${p.rss_status === "failed" ? "text-destructive font-mono" : "text-muted-foreground"}`}>
                        {p.rss_url || <span className="italic">no rss</span>}
                      </div>
                      {p.last_fetch_error && (
                        <div className="text-[11px] text-destructive mt-0.5 break-words">⚠ {p.last_fetch_error}</div>
                      )}
                    </div>
                  </div>

                  {isEditing && (
                    <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {(["title","rss_url","image_url","category","website_url","apple_url","spotify_url","youtube_url"] as const).map((k) => (
                        <input
                          key={k}
                          placeholder={k}
                          value={editForm[k] ?? ""}
                          onChange={(e) => setEditForm({ ...editForm, [k]: e.target.value })}
                          className="px-2 py-1 rounded-md border border-border bg-background text-xs"
                        />
                      ))}
                      <div className="col-span-full flex gap-2">
                        <button onClick={() => saveEdit(p.id)} className="px-2.5 py-1 rounded bg-primary text-primary-foreground text-xs">Save</button>
                        <button onClick={() => setEditingId(null)} className="px-2.5 py-1 rounded bg-secondary text-xs">Cancel</button>
                      </div>
                    </div>
                  )}

                  <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] items-center">
                    <button disabled={busyId === p.id} onClick={() => fetchRss(p.id)} className="px-2 py-1 rounded bg-secondary disabled:opacity-50">Fetch</button>
                    <button onClick={() => isEditing ? setEditingId(null) : startEdit(p)} className="px-2 py-1 rounded bg-secondary">{isEditing ? "Close" : "Edit"}</button>
                    {p.rss_status === "failed" && (
                      <button onClick={() => markInactive(p.id)} className="px-2 py-1 rounded bg-secondary">Mark inactive</button>
                    )}
                    {p.rss_status === "failed" && (
                      <button onClick={() => findReplacement(p)} className="px-2 py-1 rounded bg-secondary">Find replacement RSS</button>
                    )}
                    <button disabled={busyId === p.id} onClick={() => aiPodcast(p.id)} className="px-2 py-1 rounded bg-secondary disabled:opacity-50">AI sum</button>
                    <button disabled={busyId === p.id} onClick={() => aiAllEpisodes(p.id)} className="px-2 py-1 rounded bg-secondary disabled:opacity-50">AI eps</button>
                    <button onClick={() => toggleFeatured(p)} className={`px-2 py-1 rounded ${p.featured ? "bg-accent text-accent-foreground" : "bg-secondary"}`}>{p.featured ? "★" : "Feature"}</button>
                    <label className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-secondary">
                      <span className="text-muted-foreground">Boost</span>
                      <input
                        type="number" min={-3} max={3} step={1}
                        defaultValue={p.manual_rank_boost ?? 0}
                        onBlur={(e) => {
                          const v = parseInt(e.target.value || "0", 10);
                          if (v !== (p.manual_rank_boost ?? 0)) setManualBoost(p.id, v);
                        }}
                        className="w-12 px-1 py-0.5 rounded bg-background border border-border text-center"
                      />
                    </label>
                    
                    <button onClick={() => remove(p.id)} className="px-2 py-1 rounded bg-destructive text-destructive-foreground ml-auto">Delete</button>
                  </div>
                  {p.rank_reason?.factors && (
                    <details className="mt-1 text-[11px] text-muted-foreground">
                      <summary className="cursor-pointer">Why live rank {Number(p.podiverzum_rank ?? 0).toFixed(2)}?</summary>
                      <ul className="mt-1 ml-4 list-disc space-y-0.5">
                        {(p.rank_reason.factors as any[]).map((f, i) => (
                          <li key={i}>{f.delta > 0 ? `+${f.delta}` : f.delta} — {f.note}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })}
            {!filtered.length && <div className="p-4 text-sm text-muted-foreground">No podcasts match this filter.</div>}
          </div>
        </section>
      </div>
    </Layout>
  );
}
