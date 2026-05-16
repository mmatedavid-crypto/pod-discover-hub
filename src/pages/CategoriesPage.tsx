import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";

export default function CategoriesPage() {
  const [cats, setCats] = useState<any[]>([]);
  useEffect(() => {
    setSeo({
      title: "Kategóriák — Podiverzum",
      description: "Magyar podcastok témák szerint. Hírek, technológia, gazdaság, befektetés, egészség, kultúra, sport és sok más kategória.",
    });
    supabase.from("categories").select("*").eq("active", true).order("sort_order").then(({ data }) => setCats(data || []));
  }, []);
  return (
    <Layout>
      <div className="container mx-auto py-10">
        <h1 className="text-3xl font-semibold mb-2">Kategóriák</h1>
        <p className="text-muted-foreground mb-8">Magyar podcastok témák szerint rendezve.</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {cats.map((c) => (
            <Link
              key={c.id}
              to={`/category/${c.slug}`}
              className="block p-5 rounded-lg border border-border bg-card hover:border-accent/40 transition-colors"
            >
              <div className="font-medium">{c.name}</div>
              {c.description && <div className="text-sm text-muted-foreground mt-1">{c.description}</div>}
            </Link>
          ))}
        </div>
      </div>
    </Layout>
  );
}