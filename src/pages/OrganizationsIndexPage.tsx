import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Vote, ArrowRight } from "lucide-react";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import OrgCard, { OrgCardData, ORG_TYPE_ICON } from "@/components/OrgCard";

type OrgType =
  | "company" | "party" | "media" | "radio_station"
  | "institution" | "ngo" | "university" | "church"
  | "sport_team" | "sport_league" | "research";

type Stats = { companies: number; parties: number; total: number };

// Sections shown on the hub page (in display order)
const SECTIONS: { key: string; label: string; types: OrgType[]; href?: string; iconType: OrgType }[] = [
  { key: "party",         label: "Pártok",                types: ["party"],                            href: "/partok", iconType: "party" },
  { key: "media",         label: "Médiumok és rádiók",    types: ["media", "radio_station"],           href: "/cegek",  iconType: "media" },
  { key: "company",       label: "Cégek",                 types: ["company"],                          href: "/cegek",  iconType: "company" },
  { key: "institution",   label: "Intézmények",           types: ["institution"],                      href: "/cegek",  iconType: "institution" },
  { key: "ngo",           label: "Civil szervezetek",     types: ["ngo"],                              href: "/cegek",  iconType: "ngo" },
  { key: "university",    label: "Egyetemek és kutatás",  types: ["university", "research"],           iconType: "university" },
  { key: "church",        label: "Egyházak",              types: ["church"],                           iconType: "church" },
  { key: "sport",         label: "Sport (klubok és ligák)", types: ["sport_team", "sport_league"],     iconType: "sport_team" },
];

const COLS = "id, slug, name, org_type, short_description_hu, ai_bio, wikipedia_extract, wikipedia_url, wikipedia_match_status, logo_url, gated_episode_count, gated_podcast_count, political_color, latest_episode_at";

export default function OrganizationsIndexPage() {
  const [stats, setStats] = useState<Stats>({ companies: 0, parties: 0, total: 0 });
  const [topAll, setTopAll] = useState<OrgCardData[]>([]);
  const [bySection, setBySection] = useState<Record<string, OrgCardData[]>>({});
  const [counts, setCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    setSeo({
      title: "Szervezetek a magyar podcastokban — Podiverzum",
      description:
        "Cégek, intézmények, médiumok, rádiók, civil szervezetek, politikai pártok, egyetemek, egyházak, sportklubok és ligák, amelyek magyar podcastokban szóba kerülnek vagy résztvevőként jelennek meg.",
    });

    (async () => {
      // Top mixed (12) — most-mentioned overall.
      // Médiumok és rádiók kizárva amíg nincs clean_text alapú entitás-újrafeldolgozás
      // (nyers description-ből túl sok zaj: podcast-kiadók szerepelnek témaként). Feloldható,
      // ha az entity-backfill clean_text-ből fut és az org gating újraszámol.
      const topAllPromise = supabase
        .from("organizations")
        .select(COLS)
        .eq("is_indexable", true)
        .not("org_type", "in", "(other,media,radio_station)")
        .order("gated_episode_count", { ascending: false })
        .limit(12);

      // Aggregate counts
      const companyCountPromise = supabase
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .eq("is_indexable", true)
        .in("org_type", ["company", "media", "ngo", "institution", "radio_station"]);
      const partyCountPromise = supabase
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .eq("is_indexable", true)
        .eq("org_type", "party");
      const totalCountPromise = supabase
        .from("organizations")
        .select("id", { count: "exact", head: true })
        .eq("is_indexable", true)
        .not("org_type", "eq", "other");

      const sectionPromises = SECTIONS.map((s) =>
        Promise.all([
          supabase
            .from("organizations")
            .select(COLS)
            .eq("is_indexable", true)
            .in("org_type", s.types)
            .order("gated_episode_count", { ascending: false })
            .limit(6),
          supabase
            .from("organizations")
            .select("id", { count: "exact", head: true })
            .eq("is_indexable", true)
            .in("org_type", s.types),
        ]),
      );

      const [tAll, cCount, pCount, totCount, ...sectionResults] = await Promise.all([
        topAllPromise,
        companyCountPromise,
        partyCountPromise,
        totalCountPromise,
        ...sectionPromises,
      ]);

      setTopAll((tAll.data || []) as any);
      setStats({
        companies: cCount.count || 0,
        parties: pCount.count || 0,
        total: totCount.count || 0,
      });

      const sec: Record<string, OrgCardData[]> = {};
      const cnt: Record<string, number> = {};
      sectionResults.forEach((res, i) => {
        const [rowsRes, countRes] = res as any;
        sec[SECTIONS[i].key] = (rowsRes.data || []) as OrgCardData[];
        cnt[SECTIONS[i].key] = countRes.count || 0;
      });
      setBySection(sec);
      setCounts(cnt);
    })();
  }, []);

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 sm:py-14 max-w-5xl px-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Szervezetek</div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mt-2">
            Szervezetek a magyar podcastokban
          </h1>
          <p className="text-foreground/80 mt-4 max-w-2xl">
            Cégek, médiumok, rádiók, intézmények, civil szervezetek, politikai pártok, egyetemek, egyházak,
            sportklubok és ligák — minden olyan szervezet, amely magyar podcastokban szóba kerül vagy
            résztvevőként megjelenik.
          </p>
          {stats.total > 0 && (
            <div className="mt-4 text-xs text-muted-foreground tabular-nums">
              {stats.total.toLocaleString("hu-HU")} szervezet · {stats.parties.toLocaleString("hu-HU")} párt ·{" "}
              {stats.companies.toLocaleString("hu-HU")} cég és intézmény
            </div>
          )}
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl px-4 space-y-12">
        {/* Top mixed — most-mentioned overall */}
        {topAll.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h2 className="text-xl sm:text-2xl font-semibold">A legtöbbet emlegetett szervezetek</h2>
                <p className="text-xs text-muted-foreground mt-1">
                  Top 12 — az összes típus együtt, epizódszám szerint.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {topAll.map((o) => (
                <OrgCard key={o.slug} o={o} />
              ))}
            </div>
          </section>
        )}

        {/* Per-type sections */}
        {SECTIONS.map((s) => {
          const rows = bySection[s.key] || [];
          if (!rows.length) return null;
          const Icon = ORG_TYPE_ICON[s.iconType];
          const count = counts[s.key] || 0;
          return (
            <section key={s.key}>
              <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="shrink-0 h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center mt-0.5">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-xl sm:text-2xl font-semibold">{s.label}</h2>
                    <p className="text-xs text-muted-foreground mt-1 tabular-nums">
                      {count.toLocaleString("hu-HU")} szervezet
                    </p>
                  </div>
                </div>
                {s.href && (
                  <Link to={s.href} className="text-xs text-primary hover:underline whitespace-nowrap">
                    Mind →
                  </Link>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {rows.map((o) => (
                  <OrgCard key={o.slug} o={o} />
                ))}
              </div>
            </section>
          );
        })}

        {/* Hub links at bottom — deeper browsing */}
        <section className="pt-2">
          <div className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground mb-3">Tovább böngészés</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <HubLink
              to="/cegek"
              icon={Building2}
              eyebrow="Cégek és intézmények"
              count={stats.companies}
              title="Böngészés típus szerint"
              description="Cég · Média · Intézmény · Civil — kereshető lista, lapozható."
            />
            <HubLink
              to="/partok"
              icon={Vote}
              eyebrow="Pártok"
              count={stats.parties}
              title="Magyar pártok"
              description="Politikai szín és aktivitás szerint, kereshető."
            />
          </div>
        </section>

        {topAll.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
            Még gyűjtjük a szervezeteket az epizódokból. Hamarosan itt jelennek meg.
          </div>
        )}
      </div>
    </Layout>
  );
}

function HubLink({
  to, icon: Icon, eyebrow, count, title, description,
}: {
  to: string;
  icon: any;
  eyebrow: string;
  count: number;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="group block p-5 rounded-2xl border border-border bg-card/60 hover:bg-card hover:border-primary/40 transition-colors"
    >
      <div className="flex items-start gap-4">
        <div className="shrink-0 h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {eyebrow}
            {count > 0 && (
              <>
                <span aria-hidden>·</span>
                <span className="tabular-nums">{count.toLocaleString("hu-HU")}</span>
              </>
            )}
          </div>
          <h2 className="text-lg font-semibold mt-1 group-hover:text-primary transition-colors">{title}</h2>
          <p className="text-sm text-foreground/75 mt-1.5">{description}</p>
        </div>
        <ArrowRight className="shrink-0 h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-2" />
      </div>
    </Link>
  );
}
