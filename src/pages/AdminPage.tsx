import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCover } from "@/components/PodcastCover";
import { toast } from "sonner";
import { slugify } from "@/lib/slug";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type FilterKey = "all" | "active" | "failed" | "not_checked" | "no_image" | "no_episodes";

export default function AdminPage() {
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
    // Rough estimate: ~$0.0003 per Gemini Flash episode summary call
    const aiCostToday = ((summariesToday || 0) * 0.0003);
    setStats({
      totalPodcasts, totalEpisodes: epCount || 0, active, failed, notChecked,
      lastFetched, summariesToday: summariesToday || 0, aiCostToday,
      duplicatesSkipped, errors,
    });
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
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-semibold">Admin</h1>
          <button onClick={signOut} className="text-sm text-muted-foreground hover:text-accent">Sign out</button>
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
              <pre className="p-2 rounded bg-secondary overflow-x-auto">{`POST https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/refresh-all-rss
Header: apikey: <publishable key>`}</pre>
              <p><strong>B. Postgres pg_cron + pg_net</strong> inside Lovable Cloud:</p>
              <pre className="p-2 rounded bg-secondary overflow-x-auto">{`select cron.schedule(
  'podiverzum-refresh-rss-daily',
  '0 4 * * *',
  $$ select net.http_post(
    url:='https://iqzkayoqqagowvxeaphe.supabase.co/functions/v1/refresh-all-rss',
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
          <h2 className="font-semibold mb-3">Podcasts ({podcasts.length})</h2>
          <div className="border border-border rounded-lg bg-card divide-y divide-border">
            {podcasts.map((p) => (
              <div key={p.id} className="p-3 flex flex-wrap items-center gap-3">
                <div className="w-10 h-10 rounded bg-muted overflow-hidden shrink-0">
                  {p.image_url && <img src={p.image_url} alt="" className="w-full h-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{p.title}</div>
                  <div className="text-xs text-muted-foreground truncate">{p.category} · {p.rss_url || "no rss"}</div>
                  <div className="text-xs mt-0.5">
                    <span className={
                      p.rss_status === "active" ? "text-green-700" :
                      p.rss_status === "failed" ? "text-destructive" :
                      "text-muted-foreground"
                    }>RSS: {p.rss_status || "not_checked"}</span>
                    {p.last_fetched_at && <span className="text-muted-foreground"> · last {new Date(p.last_fetched_at).toLocaleString()}</span>}
                    {p.last_fetch_error && <div className="text-destructive truncate">⚠ {p.last_fetch_error}</div>}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button disabled={busyId === p.id} onClick={() => fetchRss(p.id)} className="px-2 py-1 rounded bg-secondary disabled:opacity-50">Fetch RSS</button>
                  <button disabled={busyId === p.id} onClick={() => aiPodcast(p.id)} className="px-2 py-1 rounded bg-secondary disabled:opacity-50">AI summary</button>
                  <button disabled={busyId === p.id} onClick={() => aiAllEpisodes(p.id)} className="px-2 py-1 rounded bg-secondary disabled:opacity-50">AI enrich eps</button>
                  <button onClick={() => toggleFeatured(p)} className={`px-2 py-1 rounded ${p.featured ? "bg-accent text-accent-foreground" : "bg-secondary"}`}>{p.featured ? "Featured" : "Feature"}</button>
                  <button onClick={() => remove(p.id)} className="px-2 py-1 rounded bg-destructive text-destructive-foreground">Delete</button>
                </div>
              </div>
            ))}
            {!podcasts.length && <div className="p-4 text-sm text-muted-foreground">No podcasts yet.</div>}
          </div>
        </section>
      </div>
    </Layout>
  );
}
