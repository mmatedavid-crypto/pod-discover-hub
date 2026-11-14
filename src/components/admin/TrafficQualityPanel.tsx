import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Day = {
  day: string; utc_start: string; utc_end: string; partial: boolean;
  raw_rows: number; duplicate_rows: number; views_all: number; views_bot: number; views_human: number; views_with_dwell: number;
  sessions_all: number; sessions_bot: number; sessions_human: number;
  landings_human_google: number; landings_human_external: number; landings_human_no_referrer: number;
  play_start_sessions: number; play_25_sessions: number; playback_error_sessions: number; play_seek_raw: number;
  search_sessions_human: number; search_to_play_sessions: number;
  gsc_clicks: number | null; gsc_impressions: number | null; gsc_state: "final" | "partial" | "missing";
};
type Report = {
  generated_at: string; from_utc: string; to_utc: string;
  gsc_latest_final: string | null; gsc_latest_any: string | null; gsc_last_fetch: string | null;
  days: Day[];
};

const n = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("hu-HU"));
const sum = (days: Day[], k: keyof Day) => days.reduce((a, d) => a + (Number(d[k]) || 0), 0);

/**
 * One definition for every day (server-side, Budapest calendar days, explicit UTC bounds):
 * duplicate copies removed, recognised bots shown separately, Search Console kept as its own measure.
 */
export function TrafficQualityPanel() {
  const [days, setDays] = useState<14 | 28 | 56>(14);
  const [rep, setRep] = useState<Report | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    supabase.rpc("get_traffic_quality_v1", { p_days: days }).then(({ data, error }) => {
      if (!alive) return;
      if (error) setErr(error.message);
      else setRep(data as unknown as Report);
    });
    return () => { alive = false; };
  }, [days]);

  const complete = useMemo(() => (rep?.days || []).filter((d) => !d.partial), [rep]);
  const gscFinal = useMemo(() => complete.filter((d) => d.gsc_state === "final"), [complete]);

  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-semibold">Forgalom egységes definícióval</h2>
          <p className="text-xs text-muted-foreground">
            Budapesti naptári napok (pontos UTC-határ a sor fölött). A ma még tart, ezért az összesítő csak a lezárt napokat adja össze.
            Ugyanabban a látogatásban 5 mp-en belül ismételt azonos oldalbetöltés duplikátum, nem számít.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {([14, 28, 56] as const).map((d) => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-full border ${days === d ? "bg-foreground text-background border-foreground" : "bg-card border-border"}`}>
              {d} nap
            </button>
          ))}
        </div>
      </div>

      {err && <div className="text-sm text-destructive">Hiba: {err}</div>}
      {!rep && !err && <div className="text-sm text-muted-foreground">Betöltés…</div>}

      {rep && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <Box label="Oldalmegtekintés – összes" v={n(sum(complete, "views_all"))} hint={`+${n(sum(complete, "duplicate_rows"))} duplikált sor kiszűrve`} />
            <Box label="ebből felismert bot" v={n(sum(complete, "views_bot"))} hint="csak a böngészőjel alapján; külföldi ≠ bot" />
            <Box label="Látogatás (ember)" v={n(sum(complete, "sessions_human"))} hint={`összes látogatás: ${n(sum(complete, "sessions_all"))}`} />
            <Box label="Google-ról érkezett látogatás" v={n(sum(complete, "landings_human_google"))} hint="első oldal hivatkozója google.*" />
            <Box label="Search Console kattintás" v={n(sum(gscFinal, "gsc_clicks"))} hint={`${gscFinal.length}/${complete.length} lezárt nap végleges GSC-adattal`} />
            <Box label="Lejátszást indító látogatás" v={n(sum(complete, "play_start_sessions"))} hint={`25%-ig jutott: ${n(sum(complete, "play_25_sessions"))}`} />
            <Box label="Lejátszási hibás látogatás" v={n(sum(complete, "playback_error_sessions"))} hint="valódi forráshiba; tiltott automatikus indítás külön" />
            <Box label="Keresésből indult hallgatás" v={n(sum(complete, "search_to_play_sessions"))} hint={`kereső látogatás: ${n(sum(complete, "search_sessions_human"))}`} />
          </div>
          <p className="text-xs text-muted-foreground">
            A Search Console-kattintás és a látogatás két külön mérőszám: a Google a saját (csendes-óceáni idő szerinti) napjain számol,
            nem lát letiltott/sütimentes különbségeket, egy látogatás több kattintásból is jöhet. Ne vond ki egymásból.
            Search Console: utolsó végleges nap {rep.gsc_latest_final ?? "—"}, legutóbbi (részleges) nap {rep.gsc_latest_any ?? "—"},
            letöltve {rep.gsc_last_fetch ? new Date(rep.gsc_last_fetch).toLocaleString("hu-HU") : "—"}.
            Az időtartam (dwell) mérése 2026. nov. 14-ig nem működött; a régi sorokban üres, ez hiány, nem 0 mp.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="p-1.5">Nap (Budapest)</th>
                  <th className="p-1.5 text-right">Nézet</th>
                  <th className="p-1.5 text-right">Bot</th>
                  <th className="p-1.5 text-right">Dupl.</th>
                  <th className="p-1.5 text-right">Látogatás (ember)</th>
                  <th className="p-1.5 text-right">Google-érkezés</th>
                  <th className="p-1.5 text-right">GSC katt.</th>
                  <th className="p-1.5 text-right">Lejátszás</th>
                  <th className="p-1.5 text-right">Hiba</th>
                  <th className="p-1.5 text-right">Keresés→hallgatás</th>
                </tr>
              </thead>
              <tbody>
                {[...rep.days].reverse().map((d) => (
                  <tr key={d.day} className="border-t border-border/60" title={`UTC ${d.utc_start} – ${d.utc_end}`}>
                    <td className="p-1.5">{d.day}{d.partial ? " (folyamatban)" : ""}</td>
                    <td className="p-1.5 text-right">{n(d.views_all)}</td>
                    <td className="p-1.5 text-right">{n(d.views_bot)}</td>
                    <td className="p-1.5 text-right text-muted-foreground">{n(d.duplicate_rows)}</td>
                    <td className="p-1.5 text-right">{n(d.sessions_human)}</td>
                    <td className="p-1.5 text-right">{n(d.landings_human_google)}</td>
                    <td className="p-1.5 text-right">
                      {d.gsc_state === "missing" ? <span className="text-muted-foreground">nincs még</span>
                        : <>{n(d.gsc_clicks)}{d.gsc_state === "partial" ? <span className="text-muted-foreground"> (részleges)</span> : null}</>}
                    </td>
                    <td className="p-1.5 text-right">{n(d.play_start_sessions)}</td>
                    <td className="p-1.5 text-right">{n(d.playback_error_sessions)}</td>
                    <td className="p-1.5 text-right">{n(d.search_to_play_sessions)}/{n(d.search_sessions_human)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function Box({ label, v, hint }: { label: string; v: string; hint?: string }) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <div className="text-[11px] text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{v}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}
