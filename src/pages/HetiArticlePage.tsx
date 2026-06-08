import { useEffect, useMemo, useState } from "react";
import { Link, useParams, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { breadcrumbJsonLd, ogImageUrl, setSeo } from "@/lib/seo";
import { hetiSlug, parseHetiSlug, isoWeekToMonday, isoWeek } from "@/lib/hetiSlug";
import { Quote, Calendar, ArrowRight, ArrowLeft, User } from "lucide-react";
import { imageSrcSet, optimizedImageUrl } from "@/lib/image";

const SITE_URL = "https://podiverzum.hu";

type Item = {
  episode_id: string;
  title: string;
  podcast_name: string;
  podcast_slug: string;
  episode_slug: string;
  url: string;
  teaser: string;
  quote: string;
};

type Post = {
  id: string;
  week_start: string;
  week_end: string;
  title: string | null;
  intro: string | null;
  items: Item[];
  cover_image_url: string | null;
  published_at: string | null;
};

function fmtRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("hu-HU", { month: "long", day: "numeric" }).format(d);
  return `${fmt(s)} – ${fmt(e)}`;
}

function fmtDateTime(iso: string | null) {
  if (!iso) return "";
  return new Intl.DateTimeFormat("hu-HU", {
    year: "numeric", month: "long", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));
}

export default function HetiArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [neighbors, setNeighbors] = useState<{ prev: Post | null; next: Post | null }>({ prev: null, next: null });
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [canonicalSlug, setCanonicalSlug] = useState<string | null>(null);

  const parsed = useMemo(() => (slug ? parseHetiSlug(slug) : null), [slug]);

  useEffect(() => {
    if (!parsed) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      const monday = isoWeekToMonday(parsed.year, parsed.week);
      // Posts can have week_start a few days off Monday (Sat/Sun/Mon) — widen
      // the window and pick the row whose hetiSlug matches or whose ISO week matches.
      const lo = new Date(`${monday}T00:00:00Z`); lo.setUTCDate(lo.getUTCDate() - 10);
      const hi = new Date(`${monday}T00:00:00Z`); hi.setUTCDate(hi.getUTCDate() + 10);
      const { data } = await supabase
        .from("editorial_posts" as any)
        .select("id,week_start,week_end,title,intro,items,cover_image_url,published_at")
        .eq("status", "published")
        .gte("week_start", lo.toISOString().slice(0, 10))
        .lte("week_start", hi.toISOString().slice(0, 10))
        .order("week_start", { ascending: false });
      const rows = (data as unknown as Post[]) || [];
      const exact = rows.find((r) => hetiSlug(r) === slug);
      const sameWeek = rows.find((r) => {
        const w = isoWeek(r.week_start);
        return w.year === parsed.year && w.week === parsed.week;
      });
      const p: Post | null = exact || sameWeek || null;
      setPost(p);
      setNotFound(!p);

      if (p) {
        const correct = hetiSlug(p);
        if (correct !== slug) setCanonicalSlug(correct);

        const [{ data: prevRows }, { data: nextRows }] = await Promise.all([
          supabase.from("editorial_posts" as any)
            .select("id,week_start,week_end,title,intro,items,cover_image_url,published_at")
            .eq("status", "published").lt("week_start", p.week_start)
            .order("week_start", { ascending: false }).limit(1),
          supabase.from("editorial_posts" as any)
            .select("id,week_start,week_end,title,intro,items,cover_image_url,published_at")
            .eq("status", "published").gt("week_start", p.week_start)
            .order("week_start", { ascending: true }).limit(1),
        ]);
        setNeighbors({
          prev: (prevRows?.[0] as unknown as Post) || null,
          next: (nextRows?.[0] as unknown as Post) || null,
        });
      }
      setLoading(false);
    })();
  }, [parsed?.year, parsed?.week, slug]);

  useEffect(() => {
    if (!post) {
      if (!loading) {
        setSeo({
          title: "Heti anyag nem található | Podiverzum Heti",
          description: "Ez a Podiverzum Heti anyag nem található.",
          canonical: `${SITE_URL}/heti`,
          noindex: true,
        });
      }
      return;
    }
    const slugForUrl = hetiSlug(post);
    const canonical = `${SITE_URL}/heti/${slugForUrl}`;
    const { year, week } = isoWeek(post.week_start);
    const fallbackTitle = `Podiverzum Heti: miről beszéltek a magyar podcastok a ${week}. héten?`;
    const title = post.title || fallbackTitle;
    const description =
      post.intro?.replace(/\s+/g, " ").trim().slice(0, 155) ||
      `Heti válogatás magyar podcastokból — ${fmtRange(post.week_start, post.week_end)} (${year}/${week}. hét).`;
    const image =
      post.cover_image_url ||
      ogImageUrl({ kind: "site", title, subtitle: fmtRange(post.week_start, post.week_end) });
    setSeo({
      title: `${title} | Podiverzum Heti`,
      description,
      canonical,
      image,
      ogType: "article",
      hreflang: [
        { lang: "hu", href: canonical },
        { lang: "x-default", href: canonical },
      ],
      jsonLd: [
        {
          "@context": "https://schema.org",
          "@type": "NewsArticle",
          headline: title,
          description,
          url: canonical,
          mainEntityOfPage: canonical,
          inLanguage: "hu-HU",
          datePublished: post.published_at || post.week_end,
          dateModified: post.published_at || post.week_end,
          image: [image],
          articleSection: "Podiverzum Heti",
          author: {
            "@type": "Organization",
            name: "Podiverzum szerkesztőség",
            url: SITE_URL,
          },
          publisher: {
            "@type": "Organization",
            name: "Podiverzum",
            url: SITE_URL,
            logo: { "@type": "ImageObject", url: `${SITE_URL}/icon-512.png` },
          },
        },
        {
          "@context": "https://schema.org",
          "@type": "ItemList",
          name: title,
          itemListElement: (post.items || []).map((it, idx) => ({
            "@type": "ListItem",
            position: idx + 1,
            url: `${SITE_URL}/podcast/${it.podcast_slug}/${it.episode_slug}`,
            name: it.title,
          })),
        },
        breadcrumbJsonLd([
          { name: "Podiverzum", url: `${SITE_URL}/` },
          { name: "Podiverzum Heti", url: `${SITE_URL}/heti` },
          { name: title, url: canonical },
        ]),
      ],
    });
  }, [post, loading]);

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

  // If the slug tail doesn't match the current title slug, redirect to the canonical slug.
  if (canonicalSlug && canonicalSlug !== slug) {
    return <Navigate to={`/heti/${canonicalSlug}`} replace />;
  }

  if (notFound && !loading) {
    return (
      <Layout>
        <div className="container mx-auto py-16 text-center max-w-xl">
          <h1 className="text-2xl font-semibold mb-3">Ez a heti anyag nem található</h1>
          <p className="text-muted-foreground mb-6">
            Lehet, hogy elköltözött vagy még nincs publikálva.
          </p>
          <Link to="/heti" className="text-primary hover:underline">
            ← Vissza a Podiverzum Heti rovathoz
          </Link>
        </div>
      </Layout>
    );
  }

  const { year, week } = post ? isoWeek(post.week_start) : { year: 0, week: 0 };
  const fallbackTitle = post
    ? `Podiverzum Heti: miről beszéltek a magyar podcastok a ${week}. héten?`
    : "";

  return (
    <Layout>
      <article className="container mx-auto py-10 max-w-3xl">
        {/* Breadcrumb */}
        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground mb-6">
          <ol className="flex items-center gap-1.5 flex-wrap">
            <li><Link to="/" className="hover:text-foreground">Főoldal</Link></li>
            <li aria-hidden>/</li>
            <li><Link to="/heti" className="hover:text-foreground">Podiverzum Heti</Link></li>
            {post && (
              <>
                <li aria-hidden>/</li>
                <li className="text-foreground truncate max-w-[60vw]">
                  {post.title || fallbackTitle}
                </li>
              </>
            )}
          </ol>
        </nav>

        <header className="mb-8 border-b border-border pb-6">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary font-semibold mb-2">
            Podiverzum Heti · Magyar podcastfigyelő
          </div>
          {loading ? (
            <div className="h-10 bg-muted/40 rounded animate-pulse w-2/3" />
          ) : post ? (
            <>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
                {post.title || fallbackTitle}
              </h1>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground mt-4">
                <span className="inline-flex items-center gap-1.5">
                  <Calendar className="h-3.5 w-3.5" />
                  <time dateTime={post.week_start}>
                    {fmtRange(post.week_start, post.week_end)}
                  </time>
                  <span className="opacity-60">· {year}/{week}. hét</span>
                </span>
                {post.published_at && (
                  <span>
                    Publikálva: <time dateTime={post.published_at}>{fmtDateTime(post.published_at)}</time>
                  </span>
                )}
                <span className="inline-flex items-center gap-1.5">
                  <User className="h-3.5 w-3.5" />
                  Podiverzum szerkesztőség
                </span>
              </div>
            </>
          ) : null}
        </header>

        {post?.cover_image_url && (
          <img
            src={optimizedImageUrl(post.cover_image_url, { width: 960, height: 540 }) || post.cover_image_url}
            srcSet={imageSrcSet(post.cover_image_url, [640, 960, 1280])}
            sizes="(max-width: 768px) 100vw, 768px"
            alt={post.title || fallbackTitle}
            className="w-full rounded-lg border border-border mb-8"
            loading="eager"
            fetchPriority="high"
            decoding="async"
            width={960}
            height={540}
          />
        )}

        {post && (
          <>
            {post.intro && (
              <div className="prose prose-lg dark:prose-invert max-w-none mb-10">
                {post.intro.split("\n").filter(Boolean).map((p, i) => (
                  <p key={i} className="text-lg leading-relaxed text-foreground/90">{p}</p>
                ))}
              </div>
            )}

            <div className="space-y-10">
              {(post.items || []).map((it, idx) => (
                <section key={it.episode_id || idx} className="border-l-2 border-primary/40 pl-5">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
                    {String(idx + 1).padStart(2, "0")} · {it.podcast_name}
                  </div>
                  <h2 className="text-xl sm:text-2xl font-semibold leading-snug mb-2">
                    <Link
                      to={`/podcast/${it.podcast_slug}/${it.episode_slug}`}
                      className="hover:text-primary underline-offset-4 hover:underline"
                    >
                      {it.title}
                    </Link>
                  </h2>
                  {it.teaser && (
                    <p className="text-base text-foreground/85 leading-relaxed mb-3">{it.teaser}</p>
                  )}
                  {it.quote && (
                    <blockquote className="flex gap-2 items-start text-[15px] italic text-foreground/75 border-l border-border pl-3 my-3">
                      <Quote className="h-4 w-4 text-primary/60 shrink-0 mt-1" aria-hidden />
                      <span>„{it.quote}"</span>
                    </blockquote>
                  )}
                  <Link
                    to={`/podcast/${it.podcast_slug}/${it.episode_slug}`}
                    className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-1"
                  >
                    Hallgasd meg <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </section>
              ))}
            </div>

            {/* Prev / Next */}
            <nav className="mt-16 pt-8 border-t border-border grid grid-cols-1 sm:grid-cols-2 gap-4">
              {neighbors.prev ? (
                <Link
                  to={`/heti/${hetiSlug(neighbors.prev)}`}
                  className="group rounded-lg border border-border p-4 hover:border-primary/60"
                >
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    <ArrowLeft className="h-3 w-3" /> Előző hét
                  </span>
                  <div className="text-sm font-medium mt-1.5 group-hover:text-primary">
                    {neighbors.prev.title || "Podiverzum Heti"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtRange(neighbors.prev.week_start, neighbors.prev.week_end)}
                  </div>
                </Link>
              ) : <div />}
              {neighbors.next ? (
                <Link
                  to={`/heti/${hetiSlug(neighbors.next)}`}
                  className="group rounded-lg border border-border p-4 hover:border-primary/60 sm:text-right"
                >
                  <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:justify-end">
                    Következő hét <ArrowRight className="h-3 w-3" />
                  </span>
                  <div className="text-sm font-medium mt-1.5 group-hover:text-primary">
                    {neighbors.next.title || "Podiverzum Heti"}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {fmtRange(neighbors.next.week_start, neighbors.next.week_end)}
                  </div>
                </Link>
              ) : <div />}
            </nav>
          </>
        )}

        <div className="mt-12 text-center">
          <Link to="/heti" className="text-sm text-muted-foreground hover:text-foreground">
            ← Vissza a Podiverzum Heti rovathoz
          </Link>
        </div>
      </article>
    </Layout>
  );
}
