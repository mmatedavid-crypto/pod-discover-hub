import Layout from "@/components/Layout";
import { useEffect } from "react";
import { setSeo } from "@/lib/seo";

export default function PrivacyPage() {
  useEffect(() => {
    setSeo({
      title: "Privacy — Podiverzum",
      description: "How Podiverzum handles your data: optional feedback, search analytics, no IP tracking, no sale of personal data.",
    });
  }, []);

  return (
    <Layout>
      <article className="container mx-auto py-12 max-w-2xl prose prose-invert prose-sm sm:prose-base">
        <h1 className="text-3xl font-semibold mb-2">Privacy</h1>
        <p className="text-xs text-muted-foreground mb-8">Last updated {new Date().toLocaleDateString()}</p>

        <p>Podiverzum is a podcast discovery engine. We aim to collect as little personal data as possible. This page explains what we collect and why.</p>

        <h2 className="mt-8 text-xl font-semibold">What we index</h2>
        <p>Podiverzum indexes <strong>public podcast RSS feeds</strong>. We do not host audio. Original audio and metadata belong to the podcasts and platforms that publish them.</p>

        <h2 className="mt-8 text-xl font-semibold">Feedback you send</h2>
        <p>If you use the in-app feedback button, we store what you submit so we can improve the product. A feedback record may include:</p>
        <ul className="list-disc pl-5">
          <li>your message</li>
          <li>an optional email address (only if you choose to provide one)</li>
          <li>the page URL where the feedback was sent</li>
          <li>your viewport size and user-agent string (to reproduce UI issues)</li>
          <li>your most recent search query, if you were on the search page</li>
        </ul>
        <p>Feedback is visible only to Podiverzum administrators.</p>

        <h2 className="mt-8 text-xl font-semibold">Search analytics</h2>
        <p>To improve search quality, we log each search with:</p>
        <ul className="list-disc pl-5">
          <li>the query text</li>
          <li>number of results returned</li>
          <li>whether a broader fallback was used</li>
          <li>your viewport width</li>
          <li>a timestamp</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Page analytics</h2>
        <p>We log basic page views such as route path, referrer, viewport size, timestamp and UTM campaign parameters when present.</p>

        <h2 className="mt-8 text-xl font-semibold">What we don't do</h2>
        <ul className="list-disc pl-5">
          <li>We do not intentionally store IP addresses.</li>
          <li>We do not sell personal data.</li>
          <li>We do not use third-party advertising trackers.</li>
        </ul>

        <h2 className="mt-8 text-xl font-semibold">Contact</h2>
        <p>The fastest way to reach us is the in-app feedback button. You can include an email address if you want a reply.</p>
      </article>
    </Layout>
  );
}
