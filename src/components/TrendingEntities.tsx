import { Link } from "react-router-dom";
import { ArrowRight, Hash, Users, Building2 } from "lucide-react";
import type { EntityCount } from "@/lib/aggregateEntities";
import { entityHref } from "@/lib/entity";

type Props = {
  eyebrow: string;
  title: string;
  subtitle?: string;
  items: EntityCount[];
  icon?: "topic" | "person" | "company";
};

const ICONS = {
  topic: Hash,
  person: Users,
  company: Building2,
};

const KIND_LABEL: Record<string, string> = {
  topic: "téma",
  person: "személy",
  company: "cég",
  ticker: "részvény",
  ingredient: "hozzávaló",
};

export function TrendingEntities({ eyebrow, title, subtitle, items, icon = "topic" }: Props) {
  if (!items.length) return null;
  const Icon = ICONS[icon];
  return (
    <section>
      <div className="mb-4">
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">
          <Icon className="h-3 w-3" /> {eyebrow}
        </div>
        <h2 className="text-xl sm:text-2xl font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {items.map((it) => (
          <Link
            key={`${it.kind}-${it.slug}`}
            to={entityHref(it.kind, it.value)}
            className="group relative rounded-xl border border-border/70 bg-card/60 hover:bg-card hover:border-primary/40 p-3 transition-colors flex items-center justify-between gap-2 min-w-0"
          >
            <div className="min-w-0">
              <div className="font-medium text-sm truncate group-hover:text-primary transition-colors">{it.value ? it.value.charAt(0).toLocaleUpperCase("hu-HU") + it.value.slice(1) : it.value}</div>
            </div>
            <div className="shrink-0 flex items-center gap-1">
              <span className="text-xs tabular-nums text-muted-foreground">{it.count}</span>
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
