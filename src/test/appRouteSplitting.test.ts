import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(`${root}/${path}`, "utf8");

describe("app route splitting", () => {
  it("keeps non-home pages out of the initial route bundle", () => {
    const app = read("src/App.tsx");

    expect(app).toContain('import { lazy, Suspense } from "react"');
    expect(app).toContain('const Index = lazy(() => import("./pages/Index.tsx"))');
    expect(app).toContain('const StartSwipePage = lazy(() => import("./pages/StartSwipePage.tsx"))');
    expect(app).toContain('const AdminPage = lazy(() => import("./pages/AdminPage.tsx"))');
    expect(app).toContain('const PodcastDetail = lazy(() => import("./pages/PodcastDetail.tsx"))');
    expect(app).toContain('const SmartPlayerBar = lazy(() => import("./components/smart-player/SmartPlayerBar")');
    expect(app).toContain("<Suspense fallback={<RouteLoading />}>");
    expect(app).toContain("<SmartPlayerBar />");
    expect(app).not.toContain('import StartSwipePage from "./pages/StartSwipePage.tsx"');
    expect(app).not.toContain('import Index from "./pages/Index.tsx"');
    expect(app).not.toContain('import AdminPage from "./pages/AdminPage.tsx"');
    expect(app).not.toContain('import { SmartPlayerBar } from "./components/smart-player/SmartPlayerBar"');
  });

  it("keeps the global error recovery from wiping unrelated browser storage", () => {
    const boundary = read("src/components/AppErrorBoundary.tsx");

    expect(boundary).toContain("handleReload");
    expect(boundary).toContain("handleRepair");
    expect(boundary).toContain("window.localStorage.removeItem(key)");
    expect(boundary).toContain("window.sessionStorage.removeItem(key)");
    expect(boundary).toContain("Oldal újratöltése");
    expect(boundary).toContain("Podiverzum helyi állapot törlése");
    expect(boundary).not.toContain("window.localStorage.clear()");
    expect(boundary).not.toContain("window.sessionStorage.clear()");
  });
});
