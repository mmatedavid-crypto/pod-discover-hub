import { describe, expect, it } from "vitest";
import {
  buildPodcastEmbeddingContent,
  PODCAST_EMBED_CONTENT_VERSION,
  podcastTopTopics,
} from "../../supabase/functions/_shared/podcast-embedding-content";

const input = {
  title: "Csillagászati Podcast",
  category: "Science & Ideas",
  description: "Beszélgetések az univerzumról. <b>Támogass:</b> https://example.com/tamogatas",
  map_topics: ["Tudomány", "Űrkutatás"],
  card_topics: ["tudomány", "fekete lyuk", ""],
  recent_titles: ["A sötét anyag nyomában", "Exobolygók"],
};

describe("podcast similarity embedding input", () => {
  it("is version 2", () => {
    expect(PODCAST_EMBED_CONTENT_VERSION).toBe(2);
  });

  it("never embeds rank tier or model name", () => {
    const text = buildPodcastEmbeddingContent(input);
    expect(text).not.toMatch(/RANK|MODEL/);
  });

  it("includes recent episode titles and topics, strips links and markup", () => {
    const text = buildPodcastEmbeddingContent(input);
    expect(text).toContain("- A sötét anyag nyomában");
    expect(text).toContain("Témák: tudomány, űrkutatás, fekete lyuk");
    expect(text).not.toContain("https://");
    expect(text).not.toContain("<b>");
  });

  it("dedupes topics case-insensitively and caps them at 15", () => {
    expect(podcastTopTopics(input)).toEqual(["tudomány", "űrkutatás", "fekete lyuk"]);
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`);
    expect(podcastTopTopics({ map_topics: many, card_topics: [] })).toHaveLength(15);
  });

  it("is deterministic for the same input", () => {
    expect(buildPodcastEmbeddingContent(input)).toBe(buildPodcastEmbeddingContent({ ...input }));
  });
});
