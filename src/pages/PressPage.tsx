import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";
import { sitePublisherJsonLd } from "@/lib/sitePublisher";
import { Newspaper, ExternalLink } from "lucide-react";

const PRESS_ITEMS = [
  {
    source: "MTI",
    sourceUrl: "https://mti.hu/nemzeti-kozlemenytar/2026/06/14/tiz-ev-alatt-tobb-mint-30-szorosara-nott-magyar-podcastpiac",
    title: "Tíz év alatt több mint 30-szorosára nőtt a magyar podcastpiac",
    date: "2026. 06. 14.",
    quote:
      "A magyar podcastpiac több mint harmincszorosára nőtt az elmúlt évtizedben: míg 2015-ben mintegy ezer műsor volt elérhető, addig május végére már több mint 36 500 műsor kínálta a műfajra épülő tartalmakat.",
    type: "Hírközlemény",
  },
];

export default function PressPage() {
  useEffect(() => {
    setSeo({
      title: "Rólunk a sajtóban — Podiverzum",
      description:
        "A Podiverzumról írt cikkek, hírek és sajtómegjelenések.",
      canonical: "https://podiverzum.hu/sajto",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "CollectionPage",
        name: "Rólunk a sajtóban — Podiverzum",
        url: "https://podiverzum.hu/sajto",
        description:
          "A Podiverzumról írt cikkek, hírek és sajtómegjelenések.",
        publisher: sitePublisherJsonLd(),
        hasPart: PRESS_ITEMS.map((item) => ({
          "@type": "NewsArticle",
          headline: item.title,
          url: item.sourceUrl,
          datePublished: "2026-06-14",
          inLanguage: "hu-HU",
          author: {
            "@type": "Organization",
            name: item.source,
          },
        })),
      },
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">
          Sajtó
        </div>
        <h1 className="text-3xl font-semibold mb-3">Rólunk a sajtóban</h1>
        <p className="text-muted-foreground max-w-xl">
          Cikkek, hírek és megjelenések, amelyekben a Podiverzumról írtak.
        </p>

        <div className="mt-10 space-y-6">
          {PRESS_ITEMS.map((item) => (
            <a
              key={item.sourceUrl}
              href={item.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="block rounded-xl border border-border bg-card/40 p-6 sm:p-7 hover:bg-card/70 transition-colors group"
            >
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3">
                <Newspaper className="h-3.5 w-3.5" />
                <span className="uppercase tracking-wider font-medium text-foreground/80">
                  {item.source}
                </span>
                <span>·</span>
                <span>{item.date}</span>
                <span>·</span>
                <span>{item.type}</span>
              </div>

              <h2 className="text-lg font-semibold leading-snug group-hover:text-primary transition-colors">
                {item.title}
              </h2>

              <blockquote className="mt-4 text-sm text-muted-foreground leading-relaxed border-l-2 border-primary/50 pl-4 italic">
                {item.quote}
              </blockquote>

              <div className="mt-5 inline-flex items-center gap-1.5 text-sm text-primary font-medium">
                Elolvasom
                <ExternalLink className="h-3.5 w-3.5" />
              </div>
            </a>
          ))}
        </div>

        <div className="mt-12 pt-8 border-t border-border/70">
          <p className="text-sm text-muted-foreground">
            Sajtókapcsolat: {" "}
            <a
              href="mailto:sajto@podiverzum.hu"
              className="text-primary hover:underline"
            >
              sajto@podiverzum.hu
            </a>
          </p>
          <div className="not-prose mt-6 flex flex-wrap gap-3">
            <Link
              to="/rolunk"
              className="px-4 py-2 rounded-md bg-secondary text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Rólunk →
            </Link>
            <Link
              to="/"
              className="px-4 py-2 rounded-md bg-secondary text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
            >
              Főoldal →
            </Link>
          </div>
        </div>
      </article>
    </Layout>
  );
}
