import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function MethodologyPage() {
  useEffect(() => {
    setSeo({
      title: "How Podiverzum ranks podcasts and episodes",
      description:
        "Quality-first podcast discovery. How Podiverzum combines AI, structured analysis and editorial signals to rank podcasts and episodes — with no paid placement.",
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">How we rank</div>
        <h1 className="text-3xl font-semibold mb-2">Quality-first podcast discovery</h1>
        <p className="text-muted-foreground !mt-2">
          Podiverzum ranks podcasts and episodes to help listeners find the most useful,
          relevant and trustworthy content faster.
        </p>
        <p>
          Our ranking system combines artificial intelligence, structured metadata
          analysis and quality-focused discovery signals. The goal is not to surface the
          loudest shows or the most aggressively promoted content. The goal is to
          identify episodes that are genuinely worth a listener's time.
        </p>

        <h2 className="mt-10 text-xl font-semibold">No paid placement</h2>
        <p>
          Podiverzum does not sell ranking, visibility or featured placement.
        </p>
        <p>
          A podcast cannot pay to appear higher in search results, category pages,
          trending shelves or discovery collections. Commercial relationships do not
          influence ranking.
        </p>

        <h2 className="mt-10 text-xl font-semibold">What our system evaluates</h2>
        <p>
          Podiverzum analyzes podcasts and episodes across multiple dimensions, including
          content quality, freshness, relevance, consistency, discoverability and
          technical reliability.
        </p>
        <p>
          We use AI to better understand what episodes are actually about — including the
          topics, people, companies, industries, themes and ideas discussed in them.
        </p>
        <p>
          This allows Podiverzum to go beyond simple title matching and build a richer
          discovery layer around the substance of each episode.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Podcast quality signals</h2>
        <p>Podcasts are evaluated using a proprietary quality model.</p>
        <p>
          The model considers whether a show is active, well-structured, discoverable,
          consistently published and useful to listeners. It also considers whether the
          underlying feed provides enough reliable information for search, summarization
          and recommendation.
        </p>
        <p>
          We do not publish the exact formula, weights or thresholds behind this model.
          This protects the integrity of the ranking system and helps prevent
          manipulation.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Episode ranking</h2>
        <p>Episodes are ranked differently depending on context.</p>
        <p>
          A fresh episode may perform well in trending surfaces. A deeper, older episode
          may perform well in timeless discovery. A highly specific episode may appear
          prominently for a narrow search or entity page, even if it would not appear on
          the homepage.
        </p>
        <p>
          Podiverzum's ranking system considers relevance, freshness, quality, topic fit
          and diversity. The aim is to avoid repetitive results and help listeners
          discover a broader range of strong episodes.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Search ranking</h2>
        <p>
          Search on Podiverzum is designed to understand meaning, not just keywords.
        </p>
        <p>
          When someone searches for a person, company, market theme, health topic,
          technology or cultural trend, we look for episodes that meaningfully discuss
          that subject — even when the exact wording differs.
        </p>
        <p>
          Search results may combine title relevance, episode context, AI-generated
          understanding, podcast quality and recency signals.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Entity and topic pages</h2>
        <p>
          Podiverzum builds discovery pages around recurring people, companies, topics,
          tickers, industries and ideas.
        </p>
        <p>
          These pages are generated from structured analysis of indexed podcast content.
          They are designed to help listeners explore a subject across many shows and
          episodes, instead of being limited to one publisher or one feed.
        </p>
        <p>
          We only expose pages when there is enough useful material to support a
          meaningful discovery experience.
        </p>

        <h2 className="mt-10 text-xl font-semibold">What we avoid</h2>
        <p>
          Podiverzum may exclude or reduce visibility for content that appears broken,
          duplicated, misleading, spam-like, inactive, unsafe or unsuitable for default
          discovery surfaces.
        </p>
        <p>
          Non-English content may be indexed in the background, but the main public
          experience is currently focused on English-language discovery.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Why rankings change</h2>
        <p>Rankings are dynamic.</p>
        <p>
          A podcast or episode may move as new content is published, the catalog grows,
          metadata improves, feeds change, or the system develops a better understanding
          of the content.
        </p>
        <p>
          This is intentional. Podcast discovery should reflect both long-term quality
          and what is currently relevant.
        </p>

        <h2 className="mt-10 text-xl font-semibold">AI and human oversight</h2>
        <p>
          AI helps Podiverzum understand and organize podcast content at scale.
        </p>
        <p>
          Human oversight helps us improve the system, review feedback and correct issues
          where automated analysis gets something wrong.
        </p>
        <p>
          If you notice a missing podcast, a duplicate feed, a weak result, a
          misclassified topic or an episode that should not appear, please use the
          in-app feedback button.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Our ranking principle</h2>
        <p>Podiverzum is built to reward useful, high-quality podcast content.</p>
        <p className="!mb-1">Not hype.</p>
        <p className="!my-1">Not payment.</p>
        <p className="!mt-1">Not manipulation.</p>
        <p>
          The aim is simple: help listeners find episodes worth their time.
        </p>

        <div className="not-prose mt-12 flex flex-wrap gap-3">
          <Link
            to="/about"
            className="px-4 py-2 rounded-md bg-secondary text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            ← About Podiverzum
          </Link>
        </div>
      </article>
    </Layout>
  );
}
