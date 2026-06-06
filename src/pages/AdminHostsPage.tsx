import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { X } from "lucide-react";

interface PodcastRow {
  id: string;
  title: string;
  display_title?: string | null;
  slug: string;
  language?: string | null;
  language_decision?: string | null;
  podiverzum_rank?: number | null;
  rank_label?: string | null;
  hosts: string[];
  hosts_source?: string | null;
  hosts_updated_at?: string | null;
}

export default function AdminHostsPage() {
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "missing" | "has">("missing");
  const [rows, setRows] = useState<PodcastRow[]>([]);
  const [editing, setEditing] = useState<Record<string, string[]>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const navigate = useNavigate();

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { navigate("/auth?next=/admin/hosts"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: user.id, _role: "admin" });
      if (!hasAdmin) { setIsAdmin(false); return; }
      setIsAdmin(true);
      await loadRows();
    })();
  }, []);

  async function loadRows() {
    setLoading(true);
    let q = supabase
      .from("podcasts")
      .select("id,title,display_title,slug,language,language_decision,podiverzum_rank,rank_label,hosts,hosts_source,hosts_updated_at")
      .eq("language_decision", "accept_hungarian")
      .order("podiverzum_rank", { ascending: false, nullsFirst: false })
      .limit(200);
    if (search.trim()) q = q.ilike("title", `%${search.trim()}%`);
    const { data } = await q;
    let list = ((data || []) as any[]) as PodcastRow[];
    if (filter === "missing") list = list.filter((r) => !r.hosts || r.hosts.length === 0);
    if (filter === "has") list = list.filter((r) => r.hosts && r.hosts.length > 0);
    setRows(list);
    const ed: Record<string, string[]> = {};
    list.forEach((r) => { ed[r.id] = [...(r.hosts || [])]; });
    setEditing(ed);
    setLoading(false);
  }

  async function save(podcastId: string) {
    const hosts = (editing[podcastId] || []).map((s) => s.trim()).filter(Boolean);
    const { error } = await supabase
      .from("podcasts")
      .update({
        hosts,
        hosts_source: "manual",
        hosts_updated_at: new Date().toISOString(),
      })
      .eq("id", podcastId);
    if (error) {
      toast({ title: "Mentés sikertelen", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Mentve", description: `${hosts.length} host` });
    setRows((rs) => rs.map((r) => r.id === podcastId ? { ...r, hosts, hosts_source: "manual", hosts_updated_at: new Date().toISOString() } : r));
  }

  function addHost(podcastId: string) {
    const val = (draft[podcastId] || "").trim();
    if (!val) return;
    setEditing((e) => ({ ...e, [podcastId]: [...(e[podcastId] || []), val] }));
    setDraft((d) => ({ ...d, [podcastId]: "" }));
  }
  function removeHost(podcastId: string, idx: number) {
    setEditing((e) => ({ ...e, [podcastId]: (e[podcastId] || []).filter((_, i) => i !== idx) }));
  }

  if (isAdmin === false) return <Layout><div className="container mx-auto py-20">Csak adminoknak.</div></Layout>;
  if (isAdmin === null) return <Layout><div className="container mx-auto py-20">Betöltés…</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto py-8 max-w-5xl">
        <div className="mb-6">
          <h1 className="text-3xl font-bold">Podcast hostok</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Add meg a műsorvezetők kanonikus nevét. Az AI entity extractor automatikusan kiszűri őket a `people` és `mentioned` listából, így nem szerepelnek hibásan szereplőként.
          </p>
        </div>

        <div className="flex flex-wrap gap-2 mb-4 items-center">
          <Input
            placeholder="Keresés a címben…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadRows()}
            className="max-w-xs"
          />
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
            className="bg-background border border-border rounded-md h-9 px-2 text-sm"
          >
            <option value="missing">Nincs host beállítva</option>
            <option value="has">Van host beállítva</option>
            <option value="all">Mind</option>
          </select>
          <Button onClick={loadRows} disabled={loading}>{loading ? "…" : "Frissítés"}</Button>
        </div>

        <div className="space-y-3">
          {rows.map((r) => {
            const hosts = editing[r.id] || [];
            const dirty = JSON.stringify(hosts) !== JSON.stringify(r.hosts || []);
            return (
              <div key={r.id} className="rounded-xl border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <a href={`/podcast/${r.slug}`} target="_blank" rel="noreferrer" className="font-semibold hover:underline truncate">
                        {r.display_title || r.title}
                      </a>
                      {r.rank_label && <Badge variant="outline" className="text-[10px]">{r.rank_label}</Badge>}
                      <Badge variant="secondary" className="text-[10px]">{r.language}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {r.hosts_source ? `${r.hosts_source} · ${r.hosts_updated_at?.slice(0,10) || ""}` : "Nincs megadva"}
                    </div>
                  </div>
                  <Button size="sm" disabled={!dirty} onClick={() => save(r.id)}>
                    {dirty ? "Mentés" : "Mentve"}
                  </Button>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {hosts.map((h, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-sm">
                      {h}
                      <button onClick={() => removeHost(r.id, i)} className="hover:text-destructive">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  ))}
                  {hosts.length === 0 && <span className="text-xs text-muted-foreground italic">Nincs host</span>}
                </div>

                <div className="mt-2 flex gap-2">
                  <Input
                    placeholder="Új host neve…"
                    value={draft[r.id] || ""}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addHost(r.id)}
                    className="max-w-xs h-8 text-sm"
                  />
                  <Button size="sm" variant="outline" onClick={() => addHost(r.id)}>Hozzáad</Button>
                </div>
              </div>
            );
          })}
          {!rows.length && !loading && <div className="text-muted-foreground text-sm">Nincs találat.</div>}
        </div>
      </div>
    </Layout>
  );
}
