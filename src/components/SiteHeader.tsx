import { useNavigate, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Search, LayoutGrid, Menu, Mic, User, Hash, Folder, Sparkles } from "lucide-react";
import { BrandMark } from "./Brand";
import { NavLink } from "react-router-dom";
import { ThemeToggle } from "./ThemeToggle";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetHeader } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useSearchSuggestions, computeGhost, GhostSuggestion } from "@/lib/useSearchGhost";

type Suggestion = GhostSuggestion;

const ICON: Record<Suggestion["type"], any> = {
  podcast: Mic,
  person: User,
  topic: Hash,
  category: Folder,
  query: Search,
};

export function SiteHeader() {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const nav = useNavigate();
  const isHome = useLocation().pathname === "/";
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const { suggestions, loading: loadingSugg } = useSearchSuggestions(q, 8);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const ghost = computeGhost(q, suggestions);

  const acceptGhost = () => {
    if (!ghost) return false;
    const completed = q + ghost;
    setQ(completed);
    setOpen(true);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (el) el.setSelectionRange(completed.length, completed.length);
    });
    return true;
  };

  const submitQuery = (val: string) => {
    const v = val.trim();
    if (!v) return;
    setOpen(false);
    nav(`/kereses?q=${encodeURIComponent(v)}`);
  };

  const pickSuggestion = (s: Suggestion) => {
    setOpen(false);
    setQ("");
    nav(s.href);
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
        <nav className="hidden lg:flex items-center gap-6 ml-2 pl-6 border-l border-border/50">
          <NavLink to="/napi" className={linkCls}>Mai válogatás</NavLink>
          <span aria-hidden className="h-4 w-px bg-border/50" />
          <NavLink to="/kategoriak" className={linkCls}>Podcast kategóriák</NavLink>
          <span aria-hidden className="h-4 w-px bg-border/50" />
          <NavLink to="/temak" className={linkCls}>Témák</NavLink>
          <span aria-hidden className="h-4 w-px bg-border/50" />
          <NavLink to="/szemelyek" className={linkCls}>Személyek</NavLink>
          <span aria-hidden className="h-4 w-px bg-border/50" />
          <NavLink to="/szervezetek" className={linkCls}>Szervezetek</NavLink>
        </nav>
        {isHome && (
          <NavLink
            to="/kategoriak"
            className="ml-auto hidden lg:inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <LayoutGrid className="h-4 w-4" />
            Podcast kategóriák
          </NavLink>
        )}




        <div ref={wrapRef} className={`lg:ml-auto relative w-full max-w-sm ${isHome ? "hidden" : "hidden lg:block"}`}>
          <form
            onSubmit={(e) => { e.preventDefault(); submitQuery(q); }}
            className="relative focus-brand rounded-md transition-shadow bg-card border border-border focus-within:border-primary/60"
            role="search"
          >
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
            {/* Ghost-text mirror: matches input font/padding exactly. The typed
                prefix is rendered invisibly so the muted suffix lines up
                perfectly behind the real input caret. */}
            {ghost && (
              <div
                aria-hidden="true"
                className="absolute inset-0 pl-9 pr-12 py-2 text-sm whitespace-pre overflow-hidden pointer-events-none flex items-center"
              >
                <span className="invisible">{q}</span>
                <span className="text-muted-foreground/50">{ghost}</span>
              </div>
            )}
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true); }}
              onFocus={() => setOpen(true)}
              onKeyDown={(e) => {
                if (!ghost) return;
                if (e.key === "Tab" && !e.shiftKey) {
                  e.preventDefault();
                  acceptGhost();
                  return;
                }
                if (e.key === "ArrowRight") {
                  const el = e.currentTarget;
                  if (el.selectionStart === q.length && el.selectionEnd === q.length) {
                    e.preventDefault();
                    acceptGhost();
                  }
                }
              }}
              placeholder="Keresés"
              aria-label="Keresés"
              aria-autocomplete="list"
              aria-expanded={open}
              autoComplete="off"
              spellCheck={false}
              className="relative w-full pl-9 pr-12 py-2 rounded-md bg-transparent outline-none text-sm transition-colors placeholder:text-muted-foreground/70"
            />
            {ghost && (
              <kbd className="hidden md:inline-flex absolute right-2 top-1/2 -translate-y-1/2 items-center justify-center h-5 min-w-[20px] px-1.5 rounded border border-border bg-muted/40 text-[10px] font-medium text-muted-foreground/70 pointer-events-none z-10">
                Tab
              </kbd>
            )}
          </form>
          {open && q.trim().length >= 2 && (suggestions.length > 0 || loadingSugg) && (
            <div
              role="listbox"
              className="absolute left-0 right-0 mt-1 rounded-md border border-border bg-popover shadow-lg overflow-hidden z-40 max-h-[70vh] overflow-y-auto"
            >
              {loadingSugg && suggestions.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">Javaslatok…</div>
              )}
              {suggestions.map((s, i) => {
                const Icon = ICON[s.type] || Search;
                return (
                  <button
                    key={`${s.type}:${s.label}:${i}`}
                    type="button"
                    role="option"
                    onMouseDown={(e) => { e.preventDefault(); pickSuggestion(s); }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent hover:text-accent-foreground flex items-center gap-2.5 border-b border-border/40 last:border-b-0"
                  >
                    {s.image_url ? (
                      <img
                        src={s.image_url}
                        alt=""
                        loading="lazy"
                        className="h-7 w-7 rounded object-cover bg-muted shrink-0"
                      />
                    ) : (
                      <span className="h-7 w-7 rounded bg-muted/60 flex items-center justify-center shrink-0">
                        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{s.label}</span>
                      {s.subtitle && (
                        <span className="block text-[11px] text-muted-foreground truncate">{s.subtitle}</span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Mobile hamburger menu — left of theme toggle */}
          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="Menü"
                className="lg:hidden inline-flex items-center justify-center h-9 w-9 rounded-md border border-border bg-card text-muted-foreground hover:text-foreground transition-colors"
              >
                <Menu className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="w-56 p-2 rounded-md border border-border bg-popover shadow-lg"
            >
              <nav className="flex flex-col gap-0.5">
                {[
                  { to: "/napi", label: "Mai válogatás" },
                  { to: "/kategoriak", label: "Podcast kategóriák" },
                  { to: "/temak", label: "Témák" },
                  { to: "/szemelyek", label: "Személyek" },
                  { to: "/szervezetek", label: "Szervezetek" },
                  { to: "/kereses", label: "Keresés" },
                ].map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    onClick={() => setMenuOpen(false)}
                    className={({ isActive }) =>
                      `px-3 py-2 rounded-md text-sm transition-colors ${
                        isActive
                          ? "bg-secondary text-foreground font-medium"
                          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground"
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </nav>
            </PopoverContent>
          </Popover>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
