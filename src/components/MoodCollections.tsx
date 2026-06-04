import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import {
  ArrowRight, Coffee, Brain, Moon, GraduationCap, Newspaper, Sparkles,
  Dumbbell, Car, Smile, Radio, Briefcase, LineChart, BookOpen, Film, MessageCircle, Zap,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { sanitizeHungarianPublicText } from "@/lib/publicTextLanguage";

type Card = {
  slug: string;
  title: string;
  description: string | null;
  short_description: string | null;
  href: string;
  reason_label: string | null;
  energy_level: string | null;
  representative_episode_count?: number | null;
};

const BAD_SHORT_TITLES: Record<string, string> = {
  test: "Mozgás és egészség",
  fej: "Gondolatok és tudás",
  élet: "Lélek és élethelyzetek",
  elet: "Lélek és élethelyzetek",
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

export function polishMoodTitle(title: string | null | undefined, slug?: string | null): string {
  const raw = String(title || "").replace(/\s+/g, " ").trim();
  const key = raw.toLowerCase();
  if (BAD_SHORT_TITLES[key]) return BAD_SHORT_TITLES[key];
  if (raw.length >= 3 && raw.length <= 5 && !/\s/.test(raw)) {
    if (/test|edz|mozgas|mozgás|sport/.test(`${slug || ""} ${key}`)) return "Mozgás és egészség";
    if (/fej|tanul|tudas|tudás|tech/.test(`${slug || ""} ${key}`)) return "Gondolatok és tudás";
    if (/elet|élet|lelek|lélek|onismeret|önismeret/.test(`${slug || ""} ${key}`)) return "Lélek és élethelyzetek";
  }
  return raw || "Válogatott hallgatnivaló";
}

export function MoodCollections() {
  const [cards, setCards] = useState<Card[]>([]);
  const isMobile = useIsMobile();
  const desktopGridClass = cards.length > 6 ? "lg:grid-cols-4" : "lg:grid-cols-3";

  useEffect(() => {
    const viewport = detectViewport(isMobile);
    const now = new Date();
    supabase
      .rpc("get_personalized_mood_cards", {
        p_viewport: viewport,
        p_hour: now.getHours(),
        p_dow: now.getDay(),
      })
      .then(({ data, error }) => {
        if (error) {
          console.warn("[mood-collections]", error.message);
          setCards([]);
          return;
        }
        setCards((data as Card[]) || []);
      });
  }, [isMobile]);

  if (!cards.length) return null;

  return (
    <section>
      <div className="flex items-end justify-between gap-3 mb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">
            <Sparkles className="h-3 w-3" /> Neked válogatva
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold">Hallgatási helyzetek</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Reggelhez, úthoz, munkához vagy elmélyüléshez igazítva.
          </p>
        </div>
        <Link
          to="/hangulatok"
          className="shrink-0 text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1 whitespace-nowrap"
        >
          Összes helyzet <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className={`grid grid-cols-2 gap-2.5 sm:grid-cols-3 ${desktopGridClass}`}>
        {cards.map((c) => {
          const Icon = ICONS[c.slug] || Sparkles;
          const href = `/hangulatok/${c.slug}`;
          return (
            <Link
              key={c.slug}
              to={href}
              className="group relative min-h-[132px] overflow-hidden rounded-lg border border-border/70 bg-card/70 p-3.5 transition-colors hover:border-primary/40 sm:p-4"
            >
              <div className="flex items-start justify-between">
                <Icon className="h-5 w-5 text-primary" />
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground group-hover:translate-x-0.5 transition-transform" />
              </div>
              <div className="mt-3 font-semibold leading-tight">{polishMoodTitle(c.title, c.slug)}</div>
              <div className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">
                {sanitizeHungarianPublicText(c.short_description) || sanitizeHungarianPublicText(c.description)}
              </div>
              {c.reason_label && (
                <div className="mt-2 inline-flex items-center text-[10px] uppercase tracking-[0.12em] text-primary/80">
                  {c.reason_label}
                </div>
              )}
              {!!c.representative_episode_count && (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {c.representative_episode_count.toLocaleString("hu-HU")} ajánlott epizód
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
