import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";

export default function CategoriesPage() {
  const [cats, setCats] = useState<any[]>([]);
  useEffect(() => {
    setSeo({
      title: "Podcast kategóriák — Podiverzum",
      description: "Böngészd a magyar podcastokat nagy műfaji és tartalmi területek szerint: hírek, üzlet, tech, tudomány, sport, kultúra és sok más.",
    });
    supabase.from("categories").select("*").eq("active", true).order("sort_order").then(({ data }) => setCats(data || []));
  }, []);
  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 sm:py-14 max-w-5xl px-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">Kategóriák</div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mt-2">
            Podcast kategóriák
          </h1>
          <p className="text-foreground/80 mt-4 max-w-2xl">
            Böngészd a magyar podcastokat nagy műfaji és tartalmi területek szerint —
            hírek, üzlet, tech, tudomány, sport, kultúra és sok más.
          </p>
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl px-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cats.map((c) => {
            const description = sanitizeHungarianPublicText(c.description);
            return (
              <Link
                key={c.id}
                to={`/kategoria/${c.slug}`}
                className="block p-5 rounded-lg border border-border bg-card hover:border-accent/40 transition-colors"
              >
                <div className="font-medium">{c.name}</div>
                {description && <div className="text-sm text-muted-foreground mt-1">{description}</div>}
              </Link>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
