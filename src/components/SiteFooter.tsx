import { Link } from "react-router-dom";

export function SiteFooter() {
  return (
    <footer className="border-t border-border mt-16">
      <div className="container mx-auto py-8 text-sm text-muted-foreground space-y-3">
        <div className="flex flex-wrap gap-4 items-center justify-between">
          <div>© {new Date().getFullYear()} Podiverzum — episode-first podcast discovery.</div>
          <div className="flex gap-4">
            <Link to="/categories" className="hover:text-foreground">Categories</Link>
            <Link to="/search" className="hover:text-foreground">Search</Link>
            <Link to="/growth-status" className="hover:text-foreground">Growth status</Link>
            <Link to="/admin" className="hover:text-foreground">Admin</Link>
          </div>
        </div>
        <div className="text-xs opacity-80">
          Indexed from public RSS feeds. Ranked by freshness, feed health and episode relevance.
        </div>
      </div>
    </footer>
  );
}
