import { describe, expect, it } from "vitest";
import { boundedWork, priorityBlocker } from "../../supabase/functions/_shared/processing-priority";

describe("visitor-first background processing", () => {
  it("processes episode searchability before person relationships", () => {
    expect(priorityBlocker("person_relevance", { embed_chunks_missing: 1 })).toBe("embed_chunks_missing");
    expect(priorityBlocker("person_relevance", { seo_jobs_pending: 1 })).toBe("seo_jobs_pending");
    expect(priorityBlocker("person_relevance", {})).toBeNull();
  });
  it("does not hold back the external OpenAI person batch for visitor queues", () => {
    expect(priorityBlocker("person_relevance_openai_batch", { clean_text_pending: 2, embed_chunks_missing: 2 })).toBeNull();
    expect(priorityBlocker("person_relevance", { clean_text_pending: 2 })).toBe("clean_text_pending");
  });
  it("does not hold back either Astra job (owner 2026-10-25: nothing waits on Astra)", () => {
    expect(priorityBlocker("entity_astra_audit", { episode_classifier_pending: 1, seo_jobs_pending: 2 })).toBeNull();
    expect(priorityBlocker("clean_text_astra_review", { clean_text_pending: 1, embed_chunks_missing: 2 })).toBeNull();
  });
  it("does not hold back the free person source lanes (owner 2026-11-14), but still gates the old judge", () => {
    expect(priorityBlocker("person_source_lanes", { clean_text_pending: 191, episode_classifier_pending: 448 })).toBeNull();
    expect(priorityBlocker("person_relevance", { episode_classifier_pending: 448 })).toBe("episode_classifier_pending");
  });
  it("cannot increase a configured batch or concurrency through a request", () => {
    expect(boundedWork(800, 40, 30)).toBe(40);
    expect(boundedWork(250, 2, 1)).toBe(2);
    expect(boundedWork(4, 1, 1)).toBe(1);
  });
});