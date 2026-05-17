import { Link } from "react-router-dom";

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
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">Podcast témák szerint</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Fedezz fel magyar podcast epizódokat témák, ügyek, személyek és érdeklődési körök alapján.
          </p>
        </div>
        <Link to="/temak" className="hidden sm:inline text-sm text-primary hover:underline whitespace-nowrap">
          Összes téma →
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRIORITY.map(t => (
          <Link
            key={t.slug}
            to={`/temak/${t.slug}`}
            className="px-3 py-2 rounded-full border border-border bg-card text-sm hover:border-primary/50 hover:bg-primary/10 transition-colors"
          >
            {t.name}
          </Link>
        ))}
      </div>
      <div className="sm:hidden">
        <Link to="/temak" className="text-sm text-primary hover:underline">Összes téma →</Link>
      </div>
    </section>
  );
}
