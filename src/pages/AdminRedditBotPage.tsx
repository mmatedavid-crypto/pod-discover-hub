import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useNoindex } from "@/lib/useNoindex";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Play, RefreshCw, Save, Trash2 } from "lucide-react";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

type Controls = {
  enabled: boolean;
  dry_run: boolean;
  daily_cap: number;
  comment_cooldown_s: number;
  max_thread_age_days: number;
  subs: string[];
  last_seen?: Record<string, string>;
  updated_at?: string;
};

type LogRow = {
  id: number;
  ts: string;
  subreddit: string | null;
  thing_kind: string | null;
  thing_author: string | null;
  thing_url: string | null;
  matched_kind: string | null;
  matched_name: string | null;
  matched_url: string | null;
  action: string;
  reason: string | null;
};

type OptOutRow = { username: string; reason: string | null; created_at: string };

const ACTION_COLORS: Record<string, string> = {
  posted: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  skipped_dry_run: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  skipped_duplicate: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  skipped_opt_out: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  skipped_cap: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  skipped_cooldown: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  skipped_old: "bg-muted text-muted-foreground",
  error: "bg-red-500/15 text-red-700 dark:text-red-300",
  opt_out_added: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
};

export default function AdminRedditBotPage() {
  useNoindex("Reddit Link Bot — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [controls, setControls] = useState<Controls | null>(null);
  const [logs, setLogs] = useState<LogRow[]>([]);
  const [optOuts, setOptOuts] = useState<OptOutRow[]>([]);
  const [indexSize, setIndexSize] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [newOptOut, setNewOptOut] = useState("");

  useEffect(() => {
    (async () => {
      const { data: s } = await supabase.auth.getSession();
      const uid = s.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" });
      const admin = hasAdmin === true || uid === TEMP_ADMIN_USER_ID;
      setIsAdmin(admin);
      setReady(true);
      if (admin) load();
    })();
  }, [nav]);

  const load = async () => {
    setLoading(true);
    const [c, l, o, ix] = await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "reddit_link_bot_controls").maybeSingle(),
      supabase.from("reddit_bot_log").select("*").order("ts", { ascending: false }).limit(100),
      supabase.from("reddit_bot_opt_out").select("*").order("created_at", { ascending: false }).limit(100),
      supabase.from("reddit_name_index").select("*", { count: "exact", head: true }),
    ]);
    setControls((c.data?.value || {}) as Controls);
    setLogs((l.data || []) as LogRow[]);
    setOptOuts((o.data || []) as OptOutRow[]);
    setIndexSize(ix.count ?? null);
    setLoading(false);
  };

  const save = async () => {
    if (!controls) return;
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "reddit_link_bot_controls", value: { ...controls, updated_at: new Date().toISOString() } });
    if (error) {
      toast({ title: "Mentés sikertelen", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Mentve" });
      load();
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("reddit-link-bot", { body: { force: true } });
      if (error) throw error;
      toast({ title: "Lefutott", description: JSON.stringify(data).slice(0, 200) });
      setTimeout(load, 1500);
    } catch (e: any) {
      toast({ title: "Hiba", description: e.message ?? String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const refreshIndex = async () => {
    const { error } = await (supabase as any).rpc("refresh_reddit_name_index");
    if (error) toast({ title: "Refresh hiba", description: error.message, variant: "destructive" });
    else { toast({ title: "Név-index frissítve" }); load(); }
  };

  const addOptOut = async () => {
    const u = newOptOut.trim().replace(/^u\//, "");
    if (!u) return;
    const { error } = await supabase.from("reddit_bot_opt_out").insert({ username: u, reason: "manual" });
    if (error) toast({ title: "Hiba", description: error.message, variant: "destructive" });
    else { setNewOptOut(""); load(); }
  };

  const removeOptOut = async (u: string) => {
    const { error } = await supabase.from("reddit_bot_opt_out").delete().eq("username", u);
    if (error) toast({ title: "Hiba", description: error.message, variant: "destructive" });
    else load();
  };

  if (!ready) return <Layout><div className="p-8">Betöltés…</div></Layout>;
  if (!isAdmin) return <Layout><div className="p-8">Nincs jogosultság.</div></Layout>;

  return (
    <Layout>
      <div className="container mx-auto max-w-6xl px-4 py-6 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Reddit Link Bot</h1>
            <p className="text-muted-foreground text-sm">Reaktív Podiverzum-linkelő r/hungary, r/Magyarorszag, r/podcasts threadekben.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={load} disabled={loading}><RefreshCw className="h-4 w-4 mr-1" /> Frissítés</Button>
            <Button variant="outline" size="sm" onClick={refreshIndex}>Név-index újraépítése</Button>
            <Button size="sm" onClick={runNow} disabled={running}><Play className="h-4 w-4 mr-1" /> Futtatás most</Button>
          </div>
        </div>

        {controls && (
          <Card>
            <CardHeader><CardTitle>Beállítások</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-6 flex-wrap">
                <label className="flex items-center gap-2">
                  <Switch checked={controls.enabled} onCheckedChange={(v) => setControls({ ...controls, enabled: v })} />
                  <span>Engedélyezve</span>
                </label>
                <label className="flex items-center gap-2">
                  <Switch checked={controls.dry_run} onCheckedChange={(v) => setControls({ ...controls, dry_run: v })} />
                  <span>Dry run <span className="text-xs text-muted-foreground">(matchel, de nem posztol)</span></span>
                </label>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs">Daily cap (komment / 24 óra)</Label>
                  <Input type="number" value={controls.daily_cap} onChange={(e) => setControls({ ...controls, daily_cap: Number(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Cooldown (másodperc)</Label>
                  <Input type="number" value={controls.comment_cooldown_s} onChange={(e) => setControls({ ...controls, comment_cooldown_s: Number(e.target.value) })} />
                </div>
                <div>
                  <Label className="text-xs">Max thread életkor (nap)</Label>
                  <Input type="number" value={controls.max_thread_age_days} onChange={(e) => setControls({ ...controls, max_thread_age_days: Number(e.target.value) })} />
                </div>
              </div>
              <div>
                <Label className="text-xs">Subreddits (vesszővel)</Label>
                <Input
                  value={(controls.subs || []).join(",")}
                  onChange={(e) => setControls({ ...controls, subs: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                />
              </div>
              <div className="flex items-center gap-3 flex-wrap text-sm text-muted-foreground">
                <span>Név-index mérete: <strong>{indexSize ?? "?"}</strong></span>
                {controls.updated_at && <span>Utoljára mentve: {new Date(controls.updated_at).toLocaleString("hu-HU")}</span>}
              </div>
              <Button onClick={save}><Save className="h-4 w-4 mr-1" /> Mentés</Button>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader><CardTitle>Opt-out lista ({optOuts.length})</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input placeholder="u/valaki" value={newOptOut} onChange={(e) => setNewOptOut(e.target.value)} className="max-w-xs" />
              <Button variant="outline" onClick={addOptOut}>Hozzáadás</Button>
            </div>
            {optOuts.length === 0 ? <p className="text-sm text-muted-foreground">Üres.</p> : (
              <ul className="divide-y">
                {optOuts.map((o) => (
                  <li key={o.username} className="flex items-center justify-between py-2 text-sm">
                    <span>u/{o.username} <span className="text-muted-foreground text-xs">— {o.reason ?? "—"} ({new Date(o.created_at).toLocaleDateString("hu-HU")})</span></span>
                    <Button size="sm" variant="ghost" onClick={() => removeOptOut(o.username)}><Trash2 className="h-4 w-4" /></Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Utolsó 100 esemény</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Idő</TableHead>
                    <TableHead>Akció</TableHead>
                    <TableHead>Sub</TableHead>
                    <TableHead>Szerző</TableHead>
                    <TableHead>Match</TableHead>
                    <TableHead>Reason / Link</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs whitespace-nowrap">{new Date(l.ts).toLocaleString("hu-HU")}</TableCell>
                      <TableCell><Badge className={ACTION_COLORS[l.action] ?? ""}>{l.action}</Badge></TableCell>
                      <TableCell className="text-xs">{l.subreddit ?? "—"}</TableCell>
                      <TableCell className="text-xs">{l.thing_author ? `u/${l.thing_author}` : "—"}</TableCell>
                      <TableCell className="text-xs">
                        {l.matched_name ? (
                          <span>
                            <Badge variant="outline" className="mr-1">{l.matched_kind}</Badge>
                            {l.matched_name}
                          </span>
                        ) : "—"}
                      </TableCell>
                      <TableCell className="text-xs max-w-md truncate">
                        {l.thing_url && <a href={l.thing_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline mr-2">thread</a>}
                        {l.reason}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {logs.length === 0 && <p className="text-sm text-muted-foreground py-6 text-center">Még nincs log.</p>}
            </div>
          </CardContent>
        </Card>
      </div>
    </Layout>
  );
}
