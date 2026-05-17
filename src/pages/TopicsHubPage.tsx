import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";

interface Topic {
  id: string; slug: string; name: string; short_name: string | null;
  domain: string | null; seo_description: string | null;
  episode_count: number; podcast_count: number; is_indexable: boolean;
  priority: number;
}

const DOMAIN_LABEL: Record<string, string> = {
  economy: "Gazdaság és pénzügy",
  business: "Üzlet és vállalkozás",
  tech: "Tech és AI",
  politics: "Közélet és politika",
  psychology: "Pszichológia és élet",
  health: "Egészség",
  culture: "Kultúra",
  knowledge: "Tudás",
  sport: "Sport",
  spirituality: "Spiritualitás",
  society: "Társadalom és bűnügy",
};

export default function TopicsHubPage() {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("topics")
        .select("id, slug, name, short_name, domain, seo_description, episode_count, podcast_count, is_indexable, priority")
        .eq("is_public", true)
        .order("priority", { ascending: false })
        .order("sort_order", { ascending: true });
      setTopics((data || []) as any);
      setLoading(false);
      setSeo({
        title: "Podcast témák szerint — Podiverzum",
        description: "Fedezz fel magyar podcast epizódokat témák, személyek, ügyek és érdeklődési körök alapján.",
        jsonLd: [{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Podcast témák",
          url: typeof window !== "undefined" ? window.location.href.split("?")[0] : undefined,
        }],
      });
    })();
  }, []);

  const grouped = useMemo(() => {
    const g = new Map<string, Topic[]>();
    topics.forEach(t => {
      const k = t.domain || "other";
      const arr = g.get(k) || [];
      arr.push(t);
      g.set(k, arr);
    });
    return g;
  }, [topics]);

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 sm:py-14 max-w-5xl">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Témák</div>
          <h1 className="text-4xl sm:text-5xl font-bold tracking-tight mt-2">Podcast témák szerint</h1>
          <p className="text-foreground/80 mt-4 max-w-2xl">
            Fedezz fel magyar podcast epizódokat témák, személyek, ügyek és érdeklődési körök alapján.
          </p>
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl space-y-10">
        {loading && <div className="text-muted-foreground">Betöltés…</div>}
        {[...grouped.entries()].map(([domain, list]) => (
          <section key={domain}>
            <h2 className="text-xl font-semibold mb-3">{DOMAIN_LABEL[domain] || domain}</h2>
            <div className="flex flex-wrap gap-2">
              {list.map(t => (
                <Link
                  key={t.id}
                  to={`/temak/${t.slug}`}
                  className="px-3 py-2 rounded-full border border-border bg-card text-sm hover:border-primary/50 hover:bg-primary/10 transition-colors inline-flex items-center gap-2"
                >
                  <span>{t.short_name || t.name}</span>
                  {t.episode_count > 0 && (
                    <span className="text-[10px] text-muted-foreground tabular-nums">{t.episode_count}</span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Layout>
  );
}
