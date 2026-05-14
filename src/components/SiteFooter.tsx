import { Link } from "react-router-dom";
import { BrandMark } from "./Brand";

const LINKS = [
  { to: "/kategoriak", label: "Kategóriák" },
  { to: "/kereses", label: "Keresés" },
  { to: "/uj", label: "Új podcastok" },
  { to: "/rolunk", label: "Rólunk" },
  { to: "/modszertan", label: "Módszertan" },
  { to: "/adatvedelem", label: "Adatvédelem" },
  { to: "/feltetelek", label: "Feltételek" },
];

export function SiteFooter() {
  return (
    <footer className="relative border-t border-border/70 mt-24 bg-gradient-to-b from-transparent to-black/40">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/40 to-transparent" />
      <div className="container mx-auto py-12 sm:py-14 text-sm text-muted-foreground">
        <div className="flex flex-col gap-10 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <div className="space-y-4 max-w-sm">
            <BrandMark size={28} tagline />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Magyar podcastkereső. Keress podcast epizódokat téma, személy, cég vagy akár egy gondolat alapján.
            </p>
            <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="pulse-red" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--brand-red)/0.9)]" />
              </span>
              Élő index · folyamatosan frissül
            </div>
          </div>

          {/* Mobile: tidy grid of all links, evenly spaced. */}
          <nav className="sm:hidden grid grid-cols-3 gap-x-3 gap-y-3 text-xs">
            {LINKS.map((l) => (
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
            {LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="hover:text-foreground transition-colors">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-10 pt-6 border-t border-border/70 flex flex-col gap-2 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Podiverzum · Találd meg. Hallgasd meg.</span>
          <span className="opacity-70">
            Nyilvános RSS-csatornákból indexelve · Frissesség, relevancia és a forrás minősége alapján rangsorolva.
          </span>
        </div>
      </div>
    </footer>
  );
}
