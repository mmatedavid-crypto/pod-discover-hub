import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Vote, ArrowRight } from "lucide-react";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";
import OrgCard, { OrgCardData } from "@/components/OrgCard";

type Stats = { companies: number; parties: number };

export default function OrganizationsIndexPage() {
  const [stats, setStats] = useState<Stats>({ companies: 0, parties: 0 });
  const [topCompanies, setTopCompanies] = useState<OrgCardData[]>([]);
  const [topParties, setTopParties] = useState<OrgCardData[]>([]);

  useEffect(() => {
    setSeo({
      title: "Szervezetek — cégek, intézmények, média, pártok | Podiverzum",
      description:
        "Böngészd a magyar podcastvilágban szóba kerülő szervezeteket: cégek, intézmények, média, NGO-k és politikai pártok.",
    });
    (async () => {
      const cols =
        "id, slug, name, org_type, short_description_hu, ai_bio, wikipedia_extract, logo_url, gated_episode_count, gated_podcast_count, political_color, latest_episode_at";
      const [cCount, pCount, cTop, pTop] = await Promise.all([
        supabase
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .eq("is_public", true)
          .in("org_type", ["company", "media", "ngo", "institution", "radio_station"])
          .gte("gated_episode_count", 1),
        supabase
          .from("organizations")
          .select("id", { count: "exact", head: true })
          .eq("is_public", true)
          .eq("org_type", "party")
          .gte("gated_episode_count", 1),
        supabase
          .from("organizations")
          .select(cols)
          .eq("is_public", true)
          .in("org_type", ["company", "media", "ngo", "institution", "radio_station"])
          .gte("gated_episode_count", 1)
          .order("gated_episode_count", { ascending: false })
          .limit(6),
        supabase
          .from("organizations")
          .select(cols)
          .eq("is_public", true)
          .eq("org_type", "party")
          .gte("gated_episode_count", 1)
          .order("editorial_priority_level", { ascending: false })
          .order("gated_episode_count", { ascending: false })
          .limit(6),
      ]);
      setStats({ companies: cCount.count || 0, parties: pCount.count || 0 });
      setTopCompanies((cTop.data || []) as any);
      setTopParties((pTop.data || []) as any);
    })();
  }, []);

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 sm:py-14 max-w-5xl px-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Szervezetek</div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mt-2">
            Szervezetek a magyar podcastvilágban
          </h1>
          <p className="text-foreground/80 mt-4 max-w-2xl">
            Cégek, intézmények, média, NGO-k és politikai pártok — minden szervezet, amely a magyar podcastokban
            szóba kerül vagy résztvevőként jelenik meg.
          </p>
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl px-4 space-y-10">
        {/* Hub links */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <HubLink
            to="/cegek"
            icon={Building2}
            eyebrow="Cégek és intézmények"
            count={stats.companies}
            title="Cégek, intézmények, média, NGO"
            description="Gazdasági, állami, média- és civil szervezetek — típus szerint csoportosítva."
          />
          <HubLink
            to="/partok"
            icon={Vote}
            eyebrow="Pártok"
            count={stats.parties}
            title="Politikai pártok"
            description="Magyar pártok és frakciók, politikai szín és aktivitás szerint."
          />
        </div>

        {topCompanies.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h2 className="text-xl sm:text-2xl font-semibold">Top cégek és intézmények</h2>
                <p className="text-xs text-muted-foreground mt-1">A legtöbb epizódban szereplő szervezetek.</p>
              </div>
              <Link to="/cegek" className="text-xs text-primary hover:underline">Mind →</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {topCompanies.map((o) => (
                <OrgCard key={o.slug} o={o} />
              ))}
            </div>
          </section>
        )}

        {topParties.length > 0 && (
          <section>
            <div className="flex items-end justify-between mb-4 gap-3 flex-wrap">
              <div>
                <h2 className="text-xl sm:text-2xl font-semibold">Top pártok</h2>
                <p className="text-xs text-muted-foreground mt-1">Politikai pártok aktivitás szerint.</p>
              </div>
              <Link to="/partok" className="text-xs text-primary hover:underline">Mind →</Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {topParties.map((o) => (
                <OrgCard key={o.slug} o={o} />
              ))}
            </div>
          </section>
        )}

        {topCompanies.length === 0 && topParties.length === 0 && (
          <div className="rounded-xl border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
            Még gyűjtjük a szervezeteket az epizódokból. Az AI ~16 ezer epizódból már kinyerte a említett cégeket,
            intézményeket és pártokat; ezek hamarosan itt jelennek meg.
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
