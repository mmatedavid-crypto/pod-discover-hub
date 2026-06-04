import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { breadcrumbJsonLd, setSeo } from "@/lib/seo";
import { hetiSlug } from "@/lib/hetiSlug";
import { Calendar, ArrowRight } from "lucide-react";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";

const SITE_URL = "https://podiverzum.hu";

type Post = {
  id: string;
  week_start: string;
  week_end: string;
  title: string | null;
  intro: string | null;
  cover_image_url: string | null;
  published_at: string | null;
};

type FallbackEpisode = {
  id: string;
  title: string | null;
  display_title: string | null;
  slug: string | null;
  published_at: string | null;
  ai_summary: string | null;
  summary: string | null;
  description: string | null;
  podcasts?: {
    slug: string | null;
    title: string | null;
    display_title: string | null;
  } | null;
};

function fmtRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("hu-HU", { month: "long", day: "numeric" }).format(d);
  return `${fmt(s)} – ${fmt(e)}`;
}

export default function HetiHubPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [fallbackEpisodes, setFallbackEpisodes] = useState<FallbackEpisode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSeo({
      title: "Podiverzum Heti – magyar podcastfigyelő | Podiverzum",
      description:
        "A Podiverzum Heti megmutatja, miről beszéltek a magyar podcastok az adott héten. Témák, epizódok, idézetek és friss felfedezések.",
      canonical: `${SITE_URL}/heti`,
      hreflang: [
        { lang: "hu", href: `${SITE_URL}/heti` },
        { lang: "x-default", href: `${SITE_URL}/heti` },
      ],
      jsonLd: [
        breadcrumbJsonLd([
          { name: "Podiverzum", url: `${SITE_URL}/` },
          { name: "Podiverzum Heti", url: `${SITE_URL}/heti` },
        ]),
      ],
    });
  }, []);

  // RSS autodiscovery for /heti/rss.xml
  useEffect(() => {
    const HREF = `${SITE_URL}/heti/rss.xml`;
    let el = document.head.querySelector<HTMLLinkElement>(
      'link[rel="alternate"][type="application/rss+xml"][data-heti-rss="1"]',
    );
    if (!el) {
      el = document.createElement("link");
      el.setAttribute("rel", "alternate");
      el.setAttribute("type", "application/rss+xml");
      el.setAttribute("title", "Podiverzum Heti RSS");
      el.setAttribute("data-heti-rss", "1");
      document.head.appendChild(el);
    }
    el.setAttribute("href", HREF);
    return () => { el?.remove(); };
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("editorial_posts" as any)
        .select("id,week_start,week_end,title,intro,cover_image_url,published_at")
        .eq("status", "published")
        .order("week_start", { ascending: false })
        .limit(60);
      setPosts((data as unknown as Post[]) || []);
      if (!data || data.length === 0) {
        const { data: eps } = await supabase
          .from("episodes")
          .select("id,title,display_title,slug,published_at,ai_summary,summary,description,podcasts!inner(slug,title,display_title,is_hungarian,language_decision,rss_status,category)")
          .eq("podcasts.language_decision", "accept_hungarian")
          .neq("podcasts.rss_status", "failed")
          .neq("podcasts.category", "Religion & Spirituality")
          .not("slug", "is", null)
          .order("published_at", { ascending: false })
          .limit(8);
        setFallbackEpisodes((eps as unknown as FallbackEpisode[]) || []);
      } else {
        setFallbackEpisodes([]);
      }
      setLoading(false);
    })();
  }, []);

  const featured = posts[0];
  const rest = posts.slice(1);

  return (
    <Layout>
      <article className="container mx-auto py-10 max-w-4xl">
        <header className="mb-10 border-b border-border pb-8">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary font-semibold mb-2">
            Magyar podcastfigyelő
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">
            Podiverzum Heti
          </h1>
          <p className="text-base text-muted-foreground mt-4 max-w-2xl leading-relaxed">
            A Podiverzum Heti megmutatja, miről beszéltek a magyar podcastok az adott héten.
            Válogatás témákból, epizódokból, idézetekből és friss felfedezésekből.
          </p>
        </header>

        {loading && (
          <div className="text-muted-foreground py-10 text-center">Betöltés…</div>
        )}

        {!loading && posts.length === 0 && (
          <section className="space-y-5">
            <div className="rounded-xl border border-border bg-card/40 p-5 sm:p-6">
              <div className="text-[10px] uppercase tracking-[0.18em] text-primary font-semibold mb-2">
                A következő heti válogatás készül
              </div>
              <h2 className="text-2xl font-bold tracking-tight">Friss magyar podcastok addig is</h2>
              <p className="text-sm text-muted-foreground leading-relaxed mt-2 max-w-2xl">
                A heti szerkesztői anyag automatikusan frissül, amikor elkészül. Addig itt vannak
                a legfrissebb magyar epizódok, hogy a link ne üres oldalra vigyen.
              </p>
            </div>

            {fallbackEpisodes.length > 0 && (
              <div className="grid gap-3 sm:grid-cols-2">
                {fallbackEpisodes.map((ep) => {
                  const podcast = ep.podcasts;
                  const href = podcast?.slug && ep.slug ? `/podcast/${podcast.slug}/${ep.slug}` : "/uj";
                  const title = ep.display_title || ep.title || "Friss epizód";
                  const text = sanitizeHungarianPublicText(ep.ai_summary)
                    || sanitizeHungarianPublicText(ep.summary)
                    || sanitizeHungarianPublicText(ep.description);
                  return (
                    <Link
                      key={ep.id}
                      to={href}
                      className="group rounded-lg border border-border bg-background p-4 transition-colors hover:border-primary/50"
                    >
                      <div className="text-xs text-muted-foreground mb-2">
                        {podcast?.display_title || podcast?.title || "Podcast"}
                      </div>
                      <h3 className="font-semibold leading-snug group-hover:text-primary transition-colors line-clamp-2">
                        {title}
                      </h3>
                      {text && (
                        <p className="text-sm text-muted-foreground mt-2 line-clamp-3">
                          {text}
                        </p>
                      )}
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        )}

        {featured && (
          <section className="mb-12">
            <div className="text-[10px] uppercase tracking-[0.18em] text-primary font-semibold mb-3">
              Legfrissebb heti anyag
            </div>
            <Link
              to={`/heti/${hetiSlug(featured)}`}
              className="block group rounded-xl border border-primary/30 bg-gradient-to-br from-primary/[0.08] via-card/40 to-card/40 p-6 sm:p-8 transition-colors hover:border-primary/60"
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Calendar className="h-3.5 w-3.5" />
                <time dateTime={featured.week_start}>
                  {fmtRange(featured.week_start, featured.week_end)}
                </time>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold leading-tight group-hover:text-primary transition-colors">
                {featured.title || "Podiverzum Heti"}
              </h2>
              {featured.intro && (
                <p className="text-base text-foreground/80 leading-relaxed mt-3 line-clamp-3">
                  {featured.intro.split("\n").find((l) => l.trim().length > 30) || featured.intro}
                </p>
              )}
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-primary mt-4">
                Olvasd el a heti válogatást <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          </section>
        )}

        {rest.length > 0 && (
          <section>
            <h2 className="text-sm uppercase tracking-[0.16em] text-muted-foreground mb-4">
              Korábbi heti anyagok
            </h2>
            <ul className="divide-y divide-border border-t border-border">
              {rest.map((p) => (
                <li key={p.id}>
                  <a
                    href={`/heti/${hetiSlug(p)}`}
                    className="flex items-baseline justify-between gap-4 py-3 hover:text-primary"
                  >
                    <span className="truncate text-base font-medium">
                      {p.title || "Podiverzum Heti"}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {fmtRange(p.week_start, p.week_end)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </article>
    </Layout>
  );
}
