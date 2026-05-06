import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { Search } from "lucide-react";
import { BrandMark } from "./Brand";
import { NavLink } from "react-router-dom";

export function SiteHeader() {
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `relative text-sm transition-colors ${
      isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
    } after:content-[''] after:absolute after:left-0 after:-bottom-1 after:h-px after:bg-primary after:transition-all ${
      isActive ? "after:w-full" : "after:w-0 hover:after:w-full"
    }`;
  return (
    <header className="border-b border-border/70 bg-background/80 backdrop-blur-xl sticky top-0 z-30 supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex items-center gap-3 sm:gap-6 py-3">
        <BrandMark />
        <nav className="hidden sm:flex items-center gap-6 ml-2">
          <NavLink to="/categories" className={linkCls}>Categories</NavLink>
          <NavLink to="/search" className={linkCls}>Search</NavLink>
        </nav>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) nav(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
          className="ml-auto relative w-full max-w-sm focus-brand rounded-md transition-shadow"
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search episodes…"
            className="w-full pl-9 pr-3 py-2 rounded-md bg-card border border-border focus:border-primary/60 outline-none text-sm transition-colors placeholder:text-muted-foreground/70"
          />
        </form>
      </div>
    </header>
  );
}
