import { Link } from "react-router-dom";
import { ArrowRight, Building2, Hash, Users } from "lucide-react";
import type { EntityCount } from "@/lib/aggregateEntities";
import { entityHref } from "@/lib/entity";

type Lane = {
  title: string;
  subtitle: string;
  icon: typeof Hash;
  items: EntityCount[];
};

function EntityPill({ item }: { item: EntityCount }) {
  const label = item.value
    ? item.value.charAt(0).toLocaleUpperCase("hu-HU") + item.value.slice(1)
    : item.value;
  return (
    <Link
      to={entityHref(item.kind, item.value)}
      className="group flex min-w-0 w-full items-center justify-between gap-2 rounded-lg border border-border/70 bg-card/70 px-3 py-2 text-sm transition-colors hover:border-primary/50 hover:bg-card"
    >
      <span className="truncate font-medium group-hover:text-foreground">{label}</span>
      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{item.count}</span>
    </Link>
  );
}

export function HomeCurrentSignals({
  topics,
  people,
  companies,
}: {
  topics: EntityCount[];
  people: EntityCount[];
  companies: EntityCount[];
}) {
  const lanes: Lane[] = [
    { title: "Témák", subtitle: "amik körül most forog a beszélgetés", icon: Hash, items: topics },
    { title: "Személyek", subtitle: "akik gyakran előkerülnek", icon: Users, items: people },
    { title: "Cégek", subtitle: "márkák és szervezetek a műsorokban", icon: Building2, items: companies },
  ].filter((lane) => lane.items.length > 0);

  if (!lanes.length) return null;

  return (
    <section>
      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">
            Élő térkép
          </div>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight">Most beszélik</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Friss epizódokból számolt témák, személyek és szervezetek.
          </p>
        </div>
        <Link to="/temak" className="hidden sm:inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          Témák <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide sm:mx-0 sm:px-0 lg:grid lg:grid-cols-3 lg:overflow-visible lg:pb-0">
        {lanes.map((lane) => {
          const Icon = lane.icon;
          return (
            <div key={lane.title} className="w-[82vw] max-w-[340px] shrink-0 snap-start rounded-lg border border-border/70 bg-card/50 p-3 sm:w-[320px] lg:w-auto lg:max-w-none lg:shrink">
              <div className="mb-3 flex items-start gap-2">
                <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="font-semibold leading-tight">{lane.title}</h3>
                  <p className="text-[11px] leading-snug text-muted-foreground">{lane.subtitle}</p>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-2">
                {lane.items.slice(0, 6).map((item) => (
                  <EntityPill key={`${item.kind}-${item.slug}`} item={item} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
