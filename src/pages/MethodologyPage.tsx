import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function MethodologyPage() {
  useEffect(() => {
    setSeo({
      title: "How Podiverzum ranks podcasts and episodes — Methodology",
      description:
        "Podiverzum's ranking formula: freshness, feed health, AI-extracted entities, editorial quality signals and tier-based prioritization. No paid placement.",
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground mb-2">Methodology</div>
        <h1 className="text-3xl font-semibold mb-2">How we rank</h1>
        <p className="text-muted-foreground !mt-2">
          Every podcast and episode in Podiverzum gets a score. Here's what goes into it,
          in plain English.
        </p>

        <h2 className="mt-10 text-xl font-semibold">No paid placement</h2>
        <p>
          We do not sell ranking, featured slots or visibility. Every podcast is ranked by
          the same formula, regardless of audience size, deal or relationship.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Podcast tiers (S, A, B, C, E)</h2>
        <p>
          Each podcast is bucketed into a tier based on a composite score:
        </p>
        <ul className="list-disc pl-5">
          <li><strong>S</strong> — top-quality, consistently active shows with healthy feeds and rich metadata.</li>
          <li><strong>A</strong> — strong shows that publish reliably with good content depth.</li>
          <li><strong>B</strong> — solid mid-tier shows; surfaced contextually.</li>
          <li><strong>C</strong> — long-tail shows; surfaced primarily via search and entity pages.</li>
          <li><strong>E</strong> — excluded from public ranking surfaces (stale feeds, spam, duplicates).</li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">What goes into the score</h2>
        <ul className="list-disc pl-5">
          <li><strong>Feed health</strong> — does the RSS feed work, parse cleanly, deliver real audio?</li>
          <li><strong>Publishing cadence</strong> — is the show alive and producing recent episodes?</li>
          <li><strong>Episode metadata depth</strong> — full descriptions, chapters, real titles vs. dump strings.</li>
          <li><strong>AI-extracted entities</strong> — people, companies, tickers, topics actually discussed.</li>
          <li><strong>Editorial quality signals</strong> — title cleanliness, image presence, language clarity.</li>
          <li><strong>Engagement signals</strong> — internal click and search behaviour, anonymized.</li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">How episodes are ranked</h2>
        <p>
          On the homepage and category pages, episodes are sorted by a composite of:
        </p>
        <ul className="list-disc pl-5">
          <li><strong>Freshness</strong> — newer episodes carry more weight, with a steep falloff after 30 days.</li>
          <li><strong>Parent podcast tier</strong> — S- and A-tier shows surface first.</li>
          <li><strong>Relevance</strong> — entity matches, topic overlap, and editorial signals.</li>
          <li><strong>Diversity</strong> — we cap each podcast to keep the homepage varied.</li>
        </ul>
        <p>
          The "Trending episodes" shelf only includes episodes from the last 14 days.
          "Timeless episodes" pulls from S-tier shows, 30+ days old, with AI-summarized content.
        </p>

        <h2 className="mt-10 text-xl font-semibold">Entity pages</h2>
        <p>
          Pages like <code>/person/sam-altman</code> or <code>/company/nvidia</code> are
          built from AI-extracted entity tags. We require a minimum of 5 indexed episodes
          before an entity page is exposed to search engines.
        </p>

        <h2 className="mt-10 text-xl font-semibold">What we exclude</h2>
        <ul className="list-disc pl-5">
          <li>Dead or perpetually broken RSS feeds.</li>
          <li>Confirmed spam, duplicate or low-quality dump feeds.</li>
          <li>Empty shows with zero indexable episodes.</li>
          <li>Adult, hateful or unsafe content surfaces (default discovery only).</li>
        </ul>

        <h2 className="mt-10 text-xl font-semibold">Mistakes happen</h2>
        <p>
          AI extraction and ranking are imperfect. If you spot a bad rank, a mis-tagged
          entity, or a podcast that should be included or excluded — use the in-app
          feedback button. We review submissions manually.
        </p>

        <div className="not-prose mt-12 flex flex-wrap gap-3">
          <Link to="/about" className="px-4 py-2 rounded-md bg-secondary text-sm font-medium hover:bg-accent hover:text-accent-foreground transition-colors">
            ← About Podiverzum
          </Link>
        </div>
      </article>
    </Layout>
  );
}
