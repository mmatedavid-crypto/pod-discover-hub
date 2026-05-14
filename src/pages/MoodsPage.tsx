import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { ArrowRight, ArrowLeft, Sparkles } from "lucide-react";

type Mood = {
  slug: string;
  title: string;
  mood: string;
  description: string | null;
  accent_hsl: string | null;
};

export default function MoodsPage() {
  const [items, setItems] = useState<Mood[]>([]);

  useEffect(() => {
    setSeo({
      title: "Hangulatok — válogatott podcast-gyűjtemények | Podiverzum",
      description:
        "Tematikus podcast-epizódgyűjtemények hangulat, formátum és hallgatási helyzet szerint.",
    });
    supabase
      .from("mood_collections" as any)
      .select("slug,title,mood,description,accent_hsl,sort_order")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => setItems(((data as any) || []) as Mood[]));
  }, []);

  const Card = ({ m }: { m: Mood }) => {
    const accent = m.accent_hsl ? `hsl(${m.accent_hsl})` : "hsl(var(--primary))";
    return (
      <Link
        to={`/hangulat/${m.slug}`}
        className="group relative overflow-hidden rounded-xl border border-border/70 hover:border-primary/40 p-4 transition-colors"
        style={{ background: `linear-gradient(135deg, ${accent}1a, transparent 60%), hsl(var(--card) / 0.7)` }}
      >
        <div className="flex items-start justify-between">
          <Sparkles className="h-5 w-5" style={{ color: accent }} />
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform mt-5" />
        </div>
        <div className="mt-3 font-semibold leading-tight">{m.title}</div>
        <div className="text-[11px] text-muted-foreground mt-0.5">{m.mood}</div>
        {m.description && (
          <div className="text-xs text-muted-foreground mt-2 line-clamp-2">{m.description}</div>
        )}
      </Link>
    );
  };

  return (
    <Layout>
      <div className="container mx-auto py-10 max-w-5xl">
        <Link to="/" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Vissza a kezdőlapra
        </Link>
        <div className="mt-3">
          <h1 className="text-3xl sm:text-4xl font-semibold">Hangulatok</h1>
          <p className="text-muted-foreground mt-2 text-sm">
            Epizódgyűjtemények hangulat, formátum és hallgatási helyzet szerint.
          </p>
        </div>

        {items.length > 0 && (
          <section className="mt-8">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
              {items.map((m) => (
                <Card key={m.slug} m={m} />
              ))}
            </div>
          </section>
        )}
      </div>
    </Layout>
  );
}
