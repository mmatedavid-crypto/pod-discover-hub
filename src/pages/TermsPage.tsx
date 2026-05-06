import Layout from "@/components/Layout";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function TermsPage() {
  useEffect(() => {
    setSeo({
      title: "Terms — Podiverzum",
      description: "Terms for using Podiverzum, a podcast episode search and discovery engine built on public RSS feeds.",
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <h1 className="text-3xl font-semibold mb-2">Terms</h1>
        <p className="text-xs text-muted-foreground mb-8">Last updated {new Date().toLocaleDateString()}</p>

        <p>Podiverzum is a podcast episode search and discovery engine. By using the site you agree to the following.</p>

        <h2 className="mt-8 text-xl font-semibold">What Podiverzum is</h2>
        <p>Podiverzum helps you find podcast episodes by topic, person, company, ticker, ingredient and other ideas. Podcast content itself — including audio, descriptions and artwork — belongs to the original creators and publishers. Podiverzum indexes <strong>public RSS feeds</strong> and links you back to the original podcast or platform.</p>

        <h2 className="mt-8 text-xl font-semibold">No guarantee of accuracy</h2>
        <p>Search results, summaries, rankings and entity tags are generated automatically. They may be incomplete, out of date or imperfect. Use Podiverzum as a starting point, not a source of truth.</p>

        <h2 className="mt-8 text-xl font-semibold">Listening to podcasts</h2>
        <p>When you click through to listen, you are using the original podcast publisher or a third-party platform (Apple, Spotify, YouTube, the show's own site, etc.). Their terms and privacy policies apply.</p>

        <h2 className="mt-8 text-xl font-semibold">Acceptable use</h2>
        <ul className="list-disc pl-5">
          <li>Don't scrape Podiverzum in a way that disrupts the service.</li>
          <li>Don't use the site to harass other users or misrepresent podcasts.</li>
          <li>Don't try to break, probe or abuse the platform.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Beta</h2>
        <p>Podiverzum is currently in closed beta. Features, data and rankings may change without notice.</p>

        <h2 className="mt-8 text-xl font-semibold">Contact</h2>
        <p>Use the in-app feedback button for questions or to report an issue.</p>
      </article>
    </Layout>
  );
}
