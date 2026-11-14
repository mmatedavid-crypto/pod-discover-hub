import { describe, expect, it } from "vitest";
import { pageViewDecision, type PageViewState } from "@/lib/pageViewDedupe";

const fresh = (): PageViewState => ({ lastKey: null, lastAt: 0, prevUrl: null });

describe("first-party page view decisions", () => {
  it("drops the same route logged again within 5 seconds (remount copy)", () => {
    const s = fresh();
    expect(pageViewDecision(s, "/a", "https://podiverzum.hu/a", "https://www.google.com/", 1000).log).toBe(true);
    expect(pageViewDecision(s, "/a", "https://podiverzum.hu/a", "https://www.google.com/", 1010).log).toBe(false);
  });

  it("logs the same route again after 5 seconds", () => {
    const s = fresh();
    pageViewDecision(s, "/a", "https://podiverzum.hu/a", null, 1000);
    expect(pageViewDecision(s, "/a", "https://podiverzum.hu/a", null, 6001).log).toBe(true);
  });

  it("uses the external referrer only for the first view; later views get the previous in-app URL", () => {
    const s = fresh();
    expect(pageViewDecision(s, "/a", "https://podiverzum.hu/a", "https://www.google.com/", 1000).referrer).toBe("https://www.google.com/");
    expect(pageViewDecision(s, "/b", "https://podiverzum.hu/b", "https://www.google.com/", 2000).referrer).toBe("https://podiverzum.hu/a");
  });
});
