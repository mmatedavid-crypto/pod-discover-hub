import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

// Admin-only status of the person–episode review: real unique pairs by state, the central
// external AI budget, the evidence pilot and its quality gate, plus human reference labelling.
const PAIR_LABELS: Record<string, string> = {
  decided_accepted: "Eldöntve: elfogadva",
  decided_rejected: "Eldöntve: elutasítva",
  first_round_pending: "1. körre vár",
  in_progress: "Épp feldolgozás alatt",
  evidence_pending: "Célzott bizonyítékra vár",
  insufficient_evidence: "Forrásból nem igazolható (név nincs a forrásokban)",
  source_needed: "Forrás hiányzik",
  technical_retry: "Technikai újrapróba",
  human_identity_review: "Valódi kézi eset: névrokon / kétértelmű személy",
  human_contradiction_review: "Valódi kézi eset: ellentmondás",
  other: "Egyéb",
};
const REASON_LABELS: Record<string, string> = {
  name_not_in_available_sources: "a név nem szerepel az epizód szövegeiben",
  rss_author_credit_only: "csak a hírcsatorna szerzőmezőjében szerepel (stáb/szerző, nem jelenlét)",
  same_name_or_ambiguous_person: "azonos nevű vagy kétértelmű személy",
  needs_targeted_evidence: "a név szerepel, célzott bizonyíték kell",
  no_usable_source_text: "nincs használható szöveg",
  waiting_clean_text: "tisztított szövegre vár",
  last_request_failed: "az utolsó kérés technikai hibával zárult",
  ai_opinions_conflict: "a két AI-vélemény ellentmond",
  manual_review_conflict: "korábbi kézi döntéssel ütközik",
};
const ROLE_BUTTONS: [string, string][] = [
  ["guest", "Vendég"], ["host", "Műsorvezető"], ["co_host", "Társműsorvezető"], ["subject", "Róla szól"], ["mentioned", "Említés"],
  ["credit_only", "Csak stáblista/szerző"], ["not_present", "Nincs érdemi kapcsolat"], ["different_person", "Másik személy"], ["cannot_tell", "Nem dönthető el"],
];
const usd = (v: unknown, d = 2) => `$${Number(v || 0).toFixed(d)}`;

async function call(action: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("person-evidence-review", { body: { action, ...extra } });
  if (error) throw error;
  return data;
}

export default function PersonEvidenceReviewPanel() {
  const [s, setS] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = async () => {
    const { data, error } = await supabase.rpc("get_person_review_status_v1");
    if (error) setMsg(error.message); else setS(data);
  };
  useEffect(() => { load(); }, []);

  const loadSample = async () => {
    setBusy(true);
    try { const r = await call("sample", { limit: 10 }); setItems(r?.items || []); setRemaining(r?.remaining ?? null); } catch (e) { setMsg(String((e as Error).message)); }
    setBusy(false);
  };
  const label = async (it: any, role: string) => {
    setBusy(true);
    try {
      const r = await call("label", { person_id: it.person_id, episode_id: it.episode_id, label_role: role });
      if (r?.ok) { setItems((prev) => prev.filter((x) => x !== it)); setMsg(`Mentve: ${it.person?.name} → ${role}. Kapu: ${r.gate?.status}`); load(); }
      else setMsg(`Hiba: ${r?.error}`);
    } catch (e) { setMsg(String((e as Error).message)); }
    setBusy(false);
  };

  if (!s) return <div className="text-sm text-muted-foreground">{msg || "Állapot betöltése…"}</div>;
  const b = s.budget;
  const totalPairs: number = (Object.values(s.pairs || {}) as unknown[]).reduce<number>((n, v) => n + Number(v), 0);
  const gate = s.gate;
  const perModel: any[] = gate?.metrics?.per_model || [];

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold">Bizonyítékcsomagos újraellenőrzés (árnyék-próba)</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Egyedi személy–epizód párok szerint. A próba eredményei nem változtatnak nyilvános személykapcsolatot; a tömeges folytatás csak sikeres minőségi kapu után nyílhat.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-3">
        <div className="p-4 rounded-lg border border-border bg-card">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Párok ({totalPairs.toLocaleString("hu-HU")})</div>
          <ul className="text-sm mt-1 space-y-0.5">
            {Object.entries(s.pairs || {}).sort((a: any, b: any) => b[1] - a[1]).map(([k, v]) => (
              <li key={k} className="flex justify-between gap-2"><span>{PAIR_LABELS[k] || k}</span><span className="tabular-nums">{Number(v).toLocaleString("hu-HU")}</span></li>
            ))}
          </ul>
          <ul className="text-xs text-muted-foreground mt-2 space-y-0.5">
            {(s.pair_reasons || []).filter((r: any) => REASON_LABELS[r.reason]).map((r: any) => (
              <li key={`${r.disposition}:${r.reason}`} className="flex justify-between gap-2"><span>{REASON_LABELS[r.reason]}</span><span className="tabular-nums">{Number(r.n).toLocaleString("hu-HU")}</span></li>
            ))}
          </ul>
          <div className="text-xs text-muted-foreground mt-2">Elfogadott párban maradt ismétlődő szerepsor (nem kézi munka): {Number(s.superseded_duplicate_rows || 0).toLocaleString("hu-HU")}</div>
          <div className="text-xs text-muted-foreground">Besorolás utolsó futása: {s.classifier?.last_run_at ? new Date(s.classifier.last_run_at).toLocaleString("hu-HU") : "–"} · teljes körök: {s.classifier?.passes_completed ?? 0}</div>
        </div>
        <div className="p-4 rounded-lg border border-border bg-card">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Külső AI-keret (OpenAI)</div>
          {b ? (
            <div className="text-sm mt-1 space-y-0.5">
              <div>Új eljárás: {usd(b.committed_new_usd)} / {usd(b.total_cap_usd)} · próba: {usd(b.committed_pilot_usd)} / {usd(b.pilot_cap_usd)}</div>
              <div>Régi jóváhagyás maradéka: {usd(b.committed_legacy_usd)} / {usd(b.legacy_cap_usd)}</div>
              <div>Összes lekötött (régi nyitott kötegekkel): {usd(b.committed_all_usd)} / {usd(b.account_ceiling_usd)}</div>
              <div>Ma: {usd(b.today_usd)} / {usd(b.daily_cap_usd)} · lejár: {new Date(b.expires_at).toLocaleDateString("hu-HU")}</div>
              <div className="text-xs text-muted-foreground">Az egyenleg a tulajdonos által közölt érték, API-n nem ellenőrizhető.</div>
            </div>
          ) : <div className="text-sm mt-1">Nincs aktív keret — minden új külső AI-költés tiltva.</div>}
        </div>
        <div className="p-4 rounded-lg border border-border bg-card">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Minőségi kapu</div>
          <div className="text-lg font-semibold mt-1">{gate?.status || "még nincs mérés"}</div>
          {perModel.map((m) => (
            <div key={m.model} className="text-xs text-muted-foreground">
              {m.model}: {m.answered} válasz · auto-jelölt {m.auto_accept} · emberi referencia {m.references_in_auto} · pontosság {m.precision == null ? "–" : `${(m.precision * 100).toFixed(1)}%`} · kritikus {m.critical} · lezárási arány {(m.closure_rate * 100).toFixed(0)}% · {usd(m.cost_usd, 3)}
            </div>
          ))}
          <div className="text-xs text-muted-foreground mt-1">Emberi referencia: {s.references} új + {s.goldens} régi arany címke. Elfogadáshoz ≥100 referencia az automatikus osztályban, ≥99% pontosság, 0 kritikus hiba.</div>
          <div className="text-xs text-muted-foreground">Régi második kör: {s.legacy_controls?.escalation_enabled ? "fut" : "szünetel"}</div>
        </div>
      </div>

      {(s.evidence_jobs || []).length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="min-w-full text-xs">
            <thead className="bg-secondary text-muted-foreground"><tr>{["létrehozva", "sáv", "modell", "állapot", "kérés", "foglalt", "tényleges", "OpenAI köteg"].map((h) => <th key={h} className="text-left p-2">{h}</th>)}</tr></thead>
            <tbody>{s.evidence_jobs.map((j: any) => (
              <tr key={j.id} className="border-t border-border"><td className="p-2">{new Date(j.created_at).toLocaleString("hu-HU")}</td><td className="p-2">{j.lane}</td><td className="p-2">{j.model}</td>
                <td className="p-2">{j.status}</td><td className="p-2">{j.request_count}</td><td className="p-2">{usd(j.reserved_cost_usd, 4)}</td><td className="p-2">{usd(j.actual_cost_usd, 4)}</td><td className="p-2">{j.openai_batch_id || j.last_error || ""}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )}

      <div className="p-4 rounded-lg border border-border bg-card space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-medium">Emberi referencia címkézése</div>
          <button disabled={busy} onClick={loadSample} className="px-3 py-1.5 rounded-md border border-border text-sm">Minta betöltése</button>
          <button disabled={busy} onClick={load} className="px-3 py-1.5 rounded-md border border-border text-sm">Frissítés</button>
          {remaining != null && <span className="text-xs text-muted-foreground">Címkézetlen próbapár: {remaining}</span>}
        </div>
        <p className="text-xs text-muted-foreground">Az AI válaszát szándékosan nem mutatjuk, hogy ne befolyásolja a döntést. Csak a látható forrásrészletek alapján dönts.</p>
        {msg && <div className="text-sm text-muted-foreground">{msg}</div>}
        {items.map((it) => (
          <div key={`${it.person_id}:${it.episode_id}`} className="p-3 rounded-md border border-border">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-semibold">{it.person?.name}</span>
              {it.person?.disambiguation_label && <span className="text-xs text-muted-foreground">({it.person.disambiguation_label})</span>}
              {it.identity_risk && <span className="text-[10px] px-1.5 py-0.5 rounded border border-border">azonos nevű / kétértelmű</span>}
              <span className="text-[10px] px-1.5 py-0.5 rounded border border-border">{it.stratum}</span>
            </div>
            <div className="text-sm">{it.episode?.title} <span className="text-muted-foreground">· {it.podcast?.title} · {it.episode?.published || ""}</span></div>
            <ul className="mt-2 space-y-1">
              {(it.windows || []).map((w: any) => <li key={w.id} className="text-xs"><span className="text-muted-foreground">{w.id} · {w.source}:</span> {w.text}</li>)}
            </ul>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {ROLE_BUTTONS.map(([role, text]) => (
                <button key={role} disabled={busy} onClick={() => label(it, role)} className="px-2 py-1 rounded-md border border-border text-xs hover:border-primary/60">{text}</button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
