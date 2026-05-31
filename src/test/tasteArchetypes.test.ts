import { describe, expect, it } from "vitest";
import { pickArchetype, scoreArchetypes } from "@/lib/tasteArchetypes";

describe("taste archetype scoring", () => {
  it("does not turn a mixed profile into public radar from weak public-affairs signals", () => {
    const decision = scoreArchetypes({
      közélet: 3,
      politika: 2,
      interjú: 2,
      "személyes történet": 1,
      életutak: 1,
    });

    expect(decision.rawWinner.id).toBe("public_radar");
    expect(decision.winner.id).toBe("story_collector");
    expect(pickArchetype({
      közélet: 3,
      politika: 2,
      interjú: 2,
      "személyes történet": 1,
      életutak: 1,
    }).id).toBe("story_collector");
  });

  it("still returns public radar when public-affairs interest is clearly dominant", () => {
    const decision = scoreArchetypes({
      közélet: 5,
      politika: 4,
      "magyar közélet": 3,
      társadalom: 2,
      demokrácia: 2,
      interjú: 1,
    });

    expect(decision.winner.id).toBe("public_radar");
    expect(decision.explicitPublicSignals).toBeGreaterThanOrEqual(4);
    expect(decision.publicScore).toBeGreaterThanOrEqual(decision.bestNonPublicScore + 8);
  });
});
