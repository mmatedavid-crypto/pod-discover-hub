import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowRight, Coffee, Brain, Moon, GraduationCap, Newspaper, Sparkles,
  Dumbbell, Car, Smile, Radio, Briefcase, LineChart, BookOpen, Film, MessageCircle, Zap,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";

type Card = {
  slug: string;
  title: string;
  description: string | null;
  short_description: string | null;
  href: string;
  reason_label: string | null;
  energy_level: string | null;
};

const ICONS: Record<string, any> = {
  "elalvashoz": Moon,
  "munkaba-menet": Coffee,
  "reggeli-radio": Radio,
  "edzeshez": Dumbbell,
  "hosszu-utra": Car,
  "vilag-esemenyei": Newspaper,
  "mosolyogashoz": Smile,
  "tanulashoz": GraduationCap,
  "elmelyuleshez": Brain,
  "uzleti-inspiracio": Briefcase,
  "penzugyi-gondolkodas": LineChart,
  "kulturahoz": BookOpen,
  "filmekhez": Film,
  "nyugodt-beszelgetesek": MessageCircle,
  "gyors-frissites": Zap,
};

function detectViewport(isMobile: boolean): "mobile" | "tablet" | "desktop" {
  if (isMobile) return "mobile";
  if (typeof window !== "undefined" && window.innerWidth < 1024) return "tablet";
  return "desktop";
}

export function MoodCollections() {
  const [cards, setCards] = useState<Card[]>([]);
  const isMobile = useIsMobile();

  useEffect(() => {
    const viewport = detectViewport(isMobile);
    const now = new Date();
    supabase
      .rpc("get_personalized_mood_cards", {
        p_viewport: viewport,
        p_hour: now.getHours(),
        p_dow: now.getDay(),
      })
      .then(({ data }) => setCards((data as Card[]) || []));
  }, [isMobile]);

  if (!cards.length) return null;

  return (
    <section>
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">
            <Sparkles className="h-3 w-3" /> Hallgatási helyzetek
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold">Mihez van most kedved?</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Válogatott ajánlók, az aktuális helyzethez igazítva.
          </p>
        </div>
        <Link
          to="/hangulatok"
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 whitespace-nowrap"
        >
          Összes hangulat <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {cards.map((c) => {
          const Icon = ICONS[c.slug] || Sparkles;
          return (
            <Link
              key={c.slug}
              to={c.href || `/hangulatok/${c.slug}`}
              className="group relative overflow-hidden rounded-xl border border-border/70 bg-card/70 p-4 hover:border-primary/40 transition-colors"
            >
              <div className="flex items-start justify-between">
                <Icon className="h-5 w-5 text-primary" />
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </div>
              <div className="mt-3 font-semibold leading-tight">{c.title}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                {c.short_description || c.description || ""}
              </div>
              {c.reason_label && (
                <div className="mt-2 inline-flex items-center text-[10px] uppercase tracking-[0.12em] text-primary/80">
                  {c.reason_label}
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
