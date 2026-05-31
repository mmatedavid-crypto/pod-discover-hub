import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { breadcrumbJsonLd, ogImageUrl, setSeo } from "@/lib/seo";
import { Quote, Calendar, ArrowRight } from "lucide-react";

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

export default function HetiValogatasPage() {
  const { weekId } = useParams<{ weekId?: string }>();
  const [post, setPost] = useState<Post | null>(null);
  const [archive, setArchive] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      let query = supabase
        .from("editorial_posts" as any)
        .select("id,week_start,week_end,title,intro,items,cover_image_url,published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(1);

      if (weekId) {
        // weekId format: YYYY-MM-DD (week_start)
        query = supabase
          .from("editorial_posts" as any)
          .select("id,week_start,week_end,title,intro,items,cover_image_url,published_at")
          .eq("status", "published")
          .eq("week_start", weekId)
          .limit(1);
      }

      const { data } = await query;
      const p = (data?.[0] as unknown as Post) || null;
      setPost(p);
      setNotFound(!p);

      const { data: arch } = await supabase
        .from("editorial_posts" as any)
        .select("id,week_start,week_end,title,intro,items,cover_image_url,published_at")
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .limit(12);
      const allPosts = (arch || []) as unknown as Post[];
      setArchive(p ? allPosts.filter((x) => x.id !== p.id) : allPosts);
      setLoading(false);
    })();
  }, [weekId]);

  useEffect(() => {
    if (post) {
      const canonical = weekId
        ? `${SITE_URL}/heti-valogatas/${post.week_start}`
        : `${SITE_URL}/heti-valogatas`;
      const title = post.title || "Heti válogatás";
      const description = post.intro?.slice(0, 155) || "A hét legizgalmasabb magyar podcast epizódjai, szerkesztői válogatásban.";
      setSeo({
        title: `${title} | Podiverzum`,
        description,
        canonical,
        image: post.cover_image_url || ogImageUrl({ kind: "site", title, subtitle: fmtRange(post.week_start, post.week_end) }),
        ogType: "article",
        hreflang: [
          { lang: "hu", href: canonical },
          { lang: "x-default", href: canonical },
        ],
        jsonLd: [
          {
            "@context": "https://schema.org",
            "@type": "Article",
            headline: title,
            description,
            url: canonical,
            inLanguage: "hu-HU",
            datePublished: post.published_at || post.week_end,
            dateModified: post.published_at || post.week_end,
            image: post.cover_image_url || `${SITE_URL}/og-image.jpg`,
            publisher: {
              "@type": "Organization",
              name: "Podiverzum",
              url: SITE_URL,
              logo: `${SITE_URL}/icon-512.png`,
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
            { name: "Heti válogatás", url: `${SITE_URL}/heti-valogatas` },
          ]),
        ],
      });
    } else {
      setSeo({
        title: "Heti válogatás – magyar podcast epizódok | Podiverzum",
        description: "A hét legizgalmasabb magyar podcast epizódjai, szerkesztői válogatásban.",
        canonical: `${SITE_URL}/heti-valogatas`,
        noindex: Boolean(notFound && weekId),
      });
    }
  }, [post, weekId, notFound]);

  return (
    <Layout>
      <article className="container mx-auto py-10 max-w-3xl">
        <header className="mb-8 border-b border-border pb-6">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary font-semibold mb-2">
            Heti válogatás
          </div>
          {loading ? (
            <div className="h-10 bg-muted/40 rounded animate-pulse w-2/3" />
          ) : post ? (
            <>
              <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
                {post.title || "A hét podcastjei"}
              </h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-3">
                <Calendar className="h-3.5 w-3.5" />
                <time>{fmtRange(post.week_start, post.week_end)}</time>
              </div>
            </>
          ) : (
            <h1 className="text-2xl font-semibold">
              {notFound && weekId ? "Ez a heti válogatás nem található" : "Még nincs publikált válogatás"}
            </h1>
          )}
        </header>

        {post && (
          <>
            {post.intro && (
              <div className="prose prose-lg dark:prose-invert max-w-none mb-10">
                {post.intro.split("\n").filter(Boolean).map((p, i) => (
                  <p key={i} className="text-lg leading-relaxed text-foreground/90">
                    {p}
                  </p>
                ))}
              </div>
            )}

            <div className="space-y-10">
              {post.items.map((it, idx) => (
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
                    <p className="text-base text-foreground/85 leading-relaxed mb-3">
                      {it.teaser}
                    </p>
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
          </>
        )}

        {archive.length > 0 && (
          <aside className="mt-16 pt-8 border-t border-border">
            <h2 className="text-sm uppercase tracking-[0.16em] text-muted-foreground mb-4">
              Korábbi válogatások
            </h2>
            <ul className="space-y-2">
              {archive.map((a) => (
                <li key={a.id}>
                  <Link
                    to={`/heti-valogatas/${a.week_start}`}
                    className="flex items-baseline justify-between gap-3 py-1.5 text-sm hover:text-primary border-b border-border/30"
                  >
                    <span className="truncate">{a.title || "Heti válogatás"}</span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      {fmtRange(a.week_start, a.week_end)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </aside>
        )}

        <div className="mt-12 text-center">
          <Link to="/mai-valogatas" className="text-sm text-muted-foreground hover:text-foreground">
            ← Mai válogatás
          </Link>
        </div>
      </article>
    </Layout>
  );
}
