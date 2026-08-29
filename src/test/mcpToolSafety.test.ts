import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  clampEvidencePhrase,
  normalizeEntityText,
  parseEpisodeRef,
  shapeSearchEpisode,
  stripForbidden,
  isPublicHungarianPodcast,
  isSafePersonMentionRow,
} from "@/lib/mcp/entityResolve";

const root = process.cwd();

describe("MCP entity resolution helpers", () => {
  it("folds accents and case for alias matching", () => {
    expect(normalizeEntityText(" Fábry  Kornél ")).toBe("fabry kornel");
    expect(normalizeEntityText("Mi Hazánk!")).toBe("mi hazank");
  });

  it("bounds evidence phrases", () => {
    expect(clampEvidencePhrase("  a   b ", 40)).toBe("a b");
    expect(clampEvidencePhrase("x".repeat(300), 160)!.length).toBe(160);
    expect(clampEvidencePhrase(null, 100)).toBeUndefined();
  });

  it("parses episode references", () => {
    expect(parseEpisodeRef("https://podiverzum.hu/podcast/partizan/valami")).toEqual({
      podcastSlug: "partizan",
      episodeSlug: "valami",
    });
    expect(parseEpisodeRef("11111111-2222-3333-4444-555555555555").id).toBeTruthy();
    expect(parseEpisodeRef("partizan/valami").episodeSlug).toBe("valami");
  });

  it("gates non-Hungarian or broken podcasts", () => {
    expect(isPublicHungarianPodcast({ language: "hu", language_decision: "accept_hungarian" })).toBe(true);
    expect(isPublicHungarianPodcast({ language: "en", language_decision: "confirmed_foreign" })).toBe(false);
    expect(isPublicHungarianPodcast({ language: "hu", rss_status: "failed" })).toBe(false);
  });

  it("drops rejected person mentions", () => {
    expect(isSafePersonMentionRow({ relevance_status: "rejected" })).toBe(false);
    expect(isSafePersonMentionRow({ relevance_status: "accepted" })).toBe(true);
  });
});

describe("MCP response shaping cannot leak transcript data", () => {
  it("strips transcript/chunk/debug fields from search results", () => {
    const shaped = shapeSearchEpisode({
      id: "e1",
      title: "Cím",
      slug: "cim",
      podcast_id: "p1",
      ai_summary: "Összefoglaló",
      why_matched: "téma egyezés",
      chunk_match: { content_snippet: "TITKOS ÁTIRAT", timestamp_start_seconds: 12 },
      podcasts: { slug: "show", title: "Show" },
    });
    const s = JSON.stringify(shaped);
    expect(s).not.toContain("TITKOS");
    expect(s).not.toContain("chunk_match");
    expect(shaped.source_url).toBe("https://podiverzum.hu/podcast/show/cim");
    expect(shaped.why_matched).toBe("téma egyezés");
  });

  it("stripForbidden removes nested forbidden keys", () => {
    const out = stripForbidden({ a: [{ transcript: "x", segments: [1], ok: 1, source_evidence: { e: 1 } }] }) as any;
    expect(out.a[0]).toEqual({ ok: 1 });
  });
});

describe("MCP tool sources do not select transcript content", () => {
  const files = ["find-mentions.ts", "get-episode-context.ts", "search-episodes.ts"].map((f) =>
    fs.readFileSync(path.join(root, "src/lib/mcp/tools", f), "utf8"),
  );

  it("never selects transcript, segments or chunk tables", () => {
    for (const src of files) {
      expect(src).not.toMatch(/episode_chunks/);
      expect(src).not.toMatch(/content_snippet/);
      expect(src).not.toMatch(/select\([^)]*\btranscript\b(?!s)/i);
      expect(src).not.toMatch(/\bsegments\b/);
    }
  });

  it("keeps the episode transcript read limited to the public_display flag", () => {
    const ctx = files[1];
    expect(ctx).toContain('select("public_display")');
    expect(ctx).toContain("transcript_available_for_public_display");
  });
});
