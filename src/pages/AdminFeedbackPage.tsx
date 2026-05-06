import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useNoindex } from "@/lib/useNoindex";
import { toast } from "sonner";

type Row = {
  id: string;
  message: string;
  email: string | null;
  page_url: string | null;
  viewport: string | null;
  user_agent: string | null;
  search_query: string | null;
  user_id: string | null;
  handled: boolean;
  created_at: string;
};

export default function AdminFeedbackPage() {
  useNoindex("Admin · Feedback — Podiverzum");
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [showHandled, setShowHandled] = useState(false);

  const refresh = async () => {
    const q = supabase.from("beta_feedback").select("*").order("created_at", { ascending: false }).limit(500);
    const { data, error } = await q;
    if (error) { toast.error(error.message); return; }
    setRows((data as Row[]) || []);
  };

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      if (!uid) { nav("/auth"); return; }
      const { data: hasAdmin } = await (supabase as any).rpc("has_role", { _user_id: uid, _role: "admin" });
      setIsAdmin(hasAdmin === true);
      if (hasAdmin === true) await refresh();
      setReady(true);
    })();
  }, [nav]);

  const toggleHandled = async (r: Row) => {
    const { error } = await supabase.from("beta_feedback").update({ handled: !r.handled }).eq("id", r.id);
    if (error) return toast.error(error.message);
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this feedback entry?")) return;
    const { error } = await supabase.from("beta_feedback").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  };

  if (!ready) return <Layout><div className="container mx-auto py-20 text-muted-foreground">Loading…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Not authorized.</div></Layout>;

  const visible = rows.filter((r) => showHandled || !r.handled);

  return (
    <Layout>
      <div className="container mx-auto py-10 space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-3xl font-semibold">Beta feedback</h1>
          <label className="text-sm flex items-center gap-2">
            <input type="checkbox" checked={showHandled} onChange={(e) => setShowHandled(e.target.checked)} />
            Show handled
          </label>
        </div>
        <p className="text-sm text-muted-foreground">
          {visible.length} of {rows.length} entries
        </p>

        <div className="space-y-3">
          {visible.map((r) => (
            <div key={r.id} className={`p-4 rounded-lg border ${r.handled ? "border-border opacity-60" : "border-border bg-card"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="text-xs text-muted-foreground">
                  {new Date(r.created_at).toLocaleString()} · {r.viewport || "?"}
                  {r.email && <> · <a href={`mailto:${r.email}`} className="underline">{r.email}</a></>}
                  {r.search_query && <> · query: <code>{r.search_query}</code></>}
                </div>
                <div className="flex gap-2 text-xs">
                  <button onClick={() => toggleHandled(r)} className="px-2 py-1 rounded border border-border hover:border-foreground/40">
                    {r.handled ? "Reopen" : "Mark handled"}
                  </button>
                  <button onClick={() => remove(r.id)} className="px-2 py-1 rounded border border-destructive/30 text-destructive hover:bg-destructive/10">
                    Delete
                  </button>
                </div>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{r.message}</p>
              {r.page_url && (
                <p className="mt-2 text-xs text-muted-foreground break-all">
                  <a href={r.page_url} className="underline" target="_blank" rel="noreferrer">{r.page_url}</a>
                </p>
              )}
              {r.user_agent && (
                <p className="mt-1 text-[11px] text-muted-foreground/70 break-all">{r.user_agent}</p>
              )}
            </div>
          ))}
          {visible.length === 0 && (
            <p className="text-sm text-muted-foreground py-10 text-center">No feedback yet.</p>
          )}
        </div>
      </div>
    </Layout>
  );
}
