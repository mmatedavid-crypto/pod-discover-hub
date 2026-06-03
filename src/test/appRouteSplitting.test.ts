import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("app route splitting", () => {
  it("keeps non-home pages out of the initial route bundle", () => {
    const app = read("src/App.tsx");

    expect(app).toContain('import { lazy, Suspense } from "react"');
    expect(app).toContain('import Index from "./pages/Index.tsx"');
    expect(app).toContain('const StartSwipePage = lazy(() => import("./pages/StartSwipePage.tsx"))');
    expect(app).toContain('const AdminPage = lazy(() => import("./pages/AdminPage.tsx"))');
    expect(app).toContain('const PodcastDetail = lazy(() => import("./pages/PodcastDetail.tsx"))');
    expect(app).toContain("<Suspense fallback={<RouteLoading />}>");
    expect(app).not.toContain('import StartSwipePage from "./pages/StartSwipePage.tsx"');
    expect(app).not.toContain('import AdminPage from "./pages/AdminPage.tsx"');
  });
});
