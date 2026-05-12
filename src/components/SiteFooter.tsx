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
              Magyar podcastfelfedező. Keress epizódokat témák, személyek,
              cégek, piacok vagy ötletek alapján.
            </p>
            <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
              <span className="relative inline-flex h-1.5 w-1.5">
                <span className="pulse-red" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary shadow-[0_0_8px_hsl(var(--brand-red)/0.9)]" />
              </span>
              Élő index · folyamatosan frissül
            </div>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <Link to="/kategoriak" className="hover:text-foreground transition-colors">Kategóriák</Link>
            <Link to="/kereses" className="hover:text-foreground transition-colors">Keresés</Link>
            <Link to="/uj" className="hover:text-foreground transition-colors">Új podcastok</Link>
            <Link to="/rolunk" className="hover:text-foreground transition-colors">Rólunk</Link>
            <Link to="/modszertan" className="hover:text-foreground transition-colors">Módszertan</Link>
            
            <Link to="/adatvedelem" className="hover:text-foreground transition-colors">Adatvédelem</Link>
            <Link to="/feltetelek" className="hover:text-foreground transition-colors">Feltételek</Link>
          </nav>
        </div>
        <div className="mt-10 pt-6 border-t border-border/70 flex flex-wrap gap-2 items-center justify-between text-xs">
          <span>© {new Date().getFullYear()} Podiverzum · Találd meg. Hallgasd meg.</span>
          <span className="opacity-70">
            Nyilvános RSS feedekből indexelve · Frissesség, feedminőség és relevancia alapján rangsorolva.
          </span>
        </div>
      </div>
    </footer>
  );
}
