import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Loader2, Mail, Download, RefreshCw, CheckCircle2, XCircle, Clock } from "lucide-react";

type Row = {
  podcast_id: string;
  title: string;
  slug: string;
  tier: string | null;
  rank: number | null;
  rss_url: string | null;
  owner_email: string | null;
  owner_name: string | null;
  extract_status: string;
  extract_error: string | null;
  outreach_status: string;
  last_contacted_at: string | null;
  extracted_at: string | null;
};

const TIER_FILTERS = ["all", "S", "A", "B"] as const;

export default function AdminOutreachPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [tier, setTier] = useState<(typeof TIER_FILTERS)[number]>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "with_email" | "no_email" | "pending">("all");
  const [search, setSearch] = useState("");
  const [batchLimit, setBatchLimit] = useState(50);

  async function load() {
    setLoading(true);
    // Join podcasts + outreach contacts
    const { data: pods } = await supabase
      .from("podcasts")
      .select("id, title, slug, shadow_rank_tier, podiverzum_rank, rss_url")
      .ilike("language", "hu%")
      .in("shadow_rank_tier", ["S", "A", "B"])
      .order("podiverzum_rank", { ascending: false })
      .limit(1000);

    const ids = (pods ?? []).map((p) => p.id);
    const { data: contacts } = await supabase
      .from("podcast_outreach_contacts")
      .select("*")
      .in("podcast_id", ids);

    const cMap = new Map((contacts ?? []).map((c: any) => [c.podcast_id, c]));
    const out: Row[] = (pods ?? []).map((p: any) => {
      const c: any = cMap.get(p.id) || {};
      return {
        podcast_id: p.id,
        title: p.title,
        slug: p.slug,
        tier: p.shadow_rank_tier,
        rank: p.podiverzum_rank,
        rss_url: p.rss_url,
        owner_email: c.owner_email ?? null,
        owner_name: c.owner_name ?? null,
        extract_status: c.extract_status ?? "pending",
        extract_error: c.extract_error ?? null,
        outreach_status: c.outreach_status ?? "not_sent",
        last_contacted_at: c.last_contacted_at ?? null,
        extracted_at: c.extracted_at ?? null,
      };
    });
    setRows(out);
    setLoading(false);
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (tier !== "all" && r.tier !== tier) return false;
      if (statusFilter === "with_email" && !r.owner_email) return false;
      if (statusFilter === "no_email" && (r.owner_email || r.extract_status === "pending")) return false;
      if (statusFilter === "pending" && r.extract_status !== "pending") return false;
      if (search && !r.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [rows, tier, statusFilter, search]);

  const stats = useMemo(() => {
    const total = rows.length;
    const withEmail = rows.filter((r) => !!r.owner_email).length;
    const pending = rows.filter((r) => r.extract_status === "pending").length;
    const sent = rows.filter((r) => r.outreach_status === "sent").length;
    return { total, withEmail, pending, sent };
  }, [rows]);

  async function runExtract() {
    setExtracting(true);
    try {
      const targetIds = filtered
        .filter((r) => r.extract_status === "pending")
        .slice(0, batchLimit)
        .map((r) => r.podcast_id);

      const body = targetIds.length ? { podcast_ids: targetIds } : { limit: batchLimit };
      const { data, error } = await supabase.functions.invoke("outreach-extract-contacts", { body });
      if (error) throw error;
      toast.success(`Feldolgozva: ${data.processed} · email találat: ${data.ok} · nincs: ${data.fail}`);
      await load();
    } catch (e: any) {
      toast.error(e.message || "Hiba az extrakció során");
    } finally {
      setExtracting(false);
    }
  }

  function exportCsv() {
    const withEmail = filtered.filter((r) => !!r.owner_email);
    if (!withEmail.length) {
      toast.error("Nincs export-álható email a szűrőkben.");
      return;
    }
    const header = ["email", "owner_name", "podcast_title", "podcast_url", "tier", "rank", "outreach_status", "last_contacted_at"];
    const rowsCsv = withEmail.map((r) => [
      r.owner_email,
      r.owner_name ?? "",
      r.title,
      `https://podiverzum.hu/podcast/${r.slug}`,
      r.tier ?? "",
      r.rank ?? "",
      r.outreach_status,
      r.last_contacted_at ?? "",
    ]);
    const csv = [header, ...rowsCsv]
      .map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `podiverzum-outreach-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exportálva: ${withEmail.length} kontakt`);
  }

  async function markSent(id: string) {
    const { error } = await supabase
      .from("podcast_outreach_contacts")
      .update({ outreach_status: "sent", last_contacted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("podcast_id", id);
    if (error) toast.error(error.message);
    else {
      setRows((prev) => prev.map((r) => (r.podcast_id === id ? { ...r, outreach_status: "sent", last_contacted_at: new Date().toISOString() } : r)));
    }
  }

  async function markExcluded(id: string) {
    const { error } = await supabase
      .from("podcast_outreach_contacts")
      .upsert({ podcast_id: id, outreach_status: "excluded", updated_at: new Date().toISOString() }, { onConflict: "podcast_id" });
    if (error) toast.error(error.message);
    else setRows((prev) => prev.map((r) => (r.podcast_id === id ? { ...r, outreach_status: "excluded" } : r)));
  }

  return (
    <div className="container mx-auto py-8 px-4 max-w-7xl">
      <header className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Podcaster outreach</h1>
        <p className="text-muted-foreground">
          RSS-ből kinyert tulajdonos emailek a top magyar podcastokhoz. Exportáld CSV-ben, küldd dedikált cold-email eszközből (Instantly / Smartlead).
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Összes (S/A/B)</div>
          <div className="text-2xl font-bold">{stats.total}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Email találat</div>
          <div className="text-2xl font-bold text-green-600">{stats.withEmail}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Még nincs ellenőrizve</div>
          <div className="text-2xl font-bold text-amber-600">{stats.pending}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Kiküldve</div>
          <div className="text-2xl font-bold text-primary">{stats.sent}</div>
        </Card>
      </div>

      <Card className="p-4 mb-6">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <div className="text-xs text-muted-foreground mb-1">Tier</div>
            <div className="flex gap-1">
              {TIER_FILTERS.map((t) => (
                <Button key={t} size="sm" variant={tier === t ? "default" : "outline"} onClick={() => setTier(t)}>
                  {t === "all" ? "Mind" : t}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-1">Státusz</div>
            <div className="flex gap-1">
              {(["all", "with_email", "no_email", "pending"] as const).map((s) => (
                <Button key={s} size="sm" variant={statusFilter === s ? "default" : "outline"} onClick={() => setStatusFilter(s)}>
                  {s === "all" ? "Mind" : s === "with_email" ? "Email ✓" : s === "no_email" ? "Nincs email" : "Pending"}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex-1 min-w-[200px]">
            <div className="text-xs text-muted-foreground mb-1">Keresés cím szerint</div>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="pl. Partizán" />
          </div>
          <div className="w-28">
            <div className="text-xs text-muted-foreground mb-1">Batch méret</div>
            <Input type="number" value={batchLimit} onChange={(e) => setBatchLimit(Number(e.target.value) || 50)} />
          </div>
          <Button onClick={runExtract} disabled={extracting}>
            {extracting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Email kinyerés futtatása
          </Button>
          <Button onClick={exportCsv} variant="secondary">
            <Download className="h-4 w-4 mr-2" />
            CSV export (szűrt)
          </Button>
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Podcast</th>
                <th className="text-left p-3">Tier</th>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Extract</th>
                <th className="text-left p-3">Outreach</th>
                <th className="text-left p-3">Művelet</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin inline mr-2" />Betöltés…</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">Nincs találat a szűrőkre.</td></tr>
              )}
              {!loading && filtered.slice(0, 500).map((r) => (
                <tr key={r.podcast_id} className="border-t hover:bg-muted/30">
                  <td className="p-3">
                    <div className="font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[280px]">{r.rss_url}</div>
                  </td>
                  <td className="p-3"><Badge variant="outline">{r.tier}</Badge></td>
                  <td className="p-3">
                    {r.owner_email ? (
                      <a href={`mailto:${r.owner_email}`} className="text-primary hover:underline font-mono text-xs">{r.owner_email}</a>
                    ) : (
                      <span className="text-muted-foreground text-xs">—</span>
                    )}
                    {r.owner_name && <div className="text-xs text-muted-foreground">{r.owner_name}</div>}
                  </td>
                  <td className="p-3">
                    {r.extract_status === "ok" && <CheckCircle2 className="h-4 w-4 text-green-600 inline" />}
                    {r.extract_status === "no_email" && <XCircle className="h-4 w-4 text-amber-600 inline" />}
                    {r.extract_status === "pending" && <Clock className="h-4 w-4 text-muted-foreground inline" />}
                    <span className="ml-1 text-xs">{r.extract_status}</span>
                    {r.extract_error && <div className="text-xs text-red-500">{r.extract_error}</div>}
                  </td>
                  <td className="p-3">
                    <Badge variant={r.outreach_status === "sent" ? "default" : r.outreach_status === "excluded" ? "destructive" : "secondary"}>
                      {r.outreach_status}
                    </Badge>
                    {r.last_contacted_at && (
                      <div className="text-xs text-muted-foreground">{new Date(r.last_contacted_at).toLocaleDateString("hu-HU")}</div>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      {r.owner_email && r.outreach_status === "not_sent" && (
                        <Button size="sm" variant="outline" onClick={() => markSent(r.podcast_id)}>
                          <Mail className="h-3 w-3 mr-1" /> Kiküldve
                        </Button>
                      )}
                      {r.outreach_status !== "excluded" && (
                        <Button size="sm" variant="ghost" onClick={() => markExcluded(r.podcast_id)}>Kizár</Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 500 && (
          <div className="p-3 text-center text-xs text-muted-foreground border-t">
            Csak az első 500 sor látszik. Szűkítsd a szűrőket a teljes lista eléréséhez.
          </div>
        )}
      </Card>

      <Card className="p-6 mt-6 bg-muted/30">
        <h2 className="font-semibold mb-3">Magyar email sablon</h2>
        <Textarea
          rows={12}
          readOnly
          className="font-mono text-xs"
          defaultValue={`Tárgy: A(z) {{podcast_title}} mostantól a Podiverzumon is megtalálható

Szia {{owner_name}},

Marci vagyok a Podiverzum.hu-ról — ez egy új magyar podcast-felfedező oldal, ami az összes hazai műsort egy helyen kereshetővé teszi (AI-os szöveges keresés is van, nem csak cím szerint).

A(z) {{podcast_title}} már fent van:
{{podcast_url}}

Két dolog miatt írok:
1) Ha találsz hibát az oldaladon (rossz borító, hiányzó leírás, kategória), írj vissza és pillanat alatt javítjuk.
2) Ha tetszik az ötlet, egy backlink a podcastod weboldaláról / közösségi posztban sokat segítene — cserébe szívesen kiemelünk a kezdőlapon.

Kérdezz bátran!

Üdv,
Marci
podiverzum.hu`}
        />
        <p className="text-xs text-muted-foreground mt-2">
          A változókat (<code>{`{{owner_name}}`}</code>, <code>{`{{podcast_title}}`}</code>, <code>{`{{podcast_url}}`}</code>) az Instantly / Smartlead automatikusan kitölti a CSV oszlopaiból.
        </p>
      </Card>
    </div>
  );
}
