import { Link } from "react-router-dom";
import { BrandMark } from "./Brand";

export function SiteFooter() {
  return (
    <footer className="border-t border-border/70 mt-20 bg-gradient-to-b from-transparent to-secondary/40">
      <div className="container mx-auto py-12 text-sm text-muted-foreground">
        <div className="flex flex-wrap gap-6 items-start justify-between">
          <div className="space-y-3 max-w-sm">
            <BrandMark size={24} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Episode-first podcast discovery. Find episodes by topic, person,
              company, ticker, ingredient or idea.
            </p>
            <div className="inline-flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-50 animate-ping motion-reduce:hidden" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
              </span>
              Live index · updated continuously
            </div>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
            <Link to="/categories" className="hover:text-foreground transition-colors">Categories</Link>
            <Link to="/search" className="hover:text-foreground transition-colors">Search</Link>
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          </nav>
        </div>
        <div className="mt-8 pt-6 border-t border-border/70 flex flex-wrap gap-2 items-center justify-between text-xs">
          <span>© {new Date().getFullYear()} Podiverzum</span>
          <span className="opacity-80">
            Indexed from public RSS feeds · Ranked by freshness, feed health and episode relevance.
          </span>
        </div>
      </div>
    </footer>
  );
}
