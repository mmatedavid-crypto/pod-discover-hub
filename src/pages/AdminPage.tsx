import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { toast } from "sonner";
import { slugify } from "@/lib/slug";

export default function AdminPage() {
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [cats, setCats] = useState<any[]>([]);
  const [podcasts, setPodcasts] = useState<any[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
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
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", uid);
      const admin = !!roles?.find((r: any) => r.role === "admin");
      setIsAdmin(admin);
      const { data: c } = await supabase.from("categories").select("*").order("sort_order");
      setCats(c || []);
      if (admin) await refresh();
      setReady(true);
    })();
    return () => sub.subscription.unsubscribe();
  }, [nav]);

  const signOut = async () => { await supabase.auth.signOut(); nav("/"); };

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
    if (error) return toast.error(error.message);
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
    const { data: eps } = await supabase.from("episodes").select("id").eq("podcast_id", id).is("summary", null).limit(15);
    let ok = 0;
    for (const e of eps || []) {
      const { error } = await supabase.functions.invoke("ai-enrich", { body: { type: "episode", id: e.id } });
      if (!error) ok++;
    }
    setBusyId(null);
    toast.success(`Enriched ${ok} episodes`);
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
