import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useNoindex } from "@/lib/useNoindex";
import Layout from "@/components/Layout";
import { Loader2, Sparkles, RefreshCcw, Save, ExternalLink, Image as ImageIcon, Copy, Trash2 } from "lucide-react";
import { toast } from "sonner";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type Item = {
  episode_id: string;
  title: string;
  podcast_name: string;
  podcast_slug: string;
  episode_slug: string;
  url: string;
  teaser: string;
  quote: string;
  cover_card_url?: string | null;
  score?: number;
};

type EditorialPost = {
  id: string;
  week_start: string;
  week_end: string;
  status: string;
  title: string | null;
  intro: string | null;
  items: Item[];
  ig_caption: string | null;
  fb_caption: string | null;
  cover_image_url: string | null;
  card_image_urls: string[] | null;
  created_at: string;
};

export default function AdminEditorialPage() {
  useNoindex("Heti editorial — Podiverzum Admin");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [posts, setPosts] = useState<EditorialPost[]>([]);
  const [current, setCurrent] = useState<EditorialPost | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState("");

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" });
      const admin = hasAdmin === true || uid === TEMP_ADMIN_USER_ID;
      setIsAdmin(admin);
      setReady(true);
      if (admin) loadPosts();
    })();
  }, [nav]);

  const loadPosts = async () => {
    const { data } = await supabase
      .from("editorial_posts" as any)
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20);
    const list = (data || []) as unknown as EditorialPost[];
    setPosts(list);
    if (!current && list.length) setCurrent(list[0]);
  };

  const generateDraft = async () => {
    setBusy(true); setBusyMsg("AI editorial generálása… (~20-30s)");
    try {
      const { data, error } = await supabase.functions.invoke("weekly-editorial-post", {
        body: { trigger: "manual_admin" },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "ismeretlen hiba");
      toast.success("Draft elkészült");
      await loadPosts();
      if (data.post_id) {
        const { data: row } = await supabase.from("editorial_posts" as any).select("*").eq("id", data.post_id).maybeSingle();
        if (row) setCurrent(row as unknown as EditorialPost);
      }
    } catch (e: any) {
      toast.error(`Hiba: ${e.message}`);
    } finally { setBusy(false); setBusyMsg(""); }
  };

  const generateCards = async () => {
    if (!current) return;
    setBusy(true); setBusyMsg("Képek renderelése… (~15s)");
    try {
      const { data, error } = await supabase.functions.invoke("generate-editorial-cards", {
        body: { post_id: current.id },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "ismeretlen hiba");
      toast.success(`${data.count} kép kész`);
      const { data: row } = await supabase.from("editorial_posts" as any).select("*").eq("id", current.id).maybeSingle();
      if (row) setCurrent(row as unknown as EditorialPost);
    } catch (e: any) {
      toast.error(`Hiba: ${e.message}`);
    } finally { setBusy(false); setBusyMsg(""); }
  };

  const saveChanges = async () => {
    if (!current) return;
    setBusy(true); setBusyMsg("Mentés…");
    try {
      const { error } = await supabase
        .from("editorial_posts" as any)
        .update({
          title: current.title,
          intro: current.intro,
          items: current.items,
          ig_caption: current.ig_caption,
          fb_caption: current.fb_caption,
        })
        .eq("id", current.id);
      if (error) throw error;
      toast.success("Mentve");
      await loadPosts();
    } catch (e: any) {
      toast.error(`Hiba: ${e.message}`);
    } finally { setBusy(false); setBusyMsg(""); }
  };

  const setStatus = async (status: string) => {
    if (!current) return;
    const patch: any = { status };
    if (status === "published") patch.published_at = new Date().toISOString();
    if (status === "approved") patch.approved_at = new Date().toISOString();
    const { error } = await supabase.from("editorial_posts" as any).update(patch).eq("id", current.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Státusz: ${status}`);
    await loadPosts();
    setCurrent({ ...current, status });
  };

  const deletePost = async () => {
    if (!current || !confirm("Biztos törlöd?")) return;
    await supabase.from("editorial_posts" as any).delete().eq("id", current.id);
    setCurrent(null);
    await loadPosts();
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} másolva`);
  };

  const updateItem = (idx: number, patch: Partial<Item>) => {
    if (!current) return;
    const items = [...current.items];
    items[idx] = { ...items[idx], ...patch };
    setCurrent({ ...current, items });
  };

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Not authorized</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-6 max-w-5xl">
        <header className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold">Heti editorial</h1>
            <p className="text-sm text-muted-foreground mt-1">
              HVG-Fülszöveg stílusú heti podcastajánló IG/FB-re. AI generál, te jóváhagyod, képeket renderel, te postolod.
            </p>
          </div>
          <button
            onClick={generateDraft}
            disabled={busy}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-brand text-brand-foreground hover:bg-brand/90 text-sm disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Új draft
          </button>
        </header>

        {busy && busyMsg && (
          <div className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">{busyMsg}</div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
          {/* Sidebar list */}
          <aside className="space-y-2">
            <h2 className="text-xs uppercase tracking-wider text-muted-foreground px-2">Drafts ({posts.length})</h2>
            {posts.map((p) => (
              <button
                key={p.id}
                onClick={() => setCurrent(p)}
                className={`w-full text-left rounded-md border p-2 text-xs ${current?.id === p.id ? "border-brand bg-brand/5" : "border-border bg-card"}`}
              >
                <div className="font-medium truncate">{p.title || p.week_start}</div>
                <div className="text-muted-foreground flex items-center gap-1 mt-1">
                  <span className={`px-1.5 py-0.5 rounded ${
                    p.status === "published" ? "bg-green-500/15 text-green-600" :
                    p.status === "approved" ? "bg-blue-500/15 text-blue-600" :
                    "bg-secondary"
                  }`}>{p.status}</span>
                  <span>· {p.items?.length || 0} ep</span>
                </div>
              </button>
            ))}
            {posts.length === 0 && <div className="text-xs text-muted-foreground px-2">Még nincs draft.</div>}
          </aside>

          {/* Editor */}
          {current ? (
            <main className="space-y-4">
              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                <button onClick={saveChanges} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-secondary text-xs disabled:opacity-50">
                  <Save className="h-3.5 w-3.5" /> Mentés
                </button>
                <button onClick={generateCards} disabled={busy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border bg-secondary text-xs disabled:opacity-50">
                  <ImageIcon className="h-3.5 w-3.5" /> Képek generálása
                </button>
                <button onClick={() => setStatus("approved")} disabled={busy || current.status === "approved"} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs disabled:opacity-50">
                  Jóváhagyás
                </button>
                <button onClick={() => setStatus("published")} disabled={busy || current.status === "published"} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-green-500/30 bg-green-500/10 text-green-700 text-xs disabled:opacity-50">
                  Élesítve ✓ (postoltam)
                </button>
                <button onClick={deletePost} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-destructive/30 text-destructive text-xs ml-auto">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Title + intro */}
              <section className="rounded-lg border border-border bg-card p-4 space-y-3">
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Cím</label>
                  <input
                    value={current.title || ""}
                    onChange={(e) => setCurrent({ ...current, title: e.target.value })}
                    className="w-full mt-1 px-2 py-1.5 rounded border border-border bg-background text-sm font-semibold"
                  />
                </div>
                <div>
                  <label className="text-xs uppercase tracking-wider text-muted-foreground">Intro</label>
                  <textarea
                    value={current.intro || ""}
                    onChange={(e) => setCurrent({ ...current, intro: e.target.value })}
                    rows={3}
                    className="w-full mt-1 px-2 py-1.5 rounded border border-border bg-background text-sm"
                  />
                </div>
              </section>

              {/* Items */}
              <section className="space-y-3">
                <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Epizódok ({current.items?.length || 0})</h3>
                {(current.items || []).map((it, idx) => (
                  <div key={idx} className="rounded-lg border border-border bg-card p-3 space-y-2">
                    <div className="flex items-start gap-3">
                      {it.cover_card_url && (
                        <img src={it.cover_card_url} alt="" className="w-20 h-25 rounded object-cover border border-border flex-shrink-0" />
                      )}
                      <div className="flex-1 space-y-2 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold hover:underline truncate">
                            {it.title}
                          </a>
                          <a href={it.url} target="_blank" rel="noopener noreferrer" className="text-xs text-brand inline-flex items-center gap-1">
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                        <div className="text-xs text-muted-foreground">{it.podcast_name}{it.score ? ` · score ${Math.round(it.score)}` : ""}</div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Teaser</label>
                          <textarea
                            value={it.teaser}
                            onChange={(e) => updateItem(idx, { teaser: e.target.value })}
                            rows={2}
                            className="w-full mt-0.5 px-2 py-1 rounded border border-border bg-background text-xs"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] uppercase tracking-wider text-muted-foreground">Idézet ({it.quote.length}/160)</label>
                          <textarea
                            value={it.quote}
                            onChange={(e) => updateItem(idx, { quote: e.target.value })}
                            rows={2}
                            className="w-full mt-0.5 px-2 py-1 rounded border border-border bg-background text-xs font-medium"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </section>

              {/* Captions */}
              <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs uppercase tracking-wider text-muted-foreground">Instagram caption</h4>
                    <button onClick={() => copyText(current.ig_caption || "", "IG caption")} className="text-xs inline-flex items-center gap-1 text-brand"><Copy className="h-3 w-3" />Másol</button>
                  </div>
                  <textarea
                    value={current.ig_caption || ""}
                    onChange={(e) => setCurrent({ ...current, ig_caption: e.target.value })}
                    rows={10}
                    className="w-full px-2 py-1.5 rounded border border-border bg-background text-xs font-mono"
                  />
                </div>
                <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs uppercase tracking-wider text-muted-foreground">Facebook caption</h4>
                    <button onClick={() => copyText(current.fb_caption || "", "FB caption")} className="text-xs inline-flex items-center gap-1 text-brand"><Copy className="h-3 w-3" />Másol</button>
                  </div>
                  <textarea
                    value={current.fb_caption || ""}
                    onChange={(e) => setCurrent({ ...current, fb_caption: e.target.value })}
                    rows={10}
                    className="w-full px-2 py-1.5 rounded border border-border bg-background text-xs font-mono"
                  />
                </div>
              </section>

              {/* Cards gallery */}
              {(current.card_image_urls?.length || 0) > 0 && (
                <section className="space-y-2">
                  <h3 className="text-xs uppercase tracking-wider text-muted-foreground">Képek (jobbklikk → mentés vagy másolás)</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {(current.card_image_urls || []).map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noopener noreferrer" className="block">
                        <img src={url} alt={`card ${i}`} className="w-full rounded border border-border" />
                      </a>
                    ))}
                  </div>
                </section>
              )}
            </main>
          ) : (
            <div className="rounded-lg border border-dashed border-border p-12 text-center text-muted-foreground">
              Nincs draft kiválasztva. Indíts egyet a fenti gombbal.
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
