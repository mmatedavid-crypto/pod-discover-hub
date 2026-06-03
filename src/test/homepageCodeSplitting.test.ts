import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("homepage code splitting", () => {
  it("keeps below-the-fold homepage modules out of the initial Index chunk", () => {
    const index = read("src/pages/Index.tsx");

    expect(index).toContain('import { lazy, Suspense, useEffect');
    expect(index).toContain('const MoodCollections = lazy(() => import("@/components/MoodCollections")');
    expect(index).toContain('const PersonalizedHomeRails = lazy(() => import("@/components/home/PersonalizedHomeRails")');
    expect(index).toContain('const WeeklyEditorialStrip = lazy(() => import("@/components/WeeklyEditorialStrip")');
    expect(index).toContain("<Suspense fallback={null}>");
    expect(index).not.toContain('import { MoodCollections } from "@/components/MoodCollections"');
    expect(index).not.toContain('import { PersonalizedHomeRails } from "@/components/home/PersonalizedHomeRails"');
    expect(index).not.toContain('import WeeklyEditorialStrip from "@/components/WeeklyEditorialStrip"');
  });

  it("keeps the weekly editorial strip visible even before the first published issue", () => {
    const strip = read("src/components/WeeklyEditorialStrip.tsx");

    expect(strip).toContain('const href = post ? `/heti/${hetiSlug(post)}` : "/heti"');
    expect(strip).toContain('const title = post?.title || "A heti válogatás készül"');
    expect(strip).toContain("Friss epizódok a Hetiben");
    expect(strip).not.toContain("if (!post) return null");
  });
});
