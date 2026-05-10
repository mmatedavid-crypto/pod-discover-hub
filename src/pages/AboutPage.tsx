import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function AboutPage() {
  useEffect(() => {
    setSeo({
      title: "About Podiverzum — AI-powered podcast discovery",
      description:
        "Podiverzum is an AI-powered podcast discovery engine. We index thousands of public podcast feeds and help listeners find episodes by what they actually discuss.",
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: "Podiverzum",
        url: "https://podiverzum.com",
        description:
          "AI-powered podcast discovery engine. Search episodes by topic, person, company, ticker and idea.",
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
          Podiverzum is an AI-powered podcast discovery engine built to make the best of
          the public podcast ecosystem searchable, understandable and easier to explore.
        </p>
        <p>
          We do not host audio. We do not replace podcast apps. We index public podcast
          feeds and help listeners discover episodes by what they actually discuss —
          people, companies, markets, technologies, ideas, places, health topics,
          cultural trends and more.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Why Podiverzum exists</h2>
        <p>
          Most podcast apps are designed around shows you already follow. They work well
          when you know exactly what you want to hear.
        </p>
        <p>But discovery is still fragmented.</p>
        <p>
          If you want to find recent episodes about Nvidia earnings, Sam Altman, the
          Federal Reserve, GLP-1 drugs, private credit, AI regulation, longevity,
          Bitcoin ETFs or the war in Ukraine, you usually have to search by title,
          scroll through individual feeds, or hope the right episode appears in a chart.
        </p>
        <p>Podiverzum is built for that missing layer.</p>
        <p>
          We treat podcasts more like the web: a searchable, ranked index of episodes,
          shows, topics, people, companies and ideas.
        </p>

        <h2 className="mt-10 text-xl font-semibold">What we do</h2>
        <ul className="list-disc pl-5">
          <li>We continuously index thousands of public podcast RSS feeds.</li>
          <li>
            We use AI to understand what episodes are actually about — including people,
            companies, tickers, technologies, places, themes and topics.
          </li>
          <li>
            We rank podcasts and episodes by freshness, consistency, quality, relevance
            and feed health.
          </li>
          <li>
            We create discovery surfaces such as trending episodes, timeless picks,
            category pages, mood collections and entity pages.
          </li>
          <li>
            We send listeners back to the original publisher — Apple Podcasts, Spotify,
            YouTube, the show's website or wherever the creator publishes.
          </li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">What we don't do</h2>
        <ul className="list-disc pl-5">
          <li>We don't host or stream audio. The audio belongs to its creators and publishers.</li>
          <li>
            We don't sell personal data. See{" "}
            <Link to="/privacy" className="text-primary hover:underline">Privacy</Link>.
          </li>
          <li>
            We don't sell placement. Rankings are formulaic, quality-driven and designed
            to surface useful results. See{" "}
            <Link to="/methodology" className="text-primary hover:underline">How we rank</Link>.
          </li>
          <li>We don't run third-party advertising trackers.</li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">Built for serious listeners</h2>
        <p>
          Podiverzum is built for people who use podcasts to learn, research, think and
          discover.
        </p>
        <p>
          It is for listeners who want more than charts, subscriptions and algorithmic
          recommendations. It is for people who want to search across thousands of
          episodes and quickly understand which ones are worth their time.
        </p>
        <p>
          Our goal is simple: make high-quality podcast discovery faster, smarter and
          less noisy.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Status</h2>
        <p>Podiverzum is currently in <strong>closed beta</strong>.</p>
        <p>
          The catalog grows daily. Search quality, rankings, entity pages and discovery
          surfaces will continue to improve as more episodes are indexed, enriched and
          connected.
        </p>

        <div className="not-prose mt-12 flex flex-wrap gap-3">
          <Link
            to="/methodology"
            className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 transition-opacity"
          >
            How we rank →
          </Link>
          <Link
            to="/privacy"
            className="px-4 py-2 rounded-md bg-secondary text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Privacy →
          </Link>
          <a
            href="mailto:hello@podiverzum.com?subject=Podiverzum%20feedback"
            className="px-4 py-2 rounded-md bg-secondary text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            Send feedback →
          </a>
        </div>
      </article>
    </Layout>
  );
}
