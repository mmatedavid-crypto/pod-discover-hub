import { Link } from "react-router-dom";
import { BrandMark } from "./Brand";

export function SiteFooter() {
  return (
    <footer className="border-t border-border mt-20">
      <div className="container mx-auto py-10 text-sm text-muted-foreground">
        <div className="flex flex-wrap gap-6 items-start justify-between">
          <div className="space-y-2 max-w-sm">
            <BrandMark size={24} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Episode-first podcast discovery. Find episodes by topic, person,
              company, ticker, ingredient or idea.
            </p>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link to="/categories" className="hover:text-foreground">Categories</Link>
            <Link to="/search" className="hover:text-foreground">Search</Link>
          </nav>
        </div>
        <div className="mt-8 pt-6 border-t border-border flex flex-wrap gap-2 items-center justify-between text-xs">
          <span>© {new Date().getFullYear()} Podiverzum</span>
          <span className="opacity-80">
            Indexed from public RSS feeds · Ranked by freshness, feed health and episode relevance.
          </span>
        </div>
      </div>
    </footer>
  );
}
