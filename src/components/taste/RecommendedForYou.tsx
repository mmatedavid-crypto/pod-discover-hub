import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { LikeDislikeButtons, TasteBadge } from "./LikeDislikeButtons";
import { imageSrcSet, optimizedImageUrl } from "@/lib/image";

type RecEpisode = {
  id: string;
  slug: string;
  title: string;
  image_url: string | null;
  published_at: string | null;
  podcast: {
    id: string;
    slug: string;
    title: string;
    image_url: string | null;
  } | null;
};

type Resp = {
  episodes: RecEpisode[];
  mode: "personalized" | "archetype" | "fresh";
  signal_count: number;
};

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/taste-recommend`;

export default function RecommendedForYou() {
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data: session } = await supabase.auth.getSession();
        const token = session.session?.access_token;
        if (!token) { if (alive) setLoading(false); return; }
        const res = await fetch(FN_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string,
          },
          body: JSON.stringify({}),
        });
        const json = (await res.json()) as Resp;
        if (alive) setData(json);
      } catch (e) {
        console.error("taste-recommend fetch failed", e);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (loading) {
    return (
      <section className="rounded-2xl border border-border/60 bg-card/40 p-6">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Ajánlások betöltése…
        </div>
      </section>
    );
  }

  if (!data || data.episodes.length === 0) {
    return (
      <section className="rounded-2xl border border-border/60 bg-card/40 p-6">
        <header className="mb-3 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold">Neked válogatva</h2>
        </header>
        <p className="text-sm text-muted-foreground mb-4">
          Még pár swipe és élesedik az ízlésed — utána ide kerülnek a profilodra szabott magyar epizódok.
        </p>
        <Link
          to="/te-podiverzumod"
          className="inline-flex items-center rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Mutasd a kártyákat
        </Link>
      </section>
    );
  }

  const visible = data.episodes.filter((e) => !hiddenIds.has(e.id));

  return (
    <section className="rounded-2xl border border-border/60 bg-card/40 p-5 md:p-6">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h2 className="text-lg font-semibold">Neked válogatva</h2>
          {data.mode !== "personalized" && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              {data.mode === "archetype" ? "Indító ajánlás" : "Friss epizódok"}
            </span>
          )}
        </div>
        <TasteBadge count={data.signal_count} />
      </header>

      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((ep) => (
          <li
            key={ep.id}
            className="group relative flex gap-3 rounded-xl border border-border/40 bg-background/60 p-3 transition hover:border-border"
          >
            {(ep.image_url || ep.podcast?.image_url) ? (
              <img
                src={optimizedImageUrl(ep.image_url || ep.podcast?.image_url, { width: 96, height: 96 }) || ep.image_url || ep.podcast?.image_url || ""}
                srcSet={imageSrcSet(ep.image_url || ep.podcast?.image_url, [64, 96, 128])}
                sizes="64px"
                alt=""
                loading="lazy"
                decoding="async"
                width={96}
                height={96}
                className="h-16 w-16 flex-none rounded-lg object-cover"
              />
            ) : (
              <div className="h-16 w-16 flex-none rounded-lg bg-muted" />
            )}
            <div className="min-w-0 flex-1">
              <Link
                to={ep.podcast ? `/podcast/${ep.podcast.slug}/${ep.slug}` : "#"}
                className="line-clamp-2 text-sm font-medium leading-snug hover:text-primary"
              >
                {ep.title}
              </Link>
              {ep.podcast && (
                <Link
                  to={`/podcast/${ep.podcast.slug}`}
                  className="mt-1 line-clamp-1 block text-xs text-muted-foreground hover:text-foreground"
                >
                  {ep.podcast.title}
                </Link>
              )}
              <div className="mt-2">
                <LikeDislikeButtons
                  episodeId={ep.id}
                  source="recommended_feed"
                  onChange={(kind) => {
                    if (kind === "dislike") {
                      setHiddenIds((prev) => new Set(prev).add(ep.id));
                    }
                  }}
                />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <p className="mt-4 text-xs text-muted-foreground/80">
        Minél többet hallgatsz és jelölsz, annál pontosabb. A profilod folyamatosan frissül.
      </p>
    </section>
  );
}
