import { Link } from "react-router-dom";
import { ArrowRight, Building2, ShieldCheck, UsersRound } from "lucide-react";
import type { EntityCount } from "@/lib/aggregateEntities";
import { entityHref } from "@/lib/entity";

function labelOf(item: EntityCount) {
  return item.value ? item.value.charAt(0).toLocaleUpperCase("hu-HU") + item.value.slice(1) : item.value;
}

function MiniRail({
  title,
  href,
  Icon,
  items,
}: {
  title: string;
  href: string;
  Icon: typeof UsersRound;
  items: EntityCount[];
}) {
  if (!items.length) return null;
  return (
    <div className="w-[82vw] max-w-[340px] shrink-0 snap-start rounded-lg border border-border/70 bg-card/55 p-3 sm:w-[320px] lg:w-auto lg:max-w-none">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </span>
          <h3 className="truncate font-semibold">{title}</h3>
        </div>
        <Link to={href} className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={title}>
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="space-y-2">
        {items.slice(0, 5).map((item) => (
          <Link
            key={`${item.kind}-${item.slug}`}
            to={entityHref(item.kind, item.value)}
            className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-background/45 px-3 py-2 text-sm hover:border-primary/40 hover:bg-background/70"
          >
            <span className="truncate font-medium">{labelOf(item)}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{item.count}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function HomeMediaSignals({
  people,
  companies,
}: {
  people: EntityCount[];
  companies: EntityCount[];
}) {
  if (!people.length && !companies.length) return null;
  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">
            <ShieldCheck className="h-3 w-3" /> Médiafigyelés
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">Kik és márkák a podcastokban</h2>
          <p className="mt-1 text-xs text-muted-foreground">Közszereplők, cégek és szervezetek friss podcast-említései.</p>
        </div>
        <Link to="/szervezetek" className="hidden sm:inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          Szervezetek <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:px-0 lg:grid lg:grid-cols-2 lg:overflow-visible">
        <MiniRail title="Közszereplők és alkotók" href="/szemelyek" Icon={UsersRound} items={people} />
        <MiniRail title="Márkák és szervezetek" href="/szervezetek" Icon={Building2} items={companies} />
      </div>
    </section>
  );
}
