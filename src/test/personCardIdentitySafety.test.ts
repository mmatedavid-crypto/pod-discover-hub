import { describe, expect, it } from "vitest";
import { buildPersonCardContextLine } from "@/components/PersonCard";

describe("person card identity safety", () => {
  it("does not show stale short_bio for ambiguous unapproved names", () => {
    const context = buildPersonCardContextLine({
      slug: "szabo-laszlo",
      name: "Szabó László",
      image_url: null,
      disambiguation_label: null,
      episode_count: 5,
      podcast_count: 3,
      short_bio: "Szabó László (1936–) magyar színész, filmrendező, forgatókönyvíró",
      ai_bio: "Szabó László gazdasági témákban szerepel magyar podcastokban.",
      identity_ambiguous: true,
      manual_approved: false,
      ai_bio_status: "needs_review",
      ai_bio_confidence: 0.6,
      wikipedia_match_status: "no_match",
      wikipedia_match_confidence: 0,
    });

    expect(context).toBeNull();
  });

  it("can still show a neutral explicit context line for mention-only people", () => {
    const context = buildPersonCardContextLine({
      slug: "donald-trump",
      name: "Donald Trump",
      episode_count: 100,
      podcast_count: 20,
      context_line: "Nemzetközi szereplő",
      identity_ambiguous: true,
      manual_approved: false,
      short_bio: "Wrong overconfident biography",
    });

    expect(context).toBe("Nemzetközi szereplő");
  });
});
