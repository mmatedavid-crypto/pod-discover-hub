import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Admin-only view of the verified identity merge system: which profiles were merged into one person, which
// namesakes are kept apart, Hungarian name-form rules, repair runs (with full backups) and policy corrections.
const fmt = (v: unknown) => Number(v || 0).toLocaleString("hu-HU");
const EVENT_LABELS: Record<string, string> = {
  prevent_alias_reactivation: "összevont profil újraaktiválása megakadályozva",
  prevent_self_duplicate: "önmagára mutató duplikátum megakadályozva",
  protect_verified_canonical: "igazolt fő profil védve",
  protect_distinct_namesakes: "névrokonok összevonása megakadályozva",
  canonicalize_mention: "új kapcsolat a fő profilra irányítva",
  canonicalize_disposition: "új párállapot a fő profilra irányítva",
  canonicalize_name_variant_mention: "névalak-változat a fő profilra irányítva",
  canonicalize_name_variant_disposition: "névalak-változat párállapota átirányítva",
  deduplicate_relation: "ismétlődő kapcsolat kiszűrve",
  register_name_variant_alias: "új névalak-profil automatikusan összevonva",
};

export default function PersonIdentityMergePanel() {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const load = async () => {
    const { data, error } = await supabase.rpc("get_person_identity_status_v1");
    if (error) setMsg(error.message); else setS(data);
  };
  useEffect(() => { load(); }, []);
  if (!s) return <div className="text-sm text-muted-foreground">{msg || "Személyösszevonások betöltése…"}</div>;
  const t = s.totals || {};

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">Igazolt személyösszevonások</h2>
        <button onClick={load} className="px-3 py-1.5 rounded-md border border-border text-sm">Frissítés</button>
      </div>
      <p className="text-sm text-muted-foreground">
        Ugyanannak a személynek külön keletkezett profiljai egy fő profilba kerültek; az új kapcsolatok automatikusan a fő profilra mennek, az összevont profil rejtve marad.
        A külön tartott névrokonokat a rendszer soha nem vonja össze. Minden futásról teljes mentés készült.
      </p>
      <div className="grid md:grid-cols-4 gap-3">
        {[
          ["Összevont profil", t.merge_rules_active], ["Fő profil", t.canonical_people],
          ["Külön tartott névrokon-pár", t.separation_rules], ["Névalak-szabály", t.name_variant_rules],
        ].map(([k, v]) => (
          <div key={String(k)} className="p-4 rounded-lg border border-border bg-card">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{k}</div>
            <div className="text-lg font-semibold tabular-nums">{fmt(v)}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-xs">
          <thead className="bg-secondary text-muted-foreground">
            <tr>{["fő profil", "összevont profilok", "bizonyíték"].map((h) => <th key={h} className="text-left p-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {(s.merges || []).map((r: any) => (
              <tr key={r.slug} className="border-t border-border align-top">
                <td className="p-2"><a href={`/szemelyek/${r.slug}`} target="_blank" rel="noreferrer" className="underline">{r.name}</a></td>
                <td className="p-2 tabular-nums">{fmt(r.sources)} profil · {Array.from(new Set<string>(r.source_names || [])).join(", ")}</td>
                <td className="p-2 max-w-md">{r.evidence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid md:grid-cols-2 gap-3">
        <div className="rounded-lg border border-border p-3 space-y-1">
          <h3 className="text-sm font-semibold">Külön tartott névrokonok</h3>
          {(s.separations || []).map((r: any, i: number) => (
            <div key={i} className="text-xs text-muted-foreground">{r.person} ≠ {r.other}: {r.reason}</div>
          ))}
        </div>
        <div className="rounded-lg border border-border p-3 space-y-1">
          <h3 className="text-sm font-semibold">Névalak-szabályok</h3>
          {(s.name_variants || []).map((r: any, i: number) => (
            <div key={i} className="text-xs text-muted-foreground">
              {r.base_name} → {r.person} ({r.scope === "global" ? "mindenhol" : "csak igazolt műsorkörnyezetben"}, {fmt(r.forms)} ragozott alak)
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-border p-3 space-y-1">
        <h3 className="text-sm font-semibold">Védelmi események és javítások</h3>
        {Object.entries(s.events || {}).map(([k, v]) => (
          <div key={k} className="text-xs text-muted-foreground">{EVENT_LABELS[k] || k}: {fmt(v)}</div>
        ))}
        {(s.runs || []).map((r: any) => (
          <div key={r.id} className="text-xs text-muted-foreground">
            Futás {new Date(r.created_at).toLocaleString("hu-HU")}: {fmt(r.summary?.source_profiles)} profil → {fmt(r.summary?.canonical_people)} fő profil
            {r.summary?.backup_rows ? `, ${fmt(r.summary.backup_rows)} mentett sor` : ""}
          </div>
        ))}
        {(s.credit_policy_repairs || []).map((r: any, i: number) => (
          <div key={i} className="text-xs text-muted-foreground">
            Tulajdonosi javítás {new Date(r.created_at).toLocaleString("hu-HU")}: {fmt(r.summary?.reopened_pairs)} „nem szerepel” lezárás visszanyitva, {fmt(r.summary?.positive_resolutions_preserved)} elfogadott kredit megmaradt.
          </div>
        ))}
      </div>
    </section>
  );
}
