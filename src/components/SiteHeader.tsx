import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Search } from "lucide-react";

export function SiteHeader() {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  return (
    <header className="border-b border-border bg-background/95 backdrop-blur sticky top-0 z-30">
      <div className="container mx-auto flex items-center gap-4 py-3">
        <Link to="/" className="font-semibold text-lg tracking-tight">
          Podiverzum
        </Link>
        <nav className="hidden sm:flex items-center gap-5 text-sm text-muted-foreground">
          <Link to="/categories" className="hover:text-foreground">Categories</Link>
          <Link to="/search" className="hover:text-foreground">Search</Link>
        </nav>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
          className="ml-auto relative w-full max-w-sm"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="cooking + asparagus"
            className="w-full pl-9 pr-3 py-2 rounded-md bg-secondary border border-transparent focus:border-ring focus:bg-background outline-none text-sm"
          />
        </form>
      </div>
    </header>
  );
}
