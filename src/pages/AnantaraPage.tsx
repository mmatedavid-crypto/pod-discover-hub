import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Play, Pause } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import ListLoadError from "@/components/ListLoadError";
import { Button } from "@/components/ui/button";
import { setSeo } from "@/lib/seo";
import { useSmartPlayer } from "@/components/smart-player/SmartPlayerProvider";
import { MAX_CONSECUTIVE_SKIPS, nextPlayableIndex } from "@/lib/landingCuration";

const CANONICAL = "https://podiverzum.hu/anantara";

// Hand-picked from the Hungarian catalog (title + RSS description checked): episodes about yoga,
// meditation and Indian philosophy in their Indian/Sanskrit context. Order = listening order.
const EPISODE_IDS = [
  "4804ba46-7fbd-4fd6-b67e-0c3e77260a93", // Patanjali Jóga-Szútra 1.
  "27f884d4-6ceb-44ea-ae1c-12fc4d3c4812", // Patanjali Jóga-Szútra 2.
  "62dae6a2-7ece-4e4a-9024-0fd07eb04716", // Patañjali Jóga szútrái (Futó Kaland)
  "9e06274a-4bd1-46f8-9ad1-c1bea4e88c24", // Bhagavad-gita, az örök tudomány 1.
  "ab682688-b885-4e15-b18d-e53fe97c215e", // Magyarázat a Bhagavad-gītāhoz
  "6d037471-e122-4e37-9612-ca97e820ee24", // Caitana Das: hinduizmus, védák
  "82f11596-e7d9-41e1-91a6-62a9cf2ede3e", // India az ókorban – Dezső Csaba indológus
  "a75bf929-9a12-4dd5-bc68-803970ea9d0a", // Sri Ramakrisna Evangéliuma
  "d2cc96f4-fc07-49ad-bca3-54293df723a0", // Pressing Lajos: az indiai tantrák
  "b800a9b8-b46d-4269-9301-8611eb37d38b", // A Kundalini jelenség
  "2a6b5776-80db-4095-93a4-db1cc6633a25", // Medvegy Gergely vaisnava teológus
];

type Item = {
  id: string;
  title: string;
  href: string;
  show: string;
  showHref: string;
  audio: string;
  original: string | null;
  date: string;
  dateIso: string;
  minutes: number | null;
};

const huDate = (iso: string) =>
  new Date(iso).toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric", timeZone: "Europe/Budapest" });

export default function AnantaraPage() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [current, setCurrent] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const failedRef = useRef<Set<number>>(new Set());
  const skipsRef = useRef(0);
  const currentRef = useRef<number | null>(null);
  const smart = useSmartPlayer();

  useEffect(() => {
    setSeo({
      title: "Anantara – Podcastok megszakítás nélkül",
      description: "Magyar podcastválogatás a jógáról, a meditációról és az indiai filozófiáról, egymás után lejátszva.",
      canonical: CANONICAL,
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setError(false);
      const { data, error: qErr } = await supabase
        .from("episodes")
        .select("id, title, display_title, slug, audio_url, episode_url, published_at, duration_seconds, podcasts!inner(slug, title, display_title, language)")
        .in("id", EPISODE_IDS);
      if (cancelled) return;
      if (qErr) { setError(true); setItems([]); return; }
      const byId = new Map((data || []).map((r: any) => [r.id, r]));
      const list: Item[] = [];
      for (const id of EPISODE_IDS) {
        const r: any = byId.get(id);
        const p = r?.podcasts;
        if (!r?.slug || !r.audio_url || !p?.slug || !String(p.language || "").toLowerCase().startsWith("hu")) continue;
        list.push({
          id,
          title: r.display_title || r.title,
          href: `/podcast/${p.slug}/${r.slug}`,
          show: p.display_title || p.title,
          showHref: `/podcast/${p.slug}`,
          audio: r.audio_url,
          original: r.episode_url && /^https?:\/\//.test(r.episode_url) ? r.episode_url : null,
          date: r.published_at ? huDate(r.published_at) : "",
          dateIso: r.published_at || "",
          minutes: r.duration_seconds ? Math.round(r.duration_seconds / 60) : null,
        });
      }
      setItems(list);
    })();
    return () => { cancelled = true; };
  }, [reloadKey]);

  const playIndex = useCallback((i: number) => {
    const a = audioRef.current;
    const it = items?.[i];
    if (!a || !it) return;
    // Only one thing plays at a time: hand over from the site-wide player.
    if (smart.isPlaying) smart.pause();
    currentRef.current = i;
    setCurrent(i);
    setNotice(null);
    a.src = it.audio;
    a.play().catch((err) => {
      if (err?.name === "AbortError") return; // superseded by a newer src
      if (err?.name === "NotAllowedError") { setPlaying(false); return; } // needs a user tap; never force it
      handleFailure();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, smart]);

  const advance = useCallback(() => {
    if (!items || currentRef.current === null) return;
    const next = nextPlayableIndex(currentRef.current, items.length, failedRef.current);
    if (next === null) { setPlaying(false); setNotice("A válogatás végére értél."); return; }
    playIndex(next);
  }, [items, playIndex]);

  const handleFailure = useCallback(() => {
    const i = currentRef.current;
    if (i === null) return;
    failedRef.current.add(i);
    skipsRef.current += 1;
    if (skipsRef.current > MAX_CONSECUTIVE_SKIPS) {
      setPlaying(false);
      setNotice("Több adás egymás után nem tölthető be most. Próbáld újra később.");
      return;
    }
    advance();
  }, [advance]);

  // Pause this list if the visitor starts the site-wide player elsewhere on the page.
  useEffect(() => {
    if (smart.isPlaying && audioRef.current && !audioRef.current.paused) audioRef.current.pause();
  }, [smart.isPlaying]);

  const start = () => {
    if (!items?.length) return;
    failedRef.current = new Set();
    skipsRef.current = 0;
    playIndex(0);
  };

  const toggleItem = (i: number) => {
    const a = audioRef.current;
    if (!a) return;
    if (current === i) {
      if (a.paused) { if (smart.isPlaying) smart.pause(); void a.play().catch(() => {}); } else a.pause();
      return;
    }
    skipsRef.current = 0;
    failedRef.current.delete(i);
    playIndex(i);
  };

  const nowPlaying = current !== null ? items?.[current] : null;

  return (
    <Layout>
      <div className="container mx-auto max-w-3xl py-10">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Podiverzum-válogatás</p>
        <h1 className="mt-1 text-3xl font-semibold">Anantara – Podcastok megszakítás nélkül</h1>
        <p className="mt-4 text-lg">Az anantara szanszkrit szó, jelentése „folyamatos”, „megszakítás nélküli”.</p>
        <p className="mt-3 leading-relaxed text-muted-foreground">
          Magyar podcastadások a jógáról, a meditációról és az indiai filozófiáról – a saját indiai, szanszkrit
          hagyományukban. Patandzsali Jóga-szútrájától a Bhagavad-gítán és a védákon át a tantrákig, a kundalini
          hagyományáig és Rámakrisna tanításáig. Egy kattintás, és az adások egymás után, megszakítás nélkül szólnak.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <Button size="lg" onClick={start} disabled={!items?.length}>
            <Play className="mr-2 h-4 w-4" /> Indítsd el a válogatást
          </Button>
          {items && items.length > 0 && <span className="text-sm text-muted-foreground">{items.length} adás</span>}
        </div>

        <div className={nowPlaying ? "mt-5 rounded-lg border border-border bg-card p-3" : "hidden"}>
          {nowPlaying && (
            <div className="mb-2 text-sm">
              <span className="text-muted-foreground">Most szól ({(current ?? 0) + 1}/{items?.length}): </span>
              <span className="font-medium">{nowPlaying.title}</span>
              <span className="text-muted-foreground"> · {nowPlaying.show}</span>
            </div>
          )}
          <audio
            ref={audioRef}
            controls
            preload="none"
            className="w-full"
            data-testid="anantara-audio"
            onPlay={() => { setPlaying(true); if (smart.isPlaying) smart.pause(); }}
            onPlaying={() => { skipsRef.current = 0; }}
            onPause={() => setPlaying(false)}
            onEnded={advance}
            onError={() => { if (audioRef.current?.getAttribute("src")) handleFailure(); }}
          />
        </div>
        {notice && <p className="mt-2 text-sm text-muted-foreground" role="status">{notice}</p>}

        <div className="mt-8">
          {items === null ? (
            <div className="text-sm text-muted-foreground">Betöltés…</div>
          ) : error ? (
            <ListLoadError onRetry={() => setReloadKey((k) => k + 1)} />
          ) : (
            <ol className="space-y-3">
              {items.map((it, i) => {
                const active = current === i;
                return (
                  <li key={it.id} className={`flex gap-3 rounded-lg border p-3 sm:p-4 ${active ? "border-primary bg-card" : "border-border/70 bg-card/80"}`}>
                    <button
                      type="button"
                      onClick={() => toggleItem(i)}
                      aria-label={active && playing ? `Szünet: ${it.title}` : `Lejátszás: ${it.title}`}
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground transition-colors hover:bg-primary hover:text-primary-foreground"
                    >
                      {active && playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </button>
                    <div className="min-w-0">
                      <Link to={it.href} className="font-semibold leading-snug hover:underline">{it.title}</Link>
                      <div className="mt-1 text-xs text-muted-foreground">
                        <Link to={it.showHref} className="hover:underline">{it.show}</Link>
                        {it.date && (<><span className="mx-1.5 opacity-60">·</span><time dateTime={it.dateIso}>{it.date}</time></>)}
                        {it.minutes && (<><span className="mx-1.5 opacity-60">·</span>{it.minutes} perc</>)}
                        {it.original && (<><span className="mx-1.5 opacity-60">·</span><a href={it.original} target="_blank" rel="noopener noreferrer" className="hover:underline">eredeti adás</a></>)}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <p className="mt-10 text-xs text-muted-foreground">
          A válogatást a Podiverzum szerkesztette. Az adások a megjelölt műsorok saját felvételei, a műsorok nyilvános hangfájljaiból szólnak.
        </p>
      </div>
    </Layout>
  );
}
