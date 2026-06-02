import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { breadcrumbJsonLd, setSeo } from "@/lib/seo";
import { hetiSlug } from "@/lib/hetiSlug";
import { Calendar, ArrowRight } from "lucide-react";

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

function fmtRange(start: string, end: string) {
  const s = new Date(start);
  const e = new Date(end);
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("hu-HU", { month: "long", day: "numeric" }).format(d);
  return `${fmt(s)} – ${fmt(e)}`;
}

export default function HetiHubPage() {
  const [posts, setPosts] = useState<Post[]>([]);
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
          <div className="text-center py-16 text-muted-foreground">
            Még nincs publikált heti anyag.
          </div>
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
