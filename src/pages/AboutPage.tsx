import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function AboutPage() {
  useEffect(() => {
    setSeo({
      title: "About Podiverzum — Premium podcast discovery",
      description:
        "Podiverzum is an episode-first podcast search engine. We index public RSS feeds and rank by freshness, feed health, AI-extracted entities and editorial quality signals.",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Podiverzum",
        url: "https://podiverzum.com",
        description: "Episode-first podcast discovery engine. Search by topic, person, company, ticker and idea.",
        sameAs: [],
      },
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">About</div>
        <h1 className="text-3xl font-semibold mb-2">Find it. Hear it.</h1>
        <p className="text-muted-foreground !mt-2">
          Podiverzum is a premium podcast discovery engine. We don't host audio — we make
          the world's podcast catalog searchable by what's actually inside the episodes.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Why Podiverzum exists</h2>
        <p>
          Most podcast apps are built around shows you already follow. Discovery is an
          afterthought. If you want to find <em>every</em> episode discussing Nvidia
          earnings, Sam Altman, asparagus or the Fed's next move, you're stuck scrolling.
        </p>
        <p>
          Podiverzum flips that. We treat podcasts the way Google treats the web —
          as a searchable, ranked index of episodes, topics, people and companies.
        </p>

        <h2 className="mt-10 text-xl font-semibold">What we do</h2>
        <ul className="list-disc pl-5">
          <li>Continuously crawl thousands of public podcast RSS feeds.</li>
          <li>Use AI to extract entities — people, companies, tickers, ingredients, topics — from each episode.</li>
          <li>Rank shows and episodes by freshness, feed health, editorial quality and engagement signals.</li>
          <li>Surface discovery surfaces: trending, timeless episodes, mood collections, entity pages.</li>
          <li>Link you straight to the original publisher (Apple, Spotify, YouTube, the show's site).</li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">What we don't do</h2>
        <ul className="list-disc pl-5">
          <li>We don't host or stream audio. The audio belongs to its creators.</li>
          <li>We don't sell personal data. See <Link to="/privacy" className="text-primary hover:underline">Privacy</Link>.</li>
          <li>We don't pay for placement. Rankings are formulaic — see <Link to="/methodology" className="text-primary hover:underline">How we rank</Link>.</li>
          <li>We don't run third-party advertising trackers.</li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">Built by listeners, for listeners</h2>
        <p>
          Podiverzum is built by a small team of operators, engineers and obsessive
          podcast listeners. We use the product every day. If something feels off, the
          quickest way to reach us is the in-app feedback button.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Status</h2>
        <p>
          Podiverzum is currently in <strong>closed beta</strong>. The catalog grows daily.
          Rankings, surfaces and entity tags will keep evolving.
        </p>

        <div className="not-prose mt-12 flex flex-wrap gap-3">
          <Link to="/methodology" className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity">
            How we rank →
          </Link>
          <Link to="/categories" className="px-4 py-2 rounded-md bg-secondary text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors">
            Browse categories
          </Link>
        </div>
      </article>
    </Layout>
  );
}
