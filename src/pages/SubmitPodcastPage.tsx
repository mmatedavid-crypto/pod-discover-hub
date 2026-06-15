import Layout from "@/components/Layout";
import { useEffect, useState } from "react";
import { setSeo } from "@/lib/seo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Loader2, CheckCircle2, AlertCircle, Rss } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; message: string; detected?: { title?: string; language?: string | null; author?: string | null } }
  | { kind: "exists"; message: string; podcast?: { slug?: string; title?: string } }
  | { kind: "error"; message: string };

export default function SubmitPodcastPage() {
  const [rssUrl, setRssUrl] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });

  useEffect(() => {
    setSeo({
      title: "Podcast beküldése — Podiverzum",
      description:
        "Küldd be a saját vagy kedvenc magyar podcasted RSS feedjét — pár órán belül felkerül a Podiverzumra, AI-feldolgozással és kereshetően.",
    });
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!rssUrl.trim()) return;
    setState({ kind: "loading" });
    try {
      const { data, error } = await supabase.functions.invoke("submit-podcast", {
        body: {
          rss_url: rssUrl.trim(),
          submitter_email: email.trim() || undefined,
          submitter_note: note.trim() || undefined,
        },
      });
      if (error) {
        setState({ kind: "error", message: error.message || "Ismeretlen hiba." });
        return;
      }
      if (data?.status === "submitted") {
        setState({ kind: "ok", message: data.message, detected: data.detected });
        setRssUrl("");
        setNote("");
      } else if (data?.status === "already_indexed") {
        setState({ kind: "exists", message: data.message, podcast: data.podcast });
      } else if (data?.status === "already_submitted") {
        setState({ kind: "exists", message: data.message });
      } else {
        setState({ kind: "error", message: data?.message || data?.error || "Ismeretlen válasz." });
      }
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }

  const loading = state.kind === "loading";

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Podcast beküldése</div>
        <h1 className="text-3xl font-semibold mb-3">Kerüljön fel a podcasted a Podiverzumra</h1>
        <p className="text-muted-foreground">
          Add meg a podcast RSS feed URL-jét. Ellenőrizzük, hogy érvényes-e, majd a normál pipeline pár órán belül
          hidratálja, kategorizálja, kereshetővé teszi és berakja a magyar listákba.
        </p>

        <form onSubmit={onSubmit} className="mt-8 space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 sm:p-6">
          <div className="space-y-1.5">
            <Label htmlFor="rss" className="text-sm font-medium flex items-center gap-1.5">
              <Rss className="h-3.5 w-3.5" /> RSS feed URL <span className="text-destructive">*</span>
            </Label>
            <Input
              id="rss"
              type="url"
              required
              placeholder="https://example.com/feed.xml"
              value={rssUrl}
              onChange={(e) => setRssUrl(e.target.value)}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">
              Spotify for Creators, Acast, Buzzsprout, Captivate, Substack — bárhol hosztolod, az RSS link kell.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email" className="text-sm font-medium">
              E-mail (opcionális)
            </Label>
            <Input
              id="email"
              type="email"
              placeholder="te@email.hu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
            />
            <p className="text-xs text-muted-foreground">Ha visszajelzést kérsz a feldolgozásról.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="note" className="text-sm font-medium">
              Megjegyzés (opcionális)
            </Label>
            <Textarea
              id="note"
              placeholder="Bármi, amit jó tudnunk — pl. új epizód érkezik, kategória stb."
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={loading}
              rows={3}
              maxLength={1000}
            />
          </div>

          <Button type="submit" disabled={loading || !rssUrl.trim()} className="w-full sm:w-auto">
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Ellenőrzés…
              </>
            ) : (
              "Beküldés"
            )}
          </Button>

          {state.kind === "ok" && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{state.message}</div>
                  {state.detected?.title && (
                    <div className="text-muted-foreground mt-1">
                      Felismert cím: <strong>{state.detected.title}</strong>
                      {state.detected.language ? ` · ${state.detected.language}` : ""}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {state.kind === "exists" && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">{state.message}</div>
                  {state.podcast?.slug && (
                    <a href={`/podcast/${state.podcast.slug}`} className="text-primary hover:underline">
                      Megnézem: {state.podcast.title}
                    </a>
                  )}
                </div>
              </div>
            </div>
          )}

          {state.kind === "error" && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <div className="font-medium">Nem sikerült beküldeni</div>
                  <div className="text-muted-foreground mt-0.5">{state.message}</div>
                </div>
              </div>
            </div>
          )}
        </form>

        <div className="mt-8 text-sm text-muted-foreground space-y-2">
          <p>
            <strong className="text-foreground">Mi történik a beküldés után?</strong> A feed bekerül a discovery
            sorba, a rendszer letölti az epizódokat, AI-vel kategorizálja, magyar nyelvi ellenőrzést fut, és
            megjelenik a kereshető listákban. Általában néhány óra.
          </p>
          <p>
            Csak <strong className="text-foreground">magyar nyelvű</strong> podcastokat indexelünk a publikus oldalon.
            Idegen nyelvű feed beérkezik, de nem jelenik meg.
          </p>
        </div>
      </article>
    </Layout>
  );
}
