import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type SourceRow = {
  source: string;
  sessions: number;
  pages_per_session: number;
  bounce_pct: number;
  play_sessions: number;
  episode_landings: number;
  podcast_landings: number;
};
type Payload = {
  days: number;
  all_sessions: number;
  google_sessions: number;
  sources: SourceRow[];
  weekly: { week: string; source: string; sessions: number }[];
  landings: { path: string; sources: string; sessions: number; play_sessions: number }[];
};

/** AI-asszisztensekből (ChatGPT, Gemini, Perplexity…) érkező humán sessionök,
 *  szerveroldali aggregálással (nem a kliens 10k-s mintájából). */
export function AiReferralPanel() {
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    supabase.rpc("get_ai_referral_stats_v1" as never, { p_days: days } as never).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setErr(error.message);
      else setData(data as unknown as Payload);
    });
    return () => { cancelled = true; };
  }, [days]);

  const totalAi = (data?.sources || []).reduce((a, s) => a + s.sessions, 0);
  const weeks = Array.from(new Set((data?.weekly || []).map((w) => w.week))).sort();
  const srcs = Array.from(new Set((data?.weekly || []).map((w) => w.source)));
  const cell = (wk: string, s: string) => data?.weekly.find((w) => w.week === wk && w.source === s)?.sessions ?? 0;

  return (
    <section className="rounded-xl border border-border bg-card p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold">AI-asszisztensekből érkező látogatók</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-2xl">
            Első oldalmegtekintés forrása szerint (hivatkozó oldal vagy utm_source). A Gemini és több AI-app
            gyakran nem ad át forrást, ezért ők alulmértek – a „direkt” forgalom egy része is innen jöhet.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {([7, 30, 90] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-full border ${days === d ? "bg-foreground text-background border-foreground" : "bg-card border-border"}`}
            >
              {d} nap
            </button>
          ))}
        </div>
      </div>

      {err && <p className="text-sm text-destructive">Hiba: {err}</p>}
      {!data && !err && <p className="text-sm text-muted-foreground">Betöltés…</p>}

      {data && (
        <>
          <p className="text-sm">
            <strong>{totalAi.toLocaleString("hu-HU")}</strong> AI-ból érkező session az összes{" "}
            {data.all_sessions.toLocaleString("hu-HU")}-ből (Google: {data.google_sessions.toLocaleString("hu-HU")}).
          </p>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-secondary text-xs">
                <tr>
                  <th className="text-left px-3 py-2">Forrás</th>
                  <th className="text-right px-3 py-2">Session</th>
                  <th className="text-right px-3 py-2">Epizódra érkezett</th>
                  <th className="text-right px-3 py-2">Műsorra érkezett</th>
                  <th className="text-right px-3 py-2">Oldal / session</th>
                  <th className="text-right px-3 py-2">Visszafordulás</th>
                  <th className="text-right px-3 py-2">Lejátszást indított</th>
                </tr>
              </thead>
              <tbody>
                {data.sources.map((s) => (
                  <tr key={s.source} className="border-t border-border">
                    <td className="px-3 py-2 font-medium">{s.source}</td>
                    <td className="px-3 py-2 text-right">{s.sessions}</td>
                    <td className="px-3 py-2 text-right">{s.episode_landings}</td>
                    <td className="px-3 py-2 text-right">{s.podcast_landings}</td>
                    <td className="px-3 py-2 text-right">{s.pages_per_session}</td>
                    <td className="px-3 py-2 text-right">{s.bounce_pct}%</td>
                    <td className="px-3 py-2 text-right">
                      {s.play_sessions} ({s.sessions ? Math.round((100 * s.play_sessions) / s.sessions) : 0}%)
                    </td>
                  </tr>
                ))}
                {!data.sources.length && (
                  <tr><td colSpan={7} className="px-3 py-3 text-muted-foreground">Nincs adat.</td></tr>
                )}
              </tbody>
            </table>
          </div>

          {weeks.length > 0 && (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">Hét</th>
                    {srcs.map((s) => <th key={s} className="text-right px-3 py-2">{s}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((wk) => (
                    <tr key={wk} className="border-t border-border">
                      <td className="px-3 py-2">{wk}</td>
                      {srcs.map((s) => <td key={s} className="px-3 py-2 text-right">{cell(wk, s)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold mb-1">Leggyakoribb érkezési oldalak AI-ból</h3>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-secondary text-xs">
                  <tr>
                    <th className="text-left px-3 py-2">Oldal</th>
                    <th className="text-left px-3 py-2">Forrás</th>
                    <th className="text-right px-3 py-2">Session</th>
                    <th className="text-right px-3 py-2">Lejátszás</th>
                  </tr>
                </thead>
                <tbody>
                  {data.landings.map((l) => (
                    <tr key={l.path} className="border-t border-border">
                      <td className="px-3 py-2 break-all">
                        <a href={l.path} className="hover:underline">{l.path}</a>
                      </td>
                      <td className="px-3 py-2">{l.sources}</td>
                      <td className="px-3 py-2 text-right">{l.sessions}</td>
                      <td className="px-3 py-2 text-right">{l.play_sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
