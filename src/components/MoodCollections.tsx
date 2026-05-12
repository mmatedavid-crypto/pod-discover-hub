import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Coffee, Brain, Moon, GraduationCap, Newspaper, Sparkles } from "lucide-react";

type Mood = {
  id: string;
  slug: string;
  title: string;
  mood: string;
  description: string | null;
  accent_hsl: string | null;
  podcast_ids: string[];
  episode_ids: string[];
  sort_order: number;
};

const ICONS: Record<string, any> = {
  "morning-inspiration": Coffee,
  "deep-focus": Brain,
  "wind-down": Moon,
  "learn-something-new": GraduationCap,
  "news-now": Newspaper,
};

export function MoodCollections() {
  const [moods, setMoods] = useState<Mood[]>([]);
  useEffect(() => {
    supabase
      .from("mood_collections" as any)
      .select("id,slug,title,mood,description,accent_hsl,podcast_ids,episode_ids,sort_order")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => setMoods((data as any) || []));
  }, []);

  if (!moods.length) return null;

  return (
    <section>
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">
            <Sparkles className="h-3 w-3" /> Hangulat alapján
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold">Mihez van most kedved?</h2>
          <p className="text-xs text-muted-foreground mt-1">Válogatott hallgatási ötletek, hetente frissítve.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {moods.map((m) => {
          const Icon = ICONS[m.slug] || Sparkles;
          const accent = m.accent_hsl ? `hsl(${m.accent_hsl})` : "hsl(var(--primary))";
          return (
            <Link
              key={m.id}
              to={`/mood/${m.slug}`}
              className="group relative overflow-hidden rounded-xl border border-border/70 bg-card/70 p-4 hover:border-primary/40 transition-colors"
              style={{ background: `linear-gradient(135deg, ${accent}11, transparent 60%), hsl(var(--card) / 0.7)` }}
            >
              <div className="flex items-start justify-between">
                <Icon className="h-5 w-5" style={{ color: accent }} />
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </div>
              <div className="mt-3 font-semibold leading-tight">{m.title}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5">{m.mood}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
