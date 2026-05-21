import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, Hash, Building2, Vote, ArrowRight } from "lucide-react";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { supabase } from "@/integrations/supabase/client";

type Stats = {
  people: number;
  topics: number;
  companies: number;
  parties: number;
};

const SECTIONS = [
  {
    key: "people" as const,
    href: "/szemelyek",
    icon: Users,
    eyebrow: "Személyek",
    title: "Személyek magyar podcastokban",
    description:
      "Műsorvezetők, vendégek és gyakran említett közéleti szereplők — politikusok, üzleti vezetők, alkotók, gondolkodók.",
  },
  {
    key: "topics" as const,
    href: "/temak",
    icon: Hash,
    eyebrow: "Témák",
    title: "Témák, amik a magyar podcastokban szóba kerülnek",
    description: "Aktuális ügyek, hosszabb távú jelenségek és visszatérő témák — egy helyen, böngészhetően.",
  },
  {
    key: "companies" as const,
    href: "/cegek",
    icon: Building2,
    eyebrow: "Cégek és intézmények",
    title: "Cégek, intézmények, média és NGO-k",
    description:
      "A magyar (és nemzetközi) gazdasági, állami, média- és civil szereplők, akik a podcastokban szóba kerülnek.",
  },
  {
    key: "parties" as const,
    href: "/partok",
    icon: Vote,
    eyebrow: "Pártok",
    title: "Politikai pártok és frakciók",
    description: "Magyar pártok, politikai szín és aktivitás szerint — minden, ami a közéleti podcastokban előkerül.",
  },
];

export default function EntitiesIndexPage() {
  const [stats, setStats] = useState<Stats>({ people: 0, topics: 0, companies: 0, parties: 0 });

  useEffect(() => {
    setSeo({
      title: "Entitások — személyek, témák, cégek, pártok | Podiverzum",
      description:
        "Böngészd a magyar podcastvilág összes entitását: személyek, témák, cégek, intézmények, média és politikai pártok.",
    });
    (async () => {
      const [people, topics, companies, parties] = await Promise.all([
        supabase.from("people").select("id", { count: "exact", head: true }).eq("is_public", true).gte("gated_episode_count", 1),
        supabase.from("topics").select("id", { count: "exact", head: true }).eq("is_public", true),
        supabase.from("organizations").select("id", { count: "exact", head: true }).eq("is_public", true).in("org_type", ["company", "media", "ngo", "institution"]).gte("gated_episode_count", 1),
        supabase.from("organizations").select("id", { count: "exact", head: true }).eq("is_public", true).eq("org_type", "party").gte("gated_episode_count", 1),
      ]);
      setStats({
        people: people.count || 0,
        topics: topics.count || 0,
        companies: companies.count || 0,
        parties: parties.count || 0,
      });
    })();
  }, []);

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 sm:py-14 max-w-5xl px-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Entitások</div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mt-2">
            Kik és mik kerülnek szóba a magyar podcastokban?
          </h1>
          <p className="text-foreground/80 mt-4 max-w-2xl">
            Négy nagy tengely mentén böngészheted a magyar podcastvilág szereplőit: emberek, témák, cégek és politikai pártok.
            Minden entitáshoz kapcsolódó epizódokat, kontextust és kapcsolatokat is megmutatunk.
          </p>
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl px-4 space-y-4">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const count = stats[s.key];
          return (
            <Link
              key={s.key}
              to={s.href}
              className="group block p-5 sm:p-6 rounded-2xl border border-border bg-card/60 hover:bg-card hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start gap-4 sm:gap-5">
                <div className="shrink-0 h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  <Icon className="h-6 w-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                    {s.eyebrow}
                    {count > 0 && (
                      <>
                        <span aria-hidden>·</span>
                        <span className="tabular-nums">{count.toLocaleString("hu-HU")}</span>
                      </>
                    )}
                  </div>
                  <h2 className="text-lg sm:text-xl font-semibold mt-1 group-hover:text-primary transition-colors">{s.title}</h2>
                  <p className="text-sm text-foreground/75 mt-1.5 max-w-2xl">{s.description}</p>
                </div>
                <ArrowRight className="shrink-0 h-5 w-5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-2" />
              </div>
            </Link>
          );
        })}
      </div>
    </Layout>
  );
}
