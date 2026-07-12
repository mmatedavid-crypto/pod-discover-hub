import { useEffect, useState } from "react";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { useNoindex } from "@/lib/useNoindex";
import { Button } from "@/components/ui/button";

type Run = {
  at: string;
  wp_new: boolean;
  rss_refetched: boolean;
  episode_new: boolean;
  pinged: boolean;
  episode_slug?: string;
  error?: string;
  detail?: string;
};

type State = {
  last_wp_post_id?: number;
  last_wp_date_gmt?: string;
  last_pinged_episode_id?: string;
  last_pinged_episode_slug?: string;
  last_pinged_at?: string;
  runs?: Run[];
  errors?: Array<{ at: string; error: string }>;
};

export default function AdminZarandokPollPage() {
  useNoindex("Zarandok Poll — Admin");
  const [state, setState] = useState<State | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<any>(null);

  const load = async () => {
    const { data } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", "zarandok_biblia_poll_state")
      .maybeSingle();
    setState((data?.value as State) || {});
  };

  useEffect(() => { load(); }, []);

  const trigger = async (opts: { dry_run?: boolean; force_rss?: boolean } = {}) => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("zarandok-biblia-poll", { body: opts });
      if (error) throw error;
      setLastResult(data);
      await load();
    } catch (e: any) {
      setLastResult({ error: e.message ?? String(e) });
    } finally {
      setBusy(false);
    }
  };

  const runs = (state?.runs || []).slice().reverse();

  return (
    <Layout>
      <div className="container mx-auto py-8 max-w-4xl space-y-6">
        <header>
          <h1 className="text-2xl font-semibold">Zarándok Biblia Poll</h1>
          <p className="text-sm text-muted-foreground mt-1">
            zarandok.ma WP REST API percenkénti figyelése éjféli burst-ablakban,
            azonnali RSS re-fetch + Google/Bing ping az új napi biblia epizódra.
          </p>
        </header>

        <section className="rounded-lg border border-border bg-card p-4 space-y-2">
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground">Utolsó állapot</h2>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Utolsó látott WP post</div>
            <div className="font-mono">
              #{state?.last_wp_post_id ?? "—"} · {state?.last_wp_date_gmt ?? "—"}
            </div>
            <div>Utolsó bepingelt episode slug</div>
            <div className="font-mono truncate">{state?.last_pinged_episode_slug ?? "—"}</div>
            <div>Utolsó ping</div>
            <div className="font-mono">{state?.last_pinged_at ?? "—"}</div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={() => trigger({ dry_run: true })} disabled={busy}>
              Dry-run
            </Button>
            <Button size="sm" onClick={() => trigger()} disabled={busy}>
              Run now
            </Button>
            <Button size="sm" variant="secondary" onClick={() => trigger({ force_rss: true })} disabled={busy}>
              Force RSS + ping
            </Button>
          </div>
          {lastResult && (
            <pre className="text-xs bg-secondary/40 p-2 rounded mt-2 overflow-x-auto">
              {JSON.stringify(lastResult, null, 2)}
            </pre>
          )}
        </section>

        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="text-sm uppercase tracking-wider text-muted-foreground mb-3">Utolsó futások</h2>
          <div className="space-y-1 text-xs font-mono">
            {runs.length === 0 && <div className="text-muted-foreground">Nincs futás rögzítve.</div>}
            {runs.map((r, i) => (
              <div key={i} className="flex flex-wrap gap-2 border-b border-border/40 py-1">
                <span className="text-muted-foreground">{r.at}</span>
                {r.wp_new && <span className="px-1 rounded bg-brand/15 text-brand">wp-new</span>}
                {r.rss_refetched && <span className="px-1 rounded bg-secondary">rss</span>}
                {r.episode_new && <span className="px-1 rounded bg-brand/15 text-brand">ep-new</span>}
                {r.pinged && <span className="px-1 rounded bg-green-500/15 text-green-400">pinged</span>}
                {r.error && <span className="px-1 rounded bg-destructive/15 text-destructive">{r.error}</span>}
                {r.detail && <span className="text-muted-foreground">{r.detail}</span>}
                {r.episode_slug && <span className="text-muted-foreground">→ {r.episode_slug}</span>}
              </div>
            ))}
          </div>
        </section>

        {state?.errors && state.errors.length > 0 && (
          <section className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
            <h2 className="text-sm uppercase tracking-wider text-destructive mb-2">Hibák</h2>
            <div className="space-y-1 text-xs font-mono">
              {state.errors.slice().reverse().map((e, i) => (
                <div key={i}><span className="text-muted-foreground">{e.at}</span> {e.error}</div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}
