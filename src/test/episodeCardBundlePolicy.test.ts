import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("episode card bundle policy", () => {
  it("defers logged-in episode mark controls from anonymous feed cards", () => {
    const card = read("src/components/EpisodeCard.tsx");

    expect(card).toMatch(/import \{[^}]*lazy[^}]*Suspense[^}]*\} from "react"/);
    expect(card).toContain('const EpisodeMarks = lazy(() => import("./EpisodeMarks")');
    expect(card).toContain("function EpisodeMarksSlot");
    expect(card).toContain('className="ml-auto min-h-8 min-w-[76px]"');
    expect(card).not.toContain('import { EpisodeMarks } from "./EpisodeMarks"');
  });
});
