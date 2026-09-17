import { Link } from "react-router-dom";
import { DISCOVERY_LINKS, discoveryCategories, type DiscoveryCategory } from "@/lib/discoveryNavigation";
import { Flame, Headphones, Radio, Sparkles, Tags } from "lucide-react";

const shortcuts = [
  {
    title: "Toplistás műsorok",
    href: "/toplista",
    Icon: Flame,
    accent: "text-orange-500 bg-orange-500/10",
  },
  {
    title: "Friss epizódok",
    href: "/napi",
    Icon: Radio,
    accent: "text-sky-500 bg-sky-500/10",
  },
  {
    title: "Témák",
    href: "/temak",
    Icon: Tags,
    accent: "text-violet-500 bg-violet-500/10",
  },
  {
    title: "A Te Podiverzumod",
    href: "/te-podiverzumod",
    Icon: Sparkles,
    accent: "text-primary bg-primary/10",
  },
  {
    title: "Hallgatnám tovább",
    href: "/en-podiverzumom?tab=meghallgatando",
    Icon: Headphones,
    accent: "text-amber-500 bg-amber-500/10",
  },
];

export function HomeDiscoveryShortcuts({ categories = [] }: { categories?: DiscoveryCategory[] }) {
  const featuredCategories = discoveryCategories(categories);
  return (
    <section aria-label="Gyors felfedezés" className="w-full max-w-full overflow-hidden">
      <div className="-mx-4 overflow-x-auto [scrollbar-width:none] sm:mx-0 [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-2.5 px-4 sm:grid sm:w-full sm:grid-cols-5 sm:px-0">
          {shortcuts.map(({ title, href, Icon, accent }) => (
            <Link
              key={href}
              to={href}
              className="group flex w-[136px] flex-col gap-2 rounded-lg border border-border bg-card/50 p-3 transition-colors hover:border-primary/35 hover:bg-card sm:w-auto"
            >
              <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${accent}`}>
                <Icon className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-sm font-medium leading-tight group-hover:text-primary">
                {title}
              </span>
            </Link>
          ))}
        </div>
      </div>
      <nav aria-label="Böngészés a podcastok között" className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm">
        {DISCOVERY_LINKS.filter((link) => !shortcuts.some((s) => s.href === link.href)).map((link) => (
          <Link key={link.href} to={link.href} className="font-medium text-primary underline-offset-4 hover:underline">{link.label}</Link>
        ))}
      </nav>
      {featuredCategories.length > 0 && (
        <nav aria-label="Válassz podcast kategóriát" className="mt-3 flex flex-wrap gap-2">
          {featuredCategories.map((c) => (
            <Link key={c.slug} to={`/kategoria/${c.slug}`} className="rounded-full border border-border px-3 py-2 text-sm hover:border-primary/50 hover:text-primary">{c.name}</Link>
          ))}
        </nav>
      )}
    </section>
  );
}
