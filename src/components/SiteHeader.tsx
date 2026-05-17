import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Search, LayoutGrid } from "lucide-react";
import { BrandMark } from "./Brand";
import { NavLink } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";
import { supabase } from "@/integrations/supabase/client";

export function SiteHeader() {
  const [q, setQ] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const [loadingSugg, setLoadingSugg] = useState(false);
  const nav = useNavigate();
  const isHome = useLocation().pathname === "/";
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    abortRef.current?.abort();
    const trimmed = q.trim();
    if (trimmed.length < 2) { setSuggestions([]); setLoadingSugg(false); return; }
    setLoadingSugg(true);
    debounceRef.current = setTimeout(async () => {
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      try {
        const { data, error } = await supabase.functions.invoke("search-suggest", {
          body: { prefix: trimmed },
        });
        if (!error && Array.isArray(data?.suggestions)) setSuggestions(data.suggestions.slice(0, 5));
      } catch { /* ignore */ }
      finally { setLoadingSugg(false); }
    }, 220);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q]);

  const submit = (val: string) => {
    const v = val.trim();
    if (!v) return;
    setOpen(false);
    nav(`/kereses?q=${encodeURIComponent(v)}`);
  };

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `relative text-sm transition-colors ${
      isActive ? "text-foreground" : "text-muted-foreground hover:text-foreground"
    } after:content-[''] after:absolute after:left-0 after:-bottom-1 after:h-px after:bg-primary after:transition-all ${
      isActive ? "after:w-full" : "after:w-0 hover:after:w-full"
    }`;

  return (
    <header className="border-b border-border/70 bg-background/80 backdrop-blur-xl sticky top-0 z-30 supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex items-center gap-3 sm:gap-6 py-2 sm:py-3">
        <BrandMark />
        <nav className="hidden sm:flex items-center gap-6 ml-2 pl-6 border-l border-border/50">
          <NavLink to="/napi" className={linkCls}>Napi</NavLink>
          <span aria-hidden className="h-4 w-px bg-border/50" />
          <NavLink to="/kategoriak" className={linkCls}>Kategóriák</NavLink>
          <span aria-hidden className="h-4 w-px bg-border/50" />
          <NavLink to="/temak" className={linkCls}>Témák</NavLink>
          <span aria-hidden className="h-4 w-px bg-border/50" />
          <NavLink to="/szemelyek" className={linkCls}>Személyek</NavLink>
        </nav>
        {isHome && (
          <NavLink
            to="/kategoriak"
            className="ml-auto sm:hidden inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <LayoutGrid className="h-4 w-4" />
            Kategóriák
          </NavLink>
        )}
        <div ref={wrapRef} className={`sm:ml-auto relative w-full max-w-sm ${isHome ? "hidden" : "block sm:block"}`}>
          <form
            onSubmit={(e) => { e.preventDefault(); submit(q); }}
            className="relative focus-brand rounded-md transition-shadow"
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              placeholder="Keress epizódot…"
              className="w-full pl-9 pr-12 py-2 rounded-md bg-card border border-border focus:border-primary/60 outline-none text-sm transition-colors placeholder:text-muted-foreground/70"
            />
            <kbd className="hidden md:inline-flex absolute right-2 top-1/2 -translate-y-1/2 items-center justify-center h-5 min-w-[20px] px-1.5 rounded border border-border bg-muted/40 text-[10px] font-medium text-muted-foreground/70 pointer-events-none">
              /
            </kbd>
          </form>
          {open && q.trim().length >= 2 && (suggestions.length > 0 || loadingSugg) && (
            <div className="absolute left-0 right-0 mt-1 rounded-md border border-border bg-popover shadow-lg overflow-hidden z-40">
              {loadingSugg && suggestions.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">Javaslatok…</div>
              )}
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); submit(s); }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2"
                >
                  <Search className="h-3 w-3 text-muted-foreground" />
                  <span>{s}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="ml-auto"><ThemeToggle /></div>
      </div>
    </header>
  );
}
