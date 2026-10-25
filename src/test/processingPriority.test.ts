import { describe, expect, it } from "vitest";
import { boundedWork, priorityBlocker } from "../../supabase/functions/_shared/processing-priority";

describe("visitor-first background processing", () => {
  it("processes episode searchability before person relationships", () => {
    expect(priorityBlocker("person_relevance", { embed_chunks_missing: 1 })).toBe("embed_chunks_missing");
    expect(priorityBlocker("person_relevance", { seo_jobs_pending: 1 })).toBe("seo_jobs_pending");
    expect(priorityBlocker("person_relevance", {})).toBeNull();
  });
  it("processes public person relationships before Astra", () => {
    expect(priorityBlocker("entity_astra_audit", { public_person_mentions_pending: 1 })).toBe("public_person_mentions_pending");
    expect(priorityBlocker("person_relevance", { public_person_mentions_pending: 1 })).toBeNull();
  });
  it("does not hold back the external OpenAI person batch for visitor queues", () => {
    expect(priorityBlocker("person_relevance_openai_batch", { clean_text_pending: 2, embed_chunks_missing: 2 })).toBeNull();
    expect(priorityBlocker("person_relevance", { clean_text_pending: 2 })).toBe("clean_text_pending");
    expect(priorityBlocker("entity_astra_audit", { episode_classifier_pending: 1 })).toBe("episode_classifier_pending");
  });
  it("cannot increase a configured batch or concurrency through a request", () => {
    expect(boundedWork(800, 40, 30)).toBe(40);
    expect(boundedWork(250, 2, 1)).toBe(2);
    expect(boundedWork(4, 1, 1)).toBe(1);
  });
});