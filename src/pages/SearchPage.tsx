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
import { SearchStagedLoader } from "@/components/SearchStagedLoader";

type SortKey = "best" | "newest" | "rank";

const EXAMPLES = [
  "MNB kamatdöntés",
  "magyar tőzsde",
  "Hold Alapkezelő",
  "mesterséges intelligencia",
  "magyar gazdaság",
];

function escapeIlike(s: string) { return s.replace(/[%,_]/g, " ").replace(/[(),]/g, " "); }

function scorePodcast(p: any, terms: string[], fullPhrase: string): number {
  let s = 0;
  const title = (p.title || "").toLowerCase();
  const displayTitle = (p.display_title || "").toLowerCase();
  const summary = (p.summary || "").toLowerCase();
  const desc = (p.description || "").toLowerCase();
  const cat = (p.category || "").toLowerCase();
  const phrase = fullPhrase.toLowerCase().trim();
  // Full-phrase title hit: huge boost (e.g. "zsiday viktor" -> "Zsiday Viktor podcast")
  if (phrase && phrase.length >= 3) {
    if (title === phrase || displayTitle === phrase) s += 400;
    else if (title.includes(phrase) || displayTitle.includes(phrase)) s += 200;
    else if (summary.includes(phrase)) s += 30;
    else if (desc.includes(phrase)) s += 15;
  }
  terms.forEach((term) => {
    const t = term.toLowerCase();
    if (title === t) s += 50;
    if (title.includes(t)) s += 25;
    if (displayTitle.includes(t)) s += 20;
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
  const [categoryLabels, setCategoryLabels] = useState<Record<string, string>>({});
  const [heroPerson, setHeroPerson] = useState<{ name: string; slug: string; image_url: string | null; short_bio: string | null; gated_episode_count: number | null } | null>(null);
  const [broadened, setBroadened] = useState(false);
  const [semanticUsed, setSemanticUsed] = useState(false);
  const [suggestion, setSuggestion] = useState<string>("");
  const [aiAnswer, setAiAnswer] = useState<string>("");
  const [aiAnswerLoading, setAiAnswerLoading] = useState(false);
  const [piFallback, setPiFallback] = useState<{ candidates: any[]; staged: number } | null>(null);
  const [confidence, setConfidence] = useState<"high" | "medium" | "low" | null>(null);
  const lastLoggedRef = useRef<string>("");
  const answerAbortRef = useRef<AbortController | null>(null);

  useEffect(() => { setQ(initial); }, [initial]);

  // Load HU category label map (taxonomy_key -> HU name)
  useEffect(() => {
    supabase.from("categories").select("name,taxonomy_keys").then(({ data }) => {
      if (!data) return;
      const map: Record<string, string> = {};
      (data as any[]).forEach((c) => {
        (c.taxonomy_keys || []).forEach((k: string) => { if (k && !map[k]) map[k] = c.name; });
      });
      setCategoryLabels(map);
    }, () => {});
  }, []);

  // Hero person: best person match for the query
  useEffect(() => {
    setHeroPerson(null);
    const phrase = initial.trim();
    if (phrase.length < 3) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("people")
        .select("name,slug,image_url,short_bio,gated_episode_count,is_public")
        .ilike("name", `%${phrase.replace(/[%_]/g, " ")}%`)
        .eq("is_public", true)
        .order("gated_episode_count", { ascending: false, nullsFirst: false })
        .limit(5);
      if (cancelled || !data?.length) return;
      const pn = phrase.toLowerCase();
      const best = (data as any[]).find((p) => (p.name || "").toLowerCase() === pn)
        || (data as any[]).find((p) => (p.name || "").toLowerCase().includes(pn))
        || data[0];
      if (best && (best.gated_episode_count ?? 0) >= 1) setHeroPerson(best as any);
    })();
    return () => { cancelled = true; };
  }, [initial]);

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
    setPiFallback(null);
    setConfidence(null);
    answerAbortRef.current?.abort();
    if (!initial) { setPodcasts([]); setEpisodes([]); setAiAnswerLoading(false); return; }
    pushRecentSearch(initial);

    setLoading(true);
    let cancelled = false;
    (async () => {
      let mapped: EpisodeLite[] = [];
      let usedFallback = false;
      let semantic = false;

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

      // Quality-first: one hybrid call with rerank enabled. The previous 2-phase
      // pattern (rerank:false → rerank:true) caused result flicker and surfaced
      // weak results above better final ones — explicitly disallowed by policy.
      try {
        const phase1 = await supabase.functions.invoke("search-hybrid", {
          body: { q: initial, limit: 80, rerank: true, lang: "hu" },
        });
        if (phase1.error) throw phase1.error;
        if (cancelled) return;
        const r1 = applyHybridResponse(phase1.data);
        mapped = r1.mapped;
        semantic = r1.semantic;
        setEpisodes(mapped);
        setSemanticUsed(semantic || r1.reranked);
        const cb = phase1.data?.confidence_band;
        if (cb === "high" || cb === "medium" || cb === "low") setConfidence(cb);
        setLoading(false);
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

      // Podcasts query (separate, simpler). Includes full-phrase title hit.
      const { terms } = parseQuery(normalizeQuery(initial).normalized || initial);
      const fullPhrase = initial.trim();
      let pq = supabase
        .from("podcasts")
        .select("id,title,display_title,slug,summary,description,image_url,category,apple_url,spotify_url,youtube_url,website_url,featured,rss_status,podiverzum_rank")
        .limit(60);
      if (fullPhrase.length >= 3) {
        const fp = `%${escapeIlike(fullPhrase)}%`;
        pq = pq.or([`title.ilike.${fp}`, `display_title.ilike.${fp}`, `description.ilike.${fp}`, `summary.ilike.${fp}`].join(","));
      }
      terms.forEach((t) => {
        const v = `%${escapeIlike(t)}%`;
        pq = pq.or([`title.ilike.${v}`, `display_title.ilike.${v}`, `description.ilike.${v}`, `summary.ilike.${v}`, `category.ilike.${v}`].join(","));
      });
      const { data: ps } = await pq;
      const visiblePs = (ps || []).filter((p: any) => p.featured || (p.rss_status !== "failed" && p.rss_status !== "inactive"));
      const rankedPs = visiblePs
        .map((p) => ({ p, s: scorePodcast(p, terms, fullPhrase) + ((p.podiverzum_rank ?? 0) * 0.5) }))
        .filter((x) => x.s > 0)
        .sort((a, b) => b.s - a.s)
        .slice(0, 18)
        .map((x) => x.p);
      setPodcasts(rankedPs);

      // PodcastIndex live fallback: if local DB has 0 podcast title matches and the
      // query looks like a name, ask PI byterm. The fallback fn also stages best
      // matches into pi_feed_staging so the pipeline ingests them in minutes.
      const looksLikeName = fullPhrase.length >= 3 && /[a-zA-ZáéíóöőúüűÁÉÍÓÖŐÚÜŰ]/.test(fullPhrase);
      if (rankedPs.length === 0 && mapped.length === 0 && looksLikeName) {
        supabase.functions.invoke("search-pi-fallback", {
          body: { query: fullPhrase, maxStage: 5 },
        }).then(({ data, error }) => {
          if (cancelled || error || !data?.candidates?.length) return;
          setPiFallback({ candidates: data.candidates, staged: data.staged || 0 });
        }, () => { /* ignore */ });
      }

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

  // Hero podcast match: word-boundary phrase hit on title/display_title.
  const heroPodcast = useMemo(() => {
    const phrase = initial.trim().toLowerCase();
    if (phrase.length < 3 || loading) return null;
    const phraseRe = new RegExp(
      `(^|[^\\p{L}\\p{N}])${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}\\p{N}]|$)`,
      "iu"
    );
    return podcasts.find((p) => {
      const t = (p.title || "");
      const d = ((p as any).display_title || "");
      return phraseRe.test(t) || phraseRe.test(d);
    }) || null;
  }, [initial, podcasts, loading]);

  const podcastsList = heroPodcast ? podcasts.filter((p) => p.id !== heroPodcast.id) : podcasts;

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

        {!initial && (
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
        )}

        {initial && (
          <div className="mt-5 sm:mt-6 text-xs">
            {/* Mobile: compact native select */}
            <div className="sm:hidden flex items-center gap-2">
              <label htmlFor="sort-mobile" className="text-muted-foreground">Rendezés:</label>
              <select
                id="sort-mobile"
                value={sortParam}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="bg-card border border-border rounded-md px-2 py-1 text-xs focus:border-primary outline-none"
              >
                <option value="best">Relevancia</option>
                <option value="newest">Legfrissebb</option>
                <option value="rank">Időtálló</option>
              </select>
            </div>
            {/* Desktop/tablet: button group, kept as-is */}
            <div className="hidden sm:flex flex-wrap gap-2 items-center">
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
                    <button key={c} onClick={() => setCat(c)} className={`px-2.5 py-1 rounded-full border ${catParam === c ? "bg-foreground text-background border-foreground" : "bg-card border-border hover:border-foreground/40"}`}>{categoryLabels[c] || c}</button>
                  ))}
                </>
              )}
            </div>
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

        {initial && !loading && podcasts.length === 0 && episodes.length === 0 && !piFallback && (
          <div className="mt-10 p-6 border border-border rounded-lg bg-card text-sm text-muted-foreground">
            Nincs találat erre a keresésre.{suggestion && suggestion.toLowerCase() !== initial.toLowerCase() && (<> Esetleg erre gondoltál: <button onClick={() => { setQ(suggestion); setParams({ q: suggestion }); }} className="underline text-foreground font-medium">{suggestion}</button>?</>)} Próbálkozz más szavakkal, vagy <Link to="/kategoriak" className="underline text-foreground">böngéssz a kategóriák között</Link>.
          </div>
        )}

        {initial && !loading && piFallback && piFallback.candidates.length > 0 && podcasts.length === 0 && (
          <div className="mt-8 p-5 rounded-xl border border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {piFallback.staged > 0 ? "Hamarosan elérhető" : "Külső forrásban megtaláltuk"}
              </span>
              {piFallback.staged > 0 && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden />
              )}
            </div>
            <p className="text-sm text-foreground/80 mb-3">
              Ezek még nem voltak az adatbázisunkban. {piFallback.staged > 0
                ? `Most beraktuk ${piFallback.staged} feedet a feldolgozási sorba — pár percen belül megjelennek az epizódok.`
                : "Már a feldolgozási sorban vannak."}
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {piFallback.candidates.slice(0, 6).map((c, i) => {
                const inner = (
                  <div className="flex gap-3 p-3 rounded-lg border border-border bg-card hover:border-primary/40 transition-colors h-full">
                    {c.image_url && (
                      <img src={c.image_url} alt={c.title} loading="lazy"
                        className="w-14 h-14 rounded-md object-cover shrink-0 border border-border/60" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm leading-tight line-clamp-2">{c.title}</div>
                      {c.author && <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{c.author}</div>}
                      <div className="text-[10px] mt-1.5 inline-flex items-center gap-1">
                        {c.status === "indexed" && <span className="text-primary font-medium">Elérhető →</span>}
                        {c.status === "staged" && <span className="text-muted-foreground">Hamarosan</span>}
                        {c.status === "new" && <span className="text-muted-foreground">Hamarosan</span>}
                      </div>
                    </div>
                  </div>
                );
                return c.status === "indexed" && c.podcast_slug ? (
                  <Link key={i} to={`/podcast/${c.podcast_slug}`}>{inner}</Link>
                ) : (
                  <div key={i}>{inner}</div>
                );
              })}
            </div>
          </div>
        )}

        {heroPerson && (
          <div className="mt-8">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary mb-2">Legjobb személy találat</div>
            <Link
              to={`/szemelyek/${heroPerson.slug}`}
              className="flex gap-4 p-4 rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 via-card to-card hover:border-primary/70 transition-colors"
            >
              {heroPerson.image_url ? (
                <img src={heroPerson.image_url} alt={heroPerson.name} loading="lazy"
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-full object-cover shrink-0 border border-border/60" />
              ) : (
                <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full bg-muted shrink-0 border border-border/60" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-base sm:text-lg leading-tight line-clamp-2">{heroPerson.name}</div>
                {typeof heroPerson.gated_episode_count === "number" && heroPerson.gated_episode_count > 0 && (
                  <div className="text-xs text-muted-foreground mt-1">{heroPerson.gated_episode_count} epizód</div>
                )}
                {heroPerson.short_bio && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1.5">{heroPerson.short_bio}</p>
                )}
                <div className="text-[11px] text-primary font-medium mt-2">Személy oldal megnyitása →</div>
              </div>
            </Link>
          </div>
        )}

        {heroPodcast && (
          <div className="mt-8">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-primary mb-2">Legjobb podcast találat</div>
            <Link
              to={`/podcast/${heroPodcast.slug}`}
              className="flex gap-4 p-4 rounded-2xl border-2 border-primary/40 bg-gradient-to-br from-primary/10 via-card to-card hover:border-primary/70 transition-colors"
            >
              {heroPodcast.image_url && (
                <img src={heroPodcast.image_url} alt={(heroPodcast as any).display_title || heroPodcast.title} loading="lazy"
                  className="w-20 h-20 sm:w-24 sm:h-24 rounded-xl object-cover shrink-0 border border-border/60" />
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-base sm:text-lg leading-tight line-clamp-2">
                  {(heroPodcast as any).display_title || heroPodcast.title}
                </div>
                {heroPodcast.category && <div className="text-xs text-muted-foreground mt-1">{categoryLabels[heroPodcast.category] || heroPodcast.category}</div>}
                {(heroPodcast.summary || heroPodcast.description) && (
                  <p className="text-sm text-muted-foreground line-clamp-2 mt-1.5">
                    {heroPodcast.summary || heroPodcast.description}
                  </p>
                )}
                <div className="text-[11px] text-primary font-medium mt-2">Podcast megnyitása →</div>
              </div>
            </Link>
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
            {episodes.length > 0 && (
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
            )}
            {podcastsList.length > 0 && (
              <section>
                <h2 className="font-semibold mb-3">
                  {heroPodcast ? "További kapcsolódó podcastok" : "Kapcsolódó podcastok"} ({podcastsList.length})
                </h2>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {podcastsList.map((p) => <PodcastCard key={p.id} p={p} />)}
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
