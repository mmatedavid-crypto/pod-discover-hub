import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Admin-only view of the free rule lanes: sourced show-host rules (series-level roster role, never counted as an
// appearance) and explicit episode-credit rules (named narrator/preacher/speaker; corrected RSS author credits).
// Closed lane states are reported as closed, never as pending work.
const fmt = (v: unknown) => Number(v || 0).toLocaleString("hu-HU");
const ROLE_LABELS: Record<string, string> = {
  narrator: "mesélő", preacher: "igehirdető", performer: "előadó", guest: "vendég", speaker: "megszólaló", host: "műsorvezető",
};

export default function PersonRuleLanesPanel() {
  const [s, setS] = useState<any>(null);
  const [msg, setMsg] = useState("");
  const load = async () => {
    const { data, error } = await supabase.rpc("get_person_rule_lanes_status_v1");
    if (error) setMsg(error.message); else setS(data);
  };
  useEffect(() => { load(); }, []);
  if (!s) return <div className="text-sm text-muted-foreground">{msg || "Szabálysávok betöltése…"}</div>;
  const t = s.totals || {};

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-semibold">Szabályalapú lezárások (AI nélkül)</h2>
        <button onClick={load} className="px-3 py-1.5 rounded-md border border-border text-sm">Frissítés</button>
      </div>
      <p className="text-sm text-muted-foreground">
        A műsorvezetői szabály a sorozat állandó műsorvezetőjét jelöli (örökölt szerep, nem igazolt megszólalás, nem számít a személyoldal szereplései közé).
        Az epizódkredit-szabály csak a kiadói leírásban név szerint megnevezett szereplőt fogadja el; a pusztán RSS-szerzőmezőből keletkezett, mást megnevező epizódnál a jelöltet lezárja (javítás, nem bizonyított nemszereplés).
      </p>
      <div className="grid md:grid-cols-4 gap-3">
        {[
          ["Lezárt pár", t.closed], ["Nyitott pár", t.open],
          ["Műsorvezetőként lezárva", t.resolved_show_host], ["RSS-szerzőkredit javítva", t.resolved_feed_credit_not_episode],
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
            <tr>{["műsor", "szabály", "forrás", "tulajdonos igazolta", "hatály", "lezárt pár", "epizód"].map((h) => <th key={h} className="text-left p-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {(s.show_rules || []).map((r: any) => (
              <tr key={r.slug} className="border-t border-border">
                <td className="p-2">{r.title}</td>
                <td className="p-2 tabular-nums">{r.rules}{r.sub_show ? " · alműsor" : ""}</td>
                <td className="p-2"><a href={r.source_url} target="_blank" rel="noreferrer" className="underline">{new URL(r.source_url).hostname}</a></td>
                <td className="p-2">{r.owner_confirmed ? "igen" : "kiadói leírás"}</td>
                <td className="p-2">{r.valid_from ? `${r.valid_from}-tól` : "tárolt sorozat"}</td>
                <td className="p-2 tabular-nums">{fmt(r.pairs)}</td>
                <td className="p-2 tabular-nums">{fmt(r.episodes)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="min-w-full text-xs">
          <thead className="bg-secondary text-muted-foreground">
            <tr>{["epizódkredit-szabály", "szerep", "forrásminta", "tulajdonos igazolta", "elfogadott szereplés", "javított RSS-kredit", "visszavonva"].map((h) => <th key={h} className="text-left p-2">{h}</th>)}</tr>
          </thead>
          <tbody>
            {(s.credit_rules || []).map((r: any) => (
              <tr key={r.rule_key} className="border-t border-border">
                <td className="p-2">{r.rule_key}</td>
                <td className="p-2">{ROLE_LABELS[r.credit_role] || r.credit_role}</td>
                <td className="p-2 max-w-md">{r.source_quote}</td>
                <td className="p-2">{r.owner_confirmed ? "igen" : "kiadói leírás"}</td>
                <td className="p-2 tabular-nums">{fmt(r.credited)}</td>
                <td className="p-2 tabular-nums">{r.correct_feed_credits ? fmt(r.corrected) : "–"}</td>
                <td className="p-2 tabular-nums">{fmt(r.undone)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
