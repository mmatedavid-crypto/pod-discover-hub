import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("episode thumbnail loading policy", () => {
  it("keeps blurred rail backgrounds cheap and low priority", () => {
    const card = read("src/components/EpisodeCard.tsx");

    expect(card).toContain('size="sm"');
    expect(card).toContain("imageSize={48}");
    expect(card).toContain("imageWidths={[48, 64, 96]}");
    expect(card).toContain('sizes="96px"');
    expect(card).toContain('fetchPriority="low"');
    expect(card).not.toContain('size="lg" className="h-full rounded-none border-0"');
  });

  it("keeps podcast episode thumbnails near rendered size", () => {
    const detail = read("src/pages/PodcastDetail.tsx");

    expect(detail).toContain("imageSize={96}");
    expect(detail).toContain("imageWidths={[64, 96, 160]}");
    expect(detail).toContain('sizes="(max-width: 640px) 64px, 80px"');
    expect(detail).not.toContain("imageWidths={[96, 160, 240]}");
  });
});
