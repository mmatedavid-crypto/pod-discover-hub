import { Link } from "react-router-dom";
import { BrandMark } from "./Brand";

export function SiteFooter() {
  return (
    <footer className="relative border-t border-border/70 mt-24 bg-gradient-to-b from-transparent to-black/40">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="container mx-auto py-14 text-sm text-muted-foreground">
        <div className="flex flex-wrap gap-10 items-start justify-between">
          <div className="space-y-4 max-w-sm">
            <BrandMark size={28} tagline />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Premium podcast discovery. Search episodes by topic, person,
              company, ticker, ingredient or idea.
            </p>
            <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="pulse-red" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--brand-red)/0.9)]" />
              </span>
              Live index · updated continuously
            </div>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link to="/categories" className="hover:text-foreground transition-colors">Categories</Link>
            <Link to="/search" className="hover:text-foreground transition-colors">Search</Link>
            <Link to="/new" className="hover:text-foreground transition-colors">New</Link>
            <Link to="/about" className="hover:text-foreground transition-colors">About</Link>
            <Link to="/methodology" className="hover:text-foreground transition-colors">How we rank</Link>
            
            <Link to="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
            <Link to="/terms" className="hover:text-foreground transition-colors">Terms</Link>
          </nav>
        </div>
        <div className="mt-10 pt-6 border-t border-border/70 flex flex-wrap gap-2 items-center justify-between text-xs">
          <span>© {new Date().getFullYear()} Podiverzum · Find it. Hear it.</span>
          <span className="opacity-70">
            Indexed from public RSS feeds · Ranked by freshness, feed health & relevance.
          </span>
        </div>
      </div>
    </footer>
  );
}
