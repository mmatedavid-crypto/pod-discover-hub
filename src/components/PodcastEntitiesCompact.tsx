import { useState } from "react";
import { Link } from "react-router-dom";
import { Hash, Users, Building2 } from "lucide-react";
import type { EntityCount } from "@/lib/aggregateEntities";

type Group = {
  key: "topic" | "person" | "company";
  label: string;
  items: EntityCount[];
};

const ICONS = { topic: Hash, person: Users, company: Building2 };
const HREF: Record<string, string> = {
  topic: "tema",
  person: "szemelyek",
  company: "ceg",
};

export function PodcastEntitiesCompact({
  people,
  companies,
  topics,
}: {
  people: EntityCount[];
  companies: EntityCount[];
  topics: EntityCount[];
}) {
  const groups: Group[] = [
    topics.length ? { key: "topic", label: "Témák", items: topics } : null,
    people.length ? { key: "person", label: "Személyek", items: people } : null,
    companies.length ? { key: "company", label: "Szervezetek", items: companies } : null,
  ].filter(Boolean) as Group[];

  const [active, setActive] = useState<Group["key"]>(groups[0]?.key || "topic");
  const [expanded, setExpanded] = useState(false);

  if (!groups.length) return null;
  const current = groups.find((g) => g.key === active) || groups[0];
  const visible = expanded ? current.items : current.items.slice(0, 12);

  return (
    <section className="mt-6 rounded-xl border border-border/70 bg-card/60 p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-1.5 mb-3">
        {groups.map((g) => {
          const Icon = ICONS[g.key];
          const isActive = g.key === active;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => {
                setActive(g.key);
                setExpanded(false);
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-3 w-3" />
              {g.label}
              <span className="tabular-nums opacity-70">{g.items.length}</span>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {visible.map((it) => (
          <Link
            key={`${it.kind}-${it.slug}`}
            to={`/${HREF[it.kind]}/${encodeURIComponent(it.slug)}`}
            className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2.5 py-1 text-xs hover:border-primary/40 hover:text-primary transition-colors max-w-full"
          >
            <span className="truncate">
              {it.value
                ? it.value.charAt(0).toLocaleUpperCase("hu-HU") + it.value.slice(1)
                : it.value}
            </span>
            <span className="tabular-nums text-muted-foreground">{it.count}</span>
          </Link>
        ))}
        {current.items.length > 12 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center rounded-full px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? "Kevesebb" : `+${current.items.length - 12} további`}
          </button>
        )}
      </div>
    </section>
  );
}
