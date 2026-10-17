import { beforeEach, describe, expect, it, vi } from "vitest";

describe("anonymous page-to-play attribution", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("uses the landing page ID for subsequent player events", async () => {
    sessionStorage.setItem("pv_sid", "landing-session");
    sessionStorage.setItem("podiverzum_player_session", "unrelated-player-session");
    const { getAnalyticsSessionId } = await import("../lib/analyticsSession");
    expect(getAnalyticsSessionId()).toBe("landing-session");
    expect(getAnalyticsSessionId()).toBe("landing-session");
  });

  it("retains an existing player ID when there is no landing ID yet", async () => {
    sessionStorage.setItem("podiverzum_player_session", "existing-player-session");
    const { getAnalyticsSessionId } = await import("../lib/analyticsSession");
    expect(getAnalyticsSessionId()).toBe("existing-player-session");
    expect(sessionStorage.getItem("pv_sid")).toBe("existing-player-session");
  });

  it("creates and persists the same ID for a new page and player", async () => {
    const { getAnalyticsSessionId } = await import("../lib/analyticsSession");
    const pageId = getAnalyticsSessionId();
    expect(pageId.length).toBeGreaterThan(0);
    expect(getAnalyticsSessionId()).toBe(pageId);
    expect(sessionStorage.getItem("pv_sid")).toBe(pageId);
  });

  it("keeps a stable in-memory ID if storage is unavailable", async () => {
    vi.stubGlobal("sessionStorage", { getItem: () => { throw new Error("blocked"); } });
    const { getAnalyticsSessionId } = await import("../lib/analyticsSession");
    const pageId = getAnalyticsSessionId();
    expect(pageId).not.toBe("no-session");
    expect(getAnalyticsSessionId()).toBe(pageId);
    vi.unstubAllGlobals();
  });
});