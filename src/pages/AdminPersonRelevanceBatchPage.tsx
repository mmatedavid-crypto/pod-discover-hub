import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useNoindex } from "@/lib/useNoindex";
import { useAdminAccess } from "@/hooks/useAdminAccess";

type Sample = {
  person_id: string; episode_id: string; person_name: string; disambiguation_label: string | null;
  episode_title: string; podcast_title: string; excerpt: string; identity_risk: boolean; is_public_person: boolean;
  extraction: { mention_type: string; role_type: string | null; evidence: string }[];
  guard: { status: string; reason: string } | null; est_input_tokens: number; request_bytes: number;
};

const BLOCKER_LABELS: Record<string, string> = {
  controls_disabled: "A vezérlő ki van kapcsolva",
  key_rotation_not_confirmed: "Az új/rotált OpenAI kulcs nincs megerősítve",
  openai_api_key_missing: "Nincs OPENAI_API_KEY titok",
  no_authorized_pilot_budget: "Nincs jóváhagyott pilot-keret",
  cost_caps_zero: "A napi/teljes költségkeret 0",
  open_job_limit: "Már fut egy batch",
};

async function call(action: string, extra: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("person-relevance-openai-batch", { body: { action, ...extra } });
  if (error) throw error;
  return data;
}

export default function AdminPersonRelevanceBatchPage() {
  useNoindex("Személykapcsolat batch — Admin");
  const { loading: adminLoading, isAdmin } = useAdminAccess();
  const [status, setStatus] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [role, setRole] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  const pairKey = (personId: string, episodeId: string) => `${personId}:${episodeId}`;
  const labelKey = (st: string, mt: string | null) => `${st}:${mt ?? ""}`;

  const load = async () => {
    try {
      const s = await call("status");
      setStatus(s);
      const saved: Record<string, string> = {};
      for (const g of s?.goldens?.labels || []) saved[pairKey(g.person_id, g.episode_id)] = labelKey(g.label_status, g.label_mention_type);
      setLabels((prev) => ({ ...saved, ...prev }));
    } catch (e) { setMsg(String((e as Error).message)); }
  };
  useEffect(() => { if (!adminLoading && isAdmin) load(); }, [adminLoading, isAdmin]);

  const runPreview = async (offset = 0) => {
    setBusy(true); setMsg("");
    try { setPreview(await call("preview", { limit: 12, offset, role: role || null })); } catch (e) { setMsg(String((e as Error).message)); }
    setBusy(false);
  };

  const label = async (s: Sample, label_status: string, label_mention_type: string | null, text: string) => {
    const key = pairKey(s.person_id, s.episode_id);
    setSavingKey(key);
    try {
      const stratum = s.identity_risk ? "identity_risk" : (s.extraction[0]?.role_type || "unspecified");
      const r = await call("label_golden", { person_id: s.person_id, episode_id: s.episode_id, label_status, label_mention_type,
        label_identity: label_status === "accepted" ? "same_person" : null, stratum });
      if (r?.ok) {
        setLabels((prev) => ({ ...prev, [key]: labelKey(label_status, label_mention_type) }));
        setMsg(`Mentve: ${s.person_name} – ${text}`);
        load();
      } else setMsg(`Hiba: ${r?.error}`);
    } catch (e) { setMsg(String((e as Error).message)); }
    setSavingKey(null);
  };

  if (adminLoading) return <Layout><div className="container mx-auto py-20">Betöltés…</div></Layout>;
  if (!isAdmin) return <Layout><div className="container mx-auto py-20">Nincs jogosultság.</div></Layout>;

  const c = status?.controls;
  return (
    <Layout>
      <div className="container mx-auto py-8 space-y-6 max-w-6xl">
        <div>
          <h1 className="text-2xl font-semibold">Személy–epizód kapcsolatok: OpenAI Batch</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Próbafuttatás és arany minta címkézése. Fizetős batch csak jóváhagyott pilot-kerettel indulhat; ez az oldal nem indít fizetős munkát.
          </p>
        </div>

        {status && (
          <div className="grid md:grid-cols-3 gap-3">
            <div className="p-4 rounded-lg border border-border bg-card">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Állapot</div>
              <div className="text-lg font-semibold mt-1">{c?.enabled ? "Engedélyezve" : "Kikapcsolva"}</div>
              <div className="text-xs text-muted-foreground mt-1">Modell: {c?.primary_model} · eszkaláció: {c?.escalation_enabled ? c?.escalation_model : "ki"}</div>
              <div className="text-xs text-muted-foreground">Kulcs a titkok között: {status.key_present ? "igen" : "nem"}</div>
            </div>
            <div className="p-4 rounded-lg border border-border bg-card">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Keretek</div>
              <div className="text-sm mt-1">Napi: ${c?.daily_cap_usd} · teljes: ${c?.total_cap_usd}</div>
              <div className="text-sm">Pilot: {c?.authorized_pilot ? `${c.authorized_pilot.max_requests} kérés / $${c.authorized_pilot.total_cap_usd}` : "nincs jóváhagyva"}</div>
              <div className="text-xs text-muted-foreground">Függő kapcsolatsor: {status.pending_mention_rows ?? "–"}</div>
            </div>
            <div className="p-4 rounded-lg border border-border bg-card">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Arany minta</div>
              <div className="text-lg font-semibold mt-1">{status.goldens?.total ?? 0} / {status.pilot_design?.goldens?.target}</div>
              <div className="text-xs text-muted-foreground">{Object.entries(status.goldens?.by_stratum || {}).map(([k, v]) => `${k}: ${v}`).join(" · ") || "még nincs címke"}</div>
            </div>
          </div>
        )}

        {status?.blockers_primary?.length > 0 && (
          <div className="p-4 rounded-lg border border-border bg-card">
            <div className="text-sm font-medium">Indítás előtti feltételek</div>
            <ul className="text-sm text-muted-foreground list-disc pl-5 mt-1">
              {status.blockers_primary.map((b: string) => <li key={b}>{BLOCKER_LABELS[b] || b}</li>)}
            </ul>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <select value={role} onChange={(e) => setRole(e.target.value)} className="px-3 py-2 rounded-md border border-border bg-card text-sm">
            <option value="">Minden szerep</option>
            <option value="participant">Szereplő</option>
            <option value="mention">Említés</option>
            <option value="subject">Róla szól</option>
          </select>
          <button disabled={busy} onClick={() => runPreview(0)} className="px-3 py-2 rounded-md border border-border bg-card text-sm">
            Próbafuttatás (fizetés nélkül)
          </button>
          {preview && (
            <button disabled={busy} onClick={() => runPreview(Math.floor(Math.random() * 3000))} className="px-3 py-2 rounded-md border border-border bg-card text-sm">
              Másik minta
            </button>
          )}
          <button disabled={busy} onClick={load} className="px-3 py-2 rounded-md border border-border bg-card text-sm">Frissítés</button>
        </div>
        {msg && <div className="text-sm text-muted-foreground">{msg}</div>}

        {preview && (
          <div className="space-y-3">
            <div className="p-4 rounded-lg border border-border bg-card text-sm">
              <div>Minta: {preview.sample_count} pár · fizetős lenne: {preview.paid_eligible} · átlag bemenet ≈ {preview.avg_input_tokens_est} token</div>
              <div className="mt-1">Felső költségbecslés párankénti / 1 500-as pilot / teljes backlog:</div>
              <ul className="list-disc pl-5">
                {Object.entries(preview.upper_bound_cost_usd?.per_pair || {}).map(([m, v]) => (
                  <li key={m}>{m}: ${Number(v || 0).toFixed(5)} · ${Number(preview.upper_bound_cost_usd.pilot_1500[m] || 0).toFixed(2)} · ${Number(preview.upper_bound_cost_usd.backlog_227552[m] || 0).toFixed(0)}</li>
                ))}
              </ul>
              <div className="text-xs text-muted-foreground mt-1">{preview.pricing_note} OpenAI-hívás: {preview.openai_called ? "igen" : "nem"}.</div>
            </div>
            {(preview.samples as Sample[]).map((s) => (
              <div key={`${s.person_id}-${s.episode_id}`} className="p-4 rounded-lg border border-border bg-card">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="font-semibold">{s.person_name}</span>
                  {s.disambiguation_label && <span className="text-xs text-muted-foreground">({s.disambiguation_label})</span>}
                  {s.identity_risk && <span className="text-[10px] px-1.5 py-0.5 rounded border border-border">azonos nevű / kétértelmű</span>}
                  {s.guard && <span className="text-[10px] px-1.5 py-0.5 rounded border border-border">nem küldené: {s.guard.status}</span>}
                </div>
                <div className="text-sm mt-1">{s.episode_title} <span className="text-muted-foreground">· {s.podcast_title}</span></div>
                <div className="text-xs text-muted-foreground mt-1">Kinyerés: {s.extraction.map((x) => `${x.mention_type}/${x.role_type || "–"}: „${x.evidence}”`).join(" · ")}</div>
                <p className="text-xs mt-2 line-clamp-4">{s.excerpt}</p>
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {[["accepted", "guest", "Vendég"], ["accepted", "host", "Műsorvezető"], ["accepted", "subject", "Róla szól"], ["accepted", "mentioned", "Említés"],
                    ["rejected", "none", "Téves"], ["needs_review", null, "Bizonytalan"]].map(([st, mt, text]) => (
                    <button key={text as string} disabled={busy} onClick={() => label(s, st as string, mt as string | null)}
                      className="px-2 py-1 rounded-md border border-border text-xs hover:border-primary/60">{text}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {status?.jobs?.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="min-w-full text-xs">
              <thead className="bg-secondary text-muted-foreground"><tr>{["létrehozva", "szint", "állapot", "modell", "kérés", "foglalt $", "tényleges $", "hiba"].map((h) => <th key={h} className="text-left p-2">{h}</th>)}</tr></thead>
              <tbody>{status.jobs.map((j: any) => (
                <tr key={j.id} className="border-t border-border"><td className="p-2">{new Date(j.created_at).toLocaleString("hu-HU")}</td><td className="p-2">{j.tier}</td><td className="p-2">{j.status}</td>
                  <td className="p-2">{j.model}</td><td className="p-2">{j.request_count}</td><td className="p-2">{Number(j.reserved_cost_usd).toFixed(4)}</td>
                  <td className="p-2">{Number(j.actual_cost_usd).toFixed(4)}</td><td className="p-2">{j.last_error || ""}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </div>
    </Layout>
  );
}
