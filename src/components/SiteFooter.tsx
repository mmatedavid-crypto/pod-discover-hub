import { Link } from "react-router-dom";
import { BrandMark } from "./Brand";
import { SITE_PUBLISHER } from "@/lib/sitePublisher";

const EXPLORE = [
  { to: "/napi", label: "Mai válogatás" },
  { to: "/kategoriak", label: "Podcast kategóriák" },
  { to: "/temak", label: "Témák" },
  { to: "/szemelyek", label: "Személyek" },
  { to: "/cegek", label: "Cégek és szervezetek" },
  { to: "/uj-podcastok", label: "Új podcastok" },
  { to: "/podcast-bekuldese", label: "Podcast beküldése" },
  { to: "/modszertan", label: "Módszertan" },
];

const RESEARCH = [
  { to: "/jelentes/magyar-podcast-piac-2026", label: "Magyar podcast piac 2026" },
  { to: "/jelentes/haboru-mint-tema-2026", label: "Háború mint téma 2026" },
];

const BUSINESS = [
  { to: "/intelligence", label: "Podiverzum Intelligence" },
];

const COMPANY = [
  { to: "/rolunk", label: "Rólunk" },
  { to: "/sajto", label: "Sajtó" },
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


          {/* Mobile: tidy grid of links + research callout. */}
          <div className="sm:hidden space-y-5">
            <nav className="grid grid-cols-2 gap-x-3 gap-y-3 text-xs">
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
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-foreground/70">Kutatásaink</p>
              <nav className="flex flex-col gap-1.5 text-xs">
                {RESEARCH.map((l) => (
                  <Link key={l.to} to={l.to} className="hover:text-foreground transition-colors">
                    {l.label}
                  </Link>
                ))}
              </nav>
            </div>
            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-wider text-foreground/70">Cégeknek</p>
              <nav className="flex flex-col gap-1.5 text-xs">
                {BUSINESS.map((l) => (
                  <Link key={l.to} to={l.to} className="hover:text-foreground transition-colors">
                    {l.label}
                  </Link>
                ))}
              </nav>
            </div>
          </div>

          <nav className="hidden sm:flex sm:flex-wrap gap-x-6 gap-y-2 text-sm">
            {[...EXPLORE, ...COMPANY].map((l) => (
              <Link key={l.to} to={l.to} className="hover:text-foreground transition-colors">{l.label}</Link>
            ))}
          </nav>

          <div className="hidden sm:block space-y-2 min-w-[12rem]">
            <p className="text-xs uppercase tracking-wider text-foreground/70">Kutatásaink</p>
            <nav className="flex flex-col gap-1.5 text-sm">
              {RESEARCH.map((l) => (
                <Link key={l.to} to={l.to} className="hover:text-foreground transition-colors">
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>

          <div className="hidden sm:block space-y-2 min-w-[12rem]">
            <p className="text-xs uppercase tracking-wider text-foreground/70">Cégeknek</p>
            <nav className="flex flex-col gap-1.5 text-sm">
              {BUSINESS.map((l) => (
                <Link key={l.to} to={l.to} className="hover:text-foreground transition-colors">
                  {l.label}
                </Link>
              ))}
            </nav>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-border/70 flex flex-col gap-2 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} Podiverzum</span>
          <span className="opacity-70">
            Kiadó: {SITE_PUBLISHER.displayName}. Cg. {SITE_PUBLISHER.companyRegisterNumber}. Nyilvános RSS-csatornákból indexelve.
          </span>
        </div>
      </div>
    </footer>
  );
}
