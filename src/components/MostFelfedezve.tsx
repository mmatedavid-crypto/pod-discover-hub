// Homepage long-tail discovery rail.
// Goal: ensure freshly-added long-tail episodes (ANY tier, incl. D/E) get an
// internal link from the highest-juice page on the site, so Googlebot follows
// them on the next crawl. NOT curated — pure recency, full HU catalog.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Compass, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { optimizedImageUrl, imageSrcSet } from "@/lib/image";

type DiscoveryEpisode = {
  id: string;
  slug: string;
  display_title: string | null;
  title: string;
  image_url: string | null;
  published_at: string | null;
  podcast_slug: string;
  podcast_title: string;
  podcast_image_url: string | null;
};

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600_000);
  if (h < 1) return "perce";
  if (h < 24) return `${h} órája`;
  const d = Math.floor(h / 24);
  return `${d} napja`;
}

export function MostFelfedezve() {
  const [eps, setEps] = useState<DiscoveryEpisode[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const since = new Date(Date.now() - 48 * 3600_000).toISOString();
      const { data, error } = await supabase
        .from("episodes")
        .select(
          "id, slug, title, display_title, image_url, published_at, podcasts!inner(slug, title, display_title, image_url, language_decision)",
        )
        .eq("podcasts.language_decision", "accept_hungarian")
        .gte("published_at", since)
        .order("published_at", { ascending: false })
        .limit(24);
      if (cancelled || error || !data) return;
      // Diversify: at most 1 per podcast in the first 12 slots
      const seen = new Set<string>();
      const picked: DiscoveryEpisode[] = [];
      for (const r of data as any[]) {
        const ps = r.podcasts;
        if (!ps?.slug || !r.slug) continue;
        if (seen.has(ps.slug)) continue;
        seen.add(ps.slug);
        picked.push({
          id: r.id,
          slug: r.slug,
          title: r.title,
          display_title: r.display_title,
          image_url: r.image_url,
          published_at: r.published_at,
          podcast_slug: ps.slug,
          podcast_title: ps.display_title || ps.title,
          podcast_image_url: ps.image_url,
        });
        if (picked.length >= 12) break;
      }
      setEps(picked);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (eps.length === 0) return null;

  return (
    <section aria-labelledby="most-felfedezve-heading">
      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">
            <Compass className="h-3 w-3" /> Friss
          </div>
          <h2 id="most-felfedezve-heading" className="text-xl sm:text-2xl font-semibold tracking-tight">
            Most felfedezve
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            Az elmúlt 48 órában megjelent magyar epizódok — minden zugból, nem csak a top műsoroktól.
          </p>
        </div>
        <Link
          to="/uj-podcastok"
          className="hidden sm:inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          Összes friss <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <ul className="flex gap-3 overflow-x-auto scrollbar-thin pb-2 -mx-4 px-4 snap-x snap-mandatory">
        {eps.map((ep) => {
          const cover = ep.image_url || ep.podcast_image_url;
          const title = ep.display_title || ep.title;
          return (
            <li key={ep.id} className="snap-start shrink-0 w-[240px] sm:w-[260px]">
              <Link
                to={`/podcast/${ep.podcast_slug}/${ep.slug}`}
                className="group block rounded-xl border border-border/60 bg-card/40 hover:border-primary/40 hover:bg-card/80 transition-colors p-3 h-full"
              >
                <div className="flex gap-3">
                  {cover ? (
                    <img
                      src={optimizedImageUrl(cover, { width: 72, height: 72 }) || cover}
                      srcSet={imageSrcSet(cover, [56, 72, 112])}
                      sizes="56px"
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={56}
                      height={56}
                      className="h-14 w-14 rounded-md object-cover bg-muted shrink-0"
                    />
                  ) : (
                    <div className="h-14 w-14 rounded-md bg-muted shrink-0" />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-muted-foreground truncate">
                      <Link
                        to={`/podcast/${ep.podcast_slug}`}
                        className="hover:text-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {ep.podcast_title}
                      </Link>
                    </div>
                    <div className="text-sm font-medium text-foreground line-clamp-2 leading-snug mt-0.5 group-hover:text-primary transition-colors">
                      {title}
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">{timeAgo(ep.published_at)}</div>
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default MostFelfedezve;
