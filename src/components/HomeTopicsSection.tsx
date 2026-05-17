import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";

const PRIORITY = [
  { slug: "mesterseges-intelligencia", name: "Mesterséges intelligencia" },
  { slug: "magyar-gazdasag", name: "Magyar gazdaság" },
  { slug: "befektetes", name: "Befektetés" },
  { slug: "magyar-politika", name: "Magyar politika" },
  { slug: "pszichologia", name: "Pszichológia" },
  { slug: "egeszseges-eletmod", name: "Egészséges életmód" },
  { slug: "film", name: "Film" },
  { slug: "tortenelem", name: "Történelem" },
  { slug: "foci", name: "Foci" },
  { slug: "vallalkozas", name: "Vállalkozás" },
  { slug: "true-crime", name: "True crime" },
  { slug: "parkapcsolat", name: "Párkapcsolat" },
];

export function HomeTopicsSection() {
  return (
    <section className="relative">
      {/* Subtle brand spot */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-8 h-40 opacity-60"
        style={{ background: "var(--gradient-spot)" }}
      />

      <div className="relative space-y-6">
        {/* Header */}
        <div className="flex items-end justify-between gap-4 border-b border-border pb-5">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[0.22em] text-primary font-semibold">
              Témák
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mt-2">
              Podcast témák szerint
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
              Fedezz fel magyar podcast epizódokat témák, ügyek, személyek és érdeklődési körök alapján.
            </p>
          </div>
          <Link
            to="/temak"
            className="hidden sm:inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary-foreground hover:bg-primary px-3 py-1.5 rounded-full border border-primary/40 transition-colors whitespace-nowrap"
          >
            Összes téma
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        {/* Numbered topic grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-xl overflow-hidden border border-border">
          {PRIORITY.map((t, i) => (
            <Link
              key={t.slug}
              to={`/temak/${t.slug}`}
              className="group relative flex items-center justify-between gap-3 bg-card px-4 py-4 hover:bg-secondary transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="text-[11px] tabular-nums text-muted-foreground group-hover:text-primary font-mono w-6 shrink-0">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span className="font-medium text-sm sm:text-base truncate group-hover:text-foreground">
                  {t.name}
                </span>
              </div>
              <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all shrink-0" />
              {/* Left brand bar on hover */}
              <span
                aria-hidden
                className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary scale-y-0 group-hover:scale-y-100 transition-transform origin-top"
              />
            </Link>
          ))}
        </div>

        <div className="sm:hidden">
          <Link to="/temak" className="inline-flex items-center gap-1.5 text-sm text-primary">
            Összes téma <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
