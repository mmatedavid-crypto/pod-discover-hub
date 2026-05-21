import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
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
        title: "Témák a magyar podcastokban — Podiverzum",
        description: "Fedezz fel magyar podcast epizódokat konkrét ügyek, fogalmak, trendek és érdeklődési körök alapján.",
        jsonLd: [{
          "@context": "https://schema.org",
          "@type": "CollectionPage",
          name: "Témák a magyar podcastokban",
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

  const totalEpisodes = useMemo(
    () => topics.reduce((sum, t) => sum + (t.episode_count || 0), 0),
    [topics]
  );

  return (
    <Layout>
      {/* Hero */}
      <section className="relative border-b border-border bg-background overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{ background: "var(--gradient-spot)" }}
        />
        <div className="relative container mx-auto py-14 sm:py-20 max-w-5xl">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary font-semibold">
            Témák
          </div>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight mt-3 leading-[1.05]">
            Témák<br className="hidden sm:block" />
            <span className="text-primary">a magyar podcastokban</span>
          </h1>
          <p className="text-foreground/80 mt-5 max-w-2xl text-base sm:text-lg leading-relaxed">
            Fedezz fel magyar podcast epizódokat konkrét ügyek, fogalmak,
            trendek és érdeklődési körök alapján.
          </p>

          {topics.length > 0 && (
            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground tabular-nums">{topics.length}</span> téma
              </span>
              <span className="hidden sm:inline text-border">·</span>
              <span>
                <span className="font-semibold text-foreground tabular-nums">{totalEpisodes.toLocaleString("hu-HU")}</span> epizód
              </span>
            </div>
          )}
        </div>
      </section>

      <div className="container mx-auto py-12 sm:py-16 max-w-5xl space-y-12">
        {loading && <div className="text-muted-foreground">Betöltés…</div>}
        {[...grouped.entries()].map(([domain, list]) => (
          <section key={domain}>
            <div className="flex items-center gap-3 mb-5">
              <span className="h-px flex-1 bg-border" />
              <h2 className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">
                {DOMAIN_LABEL[domain] || domain}
              </h2>
              <span className="h-px flex-1 bg-border" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px bg-border rounded-xl overflow-hidden border border-border">
              {list.map((t, i) => (
                <Link
                  key={t.id}
                  to={`/temak/${t.slug}`}
                  className="group relative flex items-center justify-between gap-3 bg-card px-4 py-4 hover:bg-secondary transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-[11px] tabular-nums font-mono text-muted-foreground group-hover:text-primary w-6 shrink-0">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <span className="font-medium text-sm sm:text-base truncate">
                      {t.short_name || t.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {t.episode_count > 0 && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {t.episode_count}
                      </span>
                    )}
                    <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-all" />
                  </div>
                  <span
                    aria-hidden
                    className="absolute left-0 top-0 bottom-0 w-0.5 bg-primary scale-y-0 group-hover:scale-y-100 transition-transform origin-top"
                  />
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </Layout>
  );
}
