import { describe, expect, it } from "vitest";
import { parsePublicCleanDescription, publicSourceLabel } from "@/lib/publicCleanDescription";

const TEXT = "Ebben az adásban a magyar gazdaság helyzetéről beszélgetünk vendégünkkel.";

describe("public cleaned description", () => {
  it("shows YouTube text with its video link", () => {
    const r = parsePublicCleanDescription({ text: TEXT, source: "youtube", source_url: "https://www.youtube.com/watch?v=abc" });
    expect(r?.source).toBe("youtube");
    expect(r?.source_url).toBe("https://www.youtube.com/watch?v=abc");
  });

  it("shows Spotify text", () => {
    expect(parsePublicCleanDescription({ text: TEXT, source: "spotify", source_url: null })?.source).toBe("spotify");
  });

  it("never shows transcript text", () => {
    expect(parsePublicCleanDescription({ text: TEXT, source: "transcript", source_url: null })).toBeNull();
    expect(publicSourceLabel("transcript")).toBeNull();
  });

  it("drops non-source links", () => {
    expect(parsePublicCleanDescription({ text: TEXT, source: "youtube", source_url: "https://evil.example/x" })?.source_url).toBeNull();
  });
});
