import { Link } from "react-router-dom";
import { BrandMark } from "./Brand";

const EXPLORE = [
  { to: "/temak", label: "Témák" },
  { to: "/szemelyek", label: "Személyek" },
  { to: "/kategoriak", label: "Podcast kategóriák" },
  { to: "/napi", label: "Friss epizódok" },
  { to: "/uj", label: "Új podcastok" },
  { to: "/kereses?q=legjobb+magyar+podcastok", label: "Legjobb magyar podcastok" },
  { to: "/modszertan", label: "Módszertan" },
];

const COMPANY = [
  { to: "/rolunk", label: "Rólunk" },
  { to: "/kapcsolat", label: "Kapcsolat" },
  { to: "/adatvedelem", label: "Adatvédelem" },
  { to: "/feltetelek", label: "Feltételek" },
];

export function SiteFooter() {
  return (
    <footer className="relative border-t border-border/70 mt-24 bg-gradient-to-b from-transparent to-black/40">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="container mx-auto py-12 sm:py-14 text-sm text-muted-foreground">
        <div className="flex flex-col gap-10 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="space-y-3 max-w-sm">
            <BrandMark size={28} />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Epizódok. Témák. Gondolatok.
            </p>
          </div>

          {/* Mobile: 2 tidy rows of 4 links each, evenly spaced. */}
          <nav className="sm:hidden grid grid-cols-4 gap-x-3 gap-y-3 text-xs">
            {[...EXPLORE, ...COMPANY].map((l) => (
              <Link
                key={l.to}
                to={l.to}
                className="text-center hover:text-foreground transition-colors whitespace-nowrap"
              >
                {l.label}
              </Link>
            ))}
          </nav>

          <nav className="hidden sm:flex sm:flex-wrap gap-x-6 gap-y-2 text-sm">
            {[...EXPLORE, ...COMPANY].map((l) => (
              <Link key={l.to} to={l.to} className="hover:text-foreground transition-colors">{l.label}</Link>
            ))}
          </nav>
        </div>
        <div className="mt-10 pt-6 border-t border-border/70 flex flex-col gap-2 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Podiverzum</span>
          <span className="opacity-70">Nyilvános RSS-csatornákból indexelve.</span>
        </div>
      </div>
    </footer>
  );
}
