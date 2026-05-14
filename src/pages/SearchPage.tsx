import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { PodcastCard, PodcastLite } from "@/components/PodcastCard";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import { Search } from "lucide-react";
import { setSeo } from "@/lib/seo";
import { searchEpisodes, parseQuery, normalizeQuery, MATCH_LABEL } from "@/lib/search";
import { episodeScore } from "@/lib/episodeRank";
import { pushRecentSearch } from "@/lib/recentSearches";

type SortKey = "best" | "newest" | "rank";

const EXAMPLES = [
  "MNB kamatdöntés",
  "magyar tőzsde",
  "Hold Alapkezelő",
  "mesterséges intelligencia",
  "magyar gazdaság",
];

function escapeIlike(s: string) { return s.replace(/[%,_]/g, " ").replace(/[(),]/g, " "); }

function scorePodcast(p: any, terms: string[]): number {
  let s = 0;
  const title = (p.title || "").toLowerCase();
  const summary = (p.summary || "").toLowerCase();
  const desc = (p.description || "").toLowerCase();
  const cat = (p.category || "").toLowerCase();
  terms.forEach((term) => {
    const t = term.toLowerCase();
    if (title === t) s += 50;
    if (title.includes(t)) s += 25;
    if (cat.includes(t)) s += 8;
    if (summary.includes(t)) s += 6;
    if (desc.includes(t)) s += 3;
  });
  return s;
}

export default function SearchPage() {
  const [params, setParams] = useSearchParams();
  const initial = params.get("q") || "";
  const sortParam = (params.get("sort") as SortKey) || "best";
  const catParam = params.get("cat") || "";
  const [q, setQ] = useState(initial);
  const [podcasts, setPodcasts] = useState<PodcastLite[]>([]);
  const [episodes, setEpisodes] = useState<EpisodeLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [categories, setCategories] = useState<string[]>([]);
  const [broadened, setBroadened] = useState(false);
  const [semanticUsed, setSemanticUsed] = useState(false);
  const [suggestion, setSuggestion] = useState<string>("");
  const [aiAnswer, setAiAnswer] = useState<string>("");
  const [aiAnswerLoading, setAiAnswerLoading] = useState(false);
  const lastLoggedRef = useRef<string>("");
  const answerAbortRef = useRef<AbortController | null>(null);

  useEffect(() => { setQ(initial); }, [initial]);

  useEffect(() => {
    setSeo({
      title: initial ? `${initial} – Podiverzum keresés` : "Keresés magyar podcastok között – Podiverzum",
      description: initial
        ? `Podcast epizódok ehhez a kereséshez: „${initial}”. Keress téma, név, cég vagy ötlet alapján.`
        : "Keress magyar podcast epizódok között téma, név, cég vagy ötlet alapján.",
      noindex: !initial,
    });
    setBroadened(false);
    setSemanticUsed(false);
    setSuggestion("");
    setAiAnswer("");
    answerAbortRef.current?.abort();
    if (!initial) { setPodcasts([]); setEpisodes([]); setAiAnswerLoading(false); return; }
    pushRecentSearch(initial);

    setLoading(true);
    let cancelled = false;
    (async () => {
      let mapped: EpisodeLite[] = [];
      let usedFallback = false;
      let semantic = false;
      let reranked = false;

      const applyHybridResponse = (data: any) => {
        let eps = (data?.episodes || []) as any[];
        if (catParam) eps = eps.filter((e) => (e.podcasts?.category || "") === catParam);
        if (sortParam === "newest") {
          eps.sort((a, b) => new Date(b.published_at || 0).getTime() - new Date(a.published_at || 0).getTime());
        } else if (sortParam === "rank") {
          eps.sort((a, b) => episodeScore(b) - episodeScore(a));
        }
        const next = eps.slice(0, 80).map((e) => ({ ...e, matchBadge: e.why_matched ? null : "Kulcsszavas találat", why_matched: e.why_matched || null }));
        setCategories(Array.from(new Set(eps.map((e) => e.podcasts?.category).filter(Boolean) as string[])));
        return { mapped: next, semantic: !!data?.semantic, reranked: !!data?.reranked };
      };

      // Search v2: hybrid lexical + semantic. Two-phase for fast first paint:
      //   Phase 1: rerank=false → ~1.5-2s, render results.
      //   Phase 2: rerank=true → cache hit instant, else ~3.5s, merge why_matched chips.
      try {
        const phase1 = await supabase.functions.invoke("search-hybrid", {
          body: { q: initial, limit: 80, rerank: false, lang: "hu" },
        });
        if (phase1.error) throw phase1.error;
        if (cancelled) return;
        const r1 = applyHybridResponse(phase1.data);
        mapped = r1.mapped;
        semantic = r1.semantic;
        setEpisodes(mapped);
        setSemanticUsed(semantic);
        setLoading(false);

        // Phase 2: rerank (with cache). Fire-and-forget update.
        supabase.functions.invoke("search-hybrid", {
          body: { q: initial, limit: 80, rerank: true, lang: "hu" },
        }).then(({ data: data2, error: err2 }) => {
          if (cancelled || err2 || !data2) return;
          const r2 = applyHybridResponse(data2);
          mapped = r2.mapped;
          reranked = r2.reranked;
          setEpisodes(mapped);
          setSemanticUsed(r2.semantic || r2.reranked);
        }, () => { /* ignore */ });
      } catch (err) {
        if (cancelled) return;
        console.warn("search-hybrid failed, falling back to legacy", err);
        usedFallback = true;
        const result = await searchEpisodes({ rawQuery: initial, scope: "all", limit: 80 });
        if (cancelled) return;
        if (result.suggestion && result.suggestion.toLowerCase() !== initial.toLowerCase()) setSuggestion(result.suggestion);
        let chosen = result.all;
        if (catParam) chosen = chosen.filter((x) => (x.e.podcasts?.category || "") === catParam);
        const ranked =
          sortParam === "newest"
            ? chosen.slice().sort((a: any, b: any) => new Date(b.e.published_at || 0).getTime() - new Date(a.e.published_at || 0).getTime()).slice(0, 80)
            : sortParam === "rank"
            ? chosen.slice().sort((a: any, b: any) => episodeScore(b.e) - episodeScore(a.e)).slice(0, 80)
            : chosen.slice(0, 80);
        mapped = ranked.map((x) => ({ ...x.e, matchBadge: MATCH_LABEL[x.matchType] || "Kulcsszavas találat" }));
        semantic = result.semanticUsed;
        usedFallback = result.fallbackUsed || usedFallback;
        setCategories(Array.from(new Set(ranked.map((x) => x.e.podcasts?.category).filter(Boolean) as string[])));
        setEpisodes(mapped);
        setSemanticUsed(semantic);
        setLoading(false);
      }

      setBroadened(usedFallback);

      if (lastLoggedRef.current !== initial) {
        lastLoggedRef.current = initial;
        const { data: sess } = await supabase.auth.getSession();
        const { terms } = parseQuery(normalizeQuery(initial).normalized || initial);
        supabase.from("search_events").insert({
          query: initial.slice(0, 200),
          terms_count: terms.length,
          result_count: mapped.length,
          fallback_used: usedFallback,
          viewport_width: typeof window !== "undefined" ? window.innerWidth : null,
          user_id: sess.session?.user.id || null,
        }).then(() => {}, () => {});
      }

      // Podcasts query (separate, simpler).
      const { terms } = parseQuery(normalizeQuery(initial).normalized || initial);
      let pq = supabase
        .from("podcasts")
        .select("id,title,display_title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status,podiverzum_rank")
        .limit(60);
      terms.forEach((t) => {
        const v = `%${escapeIlike(t)}%`;
        pq = pq.or([`title.ilike.${v}`, `description.ilike.${v}`, `summary.ilike.${v}`, `category.ilike.${v}`].join(","));
      });
      const { data: ps } = await pq;
      const visiblePs = (ps || []).filter((p: any) => p.featured || (p.rss_status !== "failed" && p.rss_status !== "inactive"));
      const rankedPs = visiblePs
        .map((p) => ({ p, s: scorePodcast(p, terms) + ((p.podiverzum_rank ?? 0) * 0.5) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 18)
        .map((x) => x.p);
      setPodcasts(rankedPs);

      // Kick off streaming AI answer when we have enough top results.
      if (mapped.length >= 3) {
        setAiAnswerLoading(true);
        const ctrl = new AbortController();
        answerAbortRef.current = ctrl;
        try {
          const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/search-answer`;
          const resp = await fetch(url, {
            method: "POST",
            signal: ctrl.signal,
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}` },
            body: JSON.stringify({
              q: initial,
              episodes: mapped.slice(0, 6).map((e: any) => ({
                title: e.display_title || e.title,
                podcast: e.podcasts?.title || "",
                summary: e.ai_summary || e.summary || "",
              })),
            }),
          });
          if (resp.ok && resp.body) {
            const reader = resp.body.getReader();
            const dec = new TextDecoder();
            let buf = ""; let acc = ""; let done = false;
            while (!done) {
              const { done: d, value } = await reader.read();
              if (d) break;
              buf += dec.decode(value, { stream: true });
              let nl: number;
              while ((nl = buf.indexOf("\n")) !== -1) {
                let line = buf.slice(0, nl); buf = buf.slice(nl + 1);
                if (line.endsWith("\r")) line = line.slice(0, -1);
                if (!line.startsWith("data: ")) continue;
                const js = line.slice(6).trim();
                if (js === "[DONE]") { done = true; break; }
                try {
                  const p = JSON.parse(js);
                  const c = p?.choices?.[0]?.delta?.content;
                  if (c) { acc += c; setAiAnswer(acc); }
                } catch { buf = line + "\n" + buf; break; }
              }
            }
          }
        } catch (e) {
          if ((e as any)?.name !== "AbortError") console.warn("answer stream", e);
        } finally {
          setAiAnswerLoading(false);
        }
      }
    })();
    return () => { cancelled = true; answerAbortRef.current?.abort(); };
  }, [initial, sortParam, catParam]);

  const flatTerms = useMemo(() => parseQuery(initial).terms, [initial]);

  const setSort = (s: SortKey) => {
    const next = new URLSearchParams(params);
    next.set("q", initial); next.set("sort", s);
    if (catParam) next.set("cat", catParam);
    setParams(next);
  };
  const setCat = (c: string) => {
    const next = new URLSearchParams(params);
    next.set("q", initial);
    if (sortParam) next.set("sort", sortParam);
    if (c) next.set("cat", c); else next.delete("cat");
    setParams(next);
  };

  return (
    <Layout>
      <div className="container mx-auto py-10">
        <h1 className="text-3xl font-semibold mb-2">Keresés</h1>
        <p className="text-muted-foreground mb-4 text-sm">
          Írj be egy vagy több szót, pl. <em>magyar gazdaság</em>. A <code className="px-1 bg-secondary rounded">+</code> jellel megadhatod, hogy egy szónak szerepelnie kell.
        </p>
        <form onSubmit={(e) => { e.preventDefault(); setParams({ q }); }} className="relative max-w-2xl">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="magyar gazdaság"
            className="w-full pl-10 pr-24 py-3 rounded-md bg-card border border-border focus:border-accent outline-none"
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 bg-primary text-primary-foreground px-3 py-1.5 rounded-md text-sm">
            Keresés
          </button>
        </form>

        <div className="flex flex-wrap gap-2 mt-3">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => { setQ(ex); setParams({ q: ex }); }}
              className="px-3 py-1 rounded-full bg-secondary text-xs hover:bg-accent hover:text-accent-foreground"
            >
              {ex}
            </button>
          ))}
        </div>

        {initial && (
          <div className="flex flex-wrap gap-2 items-center mt-6 text-xs">
            <span className="text-muted-foreground">Rendezés:</span>
            {([
              ["best", "Legjobb találat"],
              ["newest", "Legújabb"],
              ["rank", "Rangsor szerint"],
            ] as const).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setSort(k)}
                className={`px-2.5 py-1 rounded-full border ${sortParam === k ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:border-foreground/40"}`}
              >
                {l}
              </button>
            ))}
            {categories.length > 1 && (
              <>
                <span className="text-muted-foreground ml-2">Kategória:</span>
                <button onClick={() => setCat("")} className={`px-2.5 py-1 rounded-full border ${!catParam ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:border-foreground/40"}`}>Mind</button>
                {categories.slice(0, 8).map((c) => (
                  <button key={c} onClick={() => setCat(c)} className={`px-2.5 py-1 rounded-full border ${catParam === c ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:border-foreground/40"}`}>{c}</button>
                ))}
              </>
            )}
          </div>
        )}

        {initial && loading && (
          <div className="mt-10 p-6 border border-border rounded-lg bg-card">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" aria-hidden />
              <div className="text-sm">
                <div className="font-medium">Keresés: „{initial}”…</div>
                <div className="text-muted-foreground text-xs mt-0.5">
                  Kulcsszavas és szemantikus keresés, MI által finomított rangsorral. Általában 2–4 másodperc.
                </div>
              </div>
            </div>
            <div className="mt-4 space-y-2">
              <div className="h-14 rounded-md bg-muted/60 animate-pulse" />
              <div className="h-14 rounded-md bg-muted/40 animate-pulse" />
              <div className="h-14 rounded-md bg-muted/30 animate-pulse" />
            </div>
          </div>
        )}

        {initial && !loading && podcasts.length === 0 && episodes.length === 0 && (
          <div className="mt-10 p-6 border border-border rounded-lg bg-card text-sm text-muted-foreground">
            Nincs találat erre a keresésre.{suggestion && suggestion.toLowerCase() !== initial.toLowerCase() && (<> Esetleg erre gondoltál: <button onClick={() => { setQ(suggestion); setParams({ q: suggestion }); }} className="underline text-foreground font-medium">{suggestion}</button>?</>)} Próbálkozz más szavakkal, vagy <Link to="/kategoriak" className="underline text-foreground">böngéssz a kategóriák között</Link>.
          </div>
        )}

        {initial && !loading && (aiAnswer || aiAnswerLoading) && (
          <div className="mt-8 p-5 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">MI-összefoglaló</span>
              {aiAnswerLoading && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden />
              )}
            </div>
            <p className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
              {aiAnswer || <span className="text-muted-foreground">Összefoglaló készül a legjobb epizódok alapján…</span>}
            </p>
            <p className="text-[10px] text-muted-foreground mt-2">MI-alapú összefoglaló, amely pontatlanságokat tartalmazhat. A szövegben lévő számok a találati lista epizódjaira utalnak.</p>
          </div>
        )}

        {initial && !loading && (podcasts.length > 0 || episodes.length > 0) && (
          <div className="mt-8 space-y-10">
            <section>
              <h2 className="font-semibold mb-3 flex items-center gap-2 flex-wrap">
                Találatok ({episodes.length})
                {suggestion && suggestion.toLowerCase() !== initial.toLowerCase() && (
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                    Találatok erre: {suggestion}
                  </span>
                )}
                {semanticUsed && (
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-primary/10 border border-primary/30 text-foreground/70">
                    kapcsolódó ötletekkel
                  </span>
                )}
                {broadened && !semanticUsed && (
                  <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-secondary text-muted-foreground">
                    Tágabb találatok
                  </span>
                )}
              </h2>
              <EpisodeList items={episodes} terms={flatTerms} showEntities />
            </section>
            {podcasts.length > 0 && (
              <section>
                <h2 className="font-semibold mb-3">Kapcsolódó podcastok ({podcasts.length})</h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {podcasts.map((p) => <PodcastCard key={p.id} p={p} />)}
                </div>
              </section>
            )}
          </div>
        )}

        <p className="text-xs text-muted-foreground mt-10">
          A találatok nyilvános podcastokból származnak. A sorrendet a relevancia, a frissesség és a Podiverzum egyedi rangsorolása határozza meg.
        </p>
      </div>
    </Layout>
  );
}