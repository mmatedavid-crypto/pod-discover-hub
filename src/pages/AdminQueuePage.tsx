import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { slugify } from "@/lib/slug";

const TEMP_ADMIN_USER_ID = "7b92654a-2b5d-438c-ad67-7ad5f6709483";

export default function AdminQueuePage() {
  const nav = useNavigate();
  const [ready, setReady] = useState(false);
  const [allowed, setAllowed] = useState(false);
  const [items, setItems] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ ok: number; failed: number; skipped: number } | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { nav("/auth"); return; }
      const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
      const isAdmin = (roles || []).some((r: any) => r.role === "admin");
      setAllowed(isAdmin || user.id === TEMP_ADMIN_USER_ID);
      setReady(true);
      await load();
    })();
  }, []);

  const load = async () => {
    const { data } = await supabase.from("discovery_queue").select("*").eq("status", "pending").order("candidate_rank", { ascending: false });
    setItems(data || []);
  };

  const approve = async (item: any) => {
    setBusy(item.id);
    try {
      const slug = slugify(item.title);
      const { data: inserted, error } = await supabase.from("podcasts").insert({
        title: item.title,
        slug,
        description: item.description,
        rss_url: item.rss_url,
        website_url: item.website_url,
        image_url: item.image_url,
        language: item.language || "en",
        category: item.category,
        source: "discovery_approved",
        rss_status: "not_checked",
        podiverzum_rank: item.candidate_rank,
        rank_reason: item.rank_reason,
      }).select("id").single();
      if (error) throw error;
      await supabase.from("discovery_queue").update({ status: "approved" }).eq("id", item.id);
      try { await supabase.functions.invoke("fetch-rss", { body: { podcast_id: inserted.id } }); } catch { /* */ }
      toast.success("Approved & added");
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally { setBusy(null); }
  };

  const bulkImportRank4Plus = async () => {
    if (!confirm("Import all technically valid Rank ≥ 4 queued podcasts? They will be added to the index (Rank 4–5 indexed only, Rank ≥ 6 promotion-eligible).")) return;
    setBulkBusy(true);
    let ok = 0, failed = 0, skipped = 0;
    setBulkProgress({ ok, failed, skipped });
    try {
      const { data: candidates } = await supabase
        .from("discovery_queue").select("*")
        .eq("status", "pending").gte("candidate_rank", 4)
        .order("candidate_rank", { ascending: false }).limit(2000);
      const list = candidates || [];
      const BATCH = 5;
      for (let i = 0; i < list.length; i += BATCH) {
        const chunk = list.slice(i, i + BATCH);
        await Promise.all(chunk.map(async (item: any) => {
          try {
            if (!item.rss_url || !item.title) {
              await supabase.from("discovery_queue").update({ status: "rejected" }).eq("id", item.id);
              skipped++; return;
            }
            const { data: dup } = await supabase.from("podcasts").select("id").eq("rss_url", item.rss_url).maybeSingle();
            if (dup) {
              await supabase.from("discovery_queue").update({ status: "approved" }).eq("id", item.id);
              skipped++; return;
            }
            let slug = slugify(item.title);
            for (let a = 0; a < 5; a++) {
              const { data: ds } = await supabase.from("podcasts").select("id").eq("slug", slug).maybeSingle();
              if (!ds) break; slug = `${slugify(item.title)}-${a + 1}`;
            }
            const rankLabel = item.candidate_rank >= 8 ? "Excellent" : item.candidate_rank >= 6 ? "Strong" : "Indexed";
            const { data: inserted, error } = await supabase.from("podcasts").insert({
              title: item.title, slug,
              description: item.description, rss_url: item.rss_url,
              website_url: item.website_url, image_url: item.image_url,
              language: item.language || "en", category: item.category,
              source: item.source || "queue_bulk_import",
              rss_status: "not_checked",
              podiverzum_rank: item.candidate_rank,
              rank_label: rankLabel,
              rank_reason: item.rank_reason,
            }).select("id").single();
            if (error || !inserted) { failed++; return; }
            const epCap = item.candidate_rank >= 8 ? 75 : item.candidate_rank >= 6 ? 50 : 30;
            try { await supabase.functions.invoke("fetch-rss", { body: { podcast_id: inserted.id, episode_cap: epCap } }); } catch { /* */ }
            await supabase.from("discovery_queue").update({ status: "approved" }).eq("id", item.id);
            ok++;
          } catch { failed++; }
        }));
        setBulkProgress({ ok, failed, skipped });
      }
      toast.success(`Bulk import: +${ok} imported, ${skipped} skipped, ${failed} failed`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "bulk import failed");
    } finally { setBulkBusy(false); }
  };

  const reject = async (id: string) => {
    setBusy(id);
    await supabase.from("discovery_queue").update({ status: "rejected" }).eq("id", id);
    setBusy(null);
    await load();
  };

  if (!ready) return <Layout><div className="container py-8">Loading…</div></Layout>;
  if (!allowed) return <Layout><div className="container py-8">Admin access required.</div></Layout>;

  return (
    <Layout>
      <div className="container py-6 space-y-4 max-w-5xl">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-2xl font-semibold">Approval Queue ({items.length})</h1>
          <div className="flex gap-2">
            <Button onClick={bulkImportRank4Plus} disabled={bulkBusy}>
              {bulkBusy ? `Importing… (+${bulkProgress?.ok ?? 0})` : "Import all valid Rank ≥ 4"}
            </Button>
            <Button asChild variant="outline"><Link to="/admin/growth">Growth Dashboard</Link></Button>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Bulk import adds Rank ≥ 4 podcasts to the index. Rank 4–5 will be searchable but not promoted on the homepage (Rank ≥ 6 required for promotion). Episodes per podcast: Rank 8+ → 75, Rank 6–7 → 50, Rank 4–5 → 30.
        </p>
        {bulkProgress && <p className="text-xs text-muted-foreground">Progress: +{bulkProgress.ok} imported · {bulkProgress.skipped} skipped · {bulkProgress.failed} failed</p>}
        {items.length === 0 && <p className="text-sm text-muted-foreground">No pending candidates.</p>}
        <div className="grid gap-3">
          {items.map((it) => (
            <Card key={it.id}>
              <CardContent className="p-4 flex gap-3 items-start">
                {it.image_url && <img src={it.image_url} alt="" className="w-16 h-16 rounded object-cover" />}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-medium truncate">{it.title}</div>
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">Rank {it.candidate_rank}</span>
                    {it.language && <span className="text-xs text-muted-foreground">{it.language}</span>}
                    {it.category && <span className="text-xs text-muted-foreground">· {it.category}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-2 mt-1">{it.description}</div>
                  <div className="text-xs text-muted-foreground mt-1 truncate">{it.rss_url}</div>
                </div>
                <div className="flex flex-col gap-2">
                  <Button size="sm" onClick={() => approve(it)} disabled={busy === it.id}>Approve</Button>
                  <Button size="sm" variant="outline" onClick={() => reject(it.id)} disabled={busy === it.id}>Reject</Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </Layout>
  );
}
