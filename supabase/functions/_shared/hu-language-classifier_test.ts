import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { classifyHungarianPodcastCandidate } from "./hu-language-classifier.ts";

Deno.test("HU podcast with empty RSS lang is accepted", () => {
  const r = classifyHungarianPodcastCandidate({
    title: "Partizán Podcast",
    description: "Heti politikai és közéleti beszélgetések a Partizán műsorvezetőivel. Minden héten új vendég, izgalmas téma a magyar közéletből.",
    rss_language: "",
    website_url: "https://partizan.hu",
    episode_titles: [
      "Orbán Viktor és a magyar gazdaság jövője",
      "Mi lesz a tanárokkal? Beszélgetés egy iskolaigazgatóval",
      "Brüsszel és Budapest – újabb csörte",
      "Vendég a stúdióban: Magyar Péter",
      "Heti hírek és politikai elemzés",
    ],
  });
  assertEquals(r.language_decision, "accept_hungarian");
});

Deno.test("Cybersecurity Headlines is rejected as English", () => {
  const r = classifyHungarianPodcastCandidate({
    title: "Cybersecurity Headlines",
    description: "The daily cybersecurity news and headlines podcast for security professionals. Stay up to date with the latest threats, breaches, and best practices.",
    rss_language: "en",
    rss_url: "https://cisoseries.com/cybersecurity-headlines",
    episode_titles: [
      "Daily news headlines for security teams",
      "Top cybersecurity stories of the week",
      "New ransomware attack on healthcare systems",
      "What you need to know about today's breach",
      "Weekly podcast review: best of cyber news",
    ],
  });
  assertEquals(r.language_decision, "reject_foreign");
  assertEquals(r.detected_language, "en");
});

Deno.test("SANS Internet Stormcenter is rejected as English", () => {
  const r = classifyHungarianPodcastCandidate({
    title: "SANS Internet Stormcenter Daily Cyber Security Podcast",
    description: "A brief daily summary of what is important in cyber security from the SANS Internet Stormcenter handlers.",
    rss_language: "en-US",
    rss_url: "https://isc.sans.edu/podcast.xml",
    website_url: "https://sans.org",
    episode_titles: [
      "Daily Stormcaster: phishing campaign update",
      "What is happening with the new vulnerability today",
      "Weekly handler podcast: top security stories",
      "How to detect this attack in your network",
      "Episode 8000: the week in review",
    ],
  });
  assertEquals(r.language_decision, "reject_foreign");
});

Deno.test("The Big Picture is rejected", () => {
  const r = classifyHungarianPodcastCandidate({
    title: "The Big Picture",
    description: "Sean Fennessey and Amanda Dobbins discuss the latest movies, talking through Hollywood news, reviews, and interviews with directors.",
    rss_language: "en",
    rss_url: "https://feeds.megaphone.fm/the-big-picture",
    website_url: "https://theringer.com",
    episode_titles: [
      "The best movies of the year",
      "Top 5 films we are talking about this week",
      "Interview with a Hollywood director",
      "Weekly movie reviews and news",
      "What we are watching now",
    ],
  });
  assertEquals(r.language_decision, "reject_foreign");
});

Deno.test("Arabic-script feed is hard rejected", () => {
  const r = classifyHungarianPodcastCandidate({
    title: "بودكاست الأخبار اليومية",
    description: "بودكاست يومي يقدم آخر الأخبار والتحليلات السياسية والاقتصادية من جميع أنحاء العالم العربي.",
    rss_language: "ar",
    episode_titles: [
      "أخبار اليوم: ما يحدث في المنطقة",
      "تحليل سياسي: الانتخابات القادمة",
      "حلقة جديدة: ضيف خاص في الاستوديو",
    ],
  });
  assertEquals(r.language_decision, "reject_foreign");
  assertEquals(r.detected_language, "arabic");
});

Deno.test("HU podcast with hu RSS lang accepted", () => {
  const r = classifyHungarianPodcastCandidate({
    title: "Heti Beszélgetés",
    description: "Magyar közéleti és kulturális beszélgetések minden héten.",
    rss_language: "hu-HU",
    episode_titles: ["Vendég a stúdióban", "Heti hírek", "Új évad indul"],
  });
  assertEquals(r.language_decision, "accept_hungarian");
});

Deno.test("Empty / very short metadata goes to review", () => {
  const r = classifyHungarianPodcastCandidate({
    title: "Test",
    description: "",
    rss_language: "",
    episode_titles: [],
  });
  assertEquals(r.language_decision, "review_uncertain");
});

Deno.test("Bilingual goes to review, not auto-reject", () => {
  const r = classifyHungarianPodcastCandidate({
    title: "Tech Talk Magyar / English",
    description: "Beszélgetések magyar és angol nyelven a technológiáról és podcasting-ról. A Hungarian and English podcast about technology.",
    rss_language: "",
    episode_titles: [
      "Az új iPhone és a mesterséges intelligencia",
      "Interview with a Silicon Valley founder",
      "Magyar startup hírek a héten",
      "What is happening in tech this week",
    ],
  });
  assertEquals(r.language_decision === "accept_hungarian" || r.language_decision === "review_uncertain", true);
});

Deno.test("HU podcast with bilingual marketing copy NOT rejected (Friderikusz)", () => {
  const r = classifyHungarianPodcastCandidate({
    title: "Friderikusz Podcast",
    description: "A Friderikusz Podcast egy heti rendszerességgel jelentkező magyar nyelvű beszélgetős műsor, ahol Friderikusz Sándor a vendégekkel a hét legfontosabb közéleti, kulturális és gazdasági témáit beszéli ki. New episode every week.",
    rss_language: "hu",
    episode_titles: [
      "Heti vendég: a magyar gazdaság helyzete",
      "Friderikusz Sándor: így működik a közélet",
      "Új évad indul: minden héten új vendég",
      "Beszélgetés a magyar kultúráról",
    ],
  });
  if (r.language_decision === "reject_foreign") {
    throw new Error(`HU podcast was rejected! hu=${r.hungarian_score} foreign=${r.foreign_score} evidence=${JSON.stringify(r.evidence)}`);
  }
});

Deno.test("HU podcast with English title accent NOT rejected (Apaidő)", () => {
  const r = classifyHungarianPodcastCandidate({
    title: "Apaidő",
    description: "Magyar apák beszélgetnek a gyereknevelésről, a családi életről és arról, milyen ma apának lenni Magyarországon.",
    rss_language: "",
    episode_titles: [
      "Hogyan beszéljünk a gyerekkel a nehéz dolgokról",
      "Apaként a karrier és a család között",
      "Magyar apák őszintén",
    ],
  });
  if (r.language_decision === "reject_foreign") {
    throw new Error(`HU podcast was rejected! hu=${r.hungarian_score} foreign=${r.foreign_score}`);
  }
});
