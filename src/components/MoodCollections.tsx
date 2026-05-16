import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { ArrowRight, Coffee, Brain, Moon, GraduationCap, Newspaper, Sparkles, Dumbbell, Car, Smile, Radio } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { getRecentSearches } from "@/lib/recentSearches";

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
  "elalvashoz": Moon,
  "munkaba-menet": Coffee,
  "edzeshez": Dumbbell,
  "hosszu-utra": Car,
  "vilag-esemenyei": Newspaper,
  "mosolyogashoz": Smile,
  "tanulashoz": GraduationCap,
  "elmelyuleshez": Brain,
  "reggeli-radio": Radio,
};

const MOOD_SUBTITLES: Record<string, string> = {
  "elalvashoz": "Csendesebb, lassabb beszélgetések.",
  "munkaba-menet": "Rövidebb, könnyed epizódok.",
  "edzeshez": "Energikusabb, pörgősebb hallgatnivalók.",
  "hosszu-utra": "Hosszabb, mélyebb beszélgetések.",
  "vilag-esemenyei": "A fontos hírek és összefüggések háttere.",
  "mosolyogashoz": "Könnyedebb, szórakoztató epizódok.",
  "tanulashoz": "Tudás és új nézőpontok.",
  "elmelyuleshez": "Lassabb, gondolkodósabb beszélgetések.",
  "reggeli-radio": "A nap legjobb reggeli műsorai.",
};

// Time-of-day → mood slug weights (0..1)
function timeOfDayWeights(hour: number): Record<string, number> {
  // 5-10 reggel, 10-14 délelőtt, 14-18 délután, 18-22 este, 22-5 éjszaka
  if (hour >= 5 && hour < 10) {
    return { "munkaba-menet": 1.0, "reggeli-radio": 1.0, "vilag-esemenyei": 0.7, "mosolyogashoz": 0.5 };
  }
  if (hour >= 10 && hour < 14) {
    return { "tanulashoz": 0.9, "vilag-esemenyei": 0.8, "elmelyuleshez": 0.5, "mosolyogashoz": 0.4 };
  }
  if (hour >= 14 && hour < 18) {
    return { "edzeshez": 0.9, "hosszu-utra": 0.8, "mosolyogashoz": 0.7, "tanulashoz": 0.5 };
  }
  if (hour >= 18 && hour < 22) {
    return { "mosolyogashoz": 0.9, "elmelyuleshez": 0.9, "hosszu-utra": 0.6, "vilag-esemenyei": 0.5 };
  }
  return { "elalvashoz": 1.0, "elmelyuleshez": 0.7, "mosolyogashoz": 0.4 };
}

// Search-keyword → mood slug weight
const SEARCH_KEYWORDS: Array<{ re: RegExp; slug: string; w: number }> = [
  { re: /\b(alvás|alszik|elalv|relax|meditác|nyugod)/i, slug: "elalvashoz", w: 1.0 },
  { re: /\b(reggel|ébred|kávé)/i, slug: "munkaba-menet", w: 0.8 },
  { re: /\b(reggel|rádió|balázs|bochkor)/i, slug: "reggeli-radio", w: 0.9 },
  { re: /\b(edzés|futás|sport|fitness|kondi)/i, slug: "edzeshez", w: 1.0 },
  { re: /\b(út|autó|vezet|hosszú)/i, slug: "hosszu-utra", w: 0.7 },
  { re: /\b(hír|politik|gazdaság|világ|háború|választás)/i, slug: "vilag-esemenyei", w: 1.0 },
  { re: /\b(humor|vicc|nevet|stand[- ]?up|komédi)/i, slug: "mosolyogashoz", w: 1.0 },
  { re: /\b(tanul|oktatás|tudomány|történel|ai|mesterséges)/i, slug: "tanulashoz", w: 0.9 },
  { re: /\b(filozóf|pszich|önism|spirit|gondolkod)/i, slug: "elmelyuleshez", w: 0.9 },
];

function scoreMoods(moods: Mood[], hour: number, recents: string[]): Mood[] {
  const tod = timeOfDayWeights(hour);
  const recentText = recents.slice(0, 10).join(" ");
  const recentWeights: Record<string, number> = {};
  if (recentText) {
    for (const { re, slug, w } of SEARCH_KEYWORDS) {
      if (re.test(recentText)) recentWeights[slug] = Math.max(recentWeights[slug] || 0, w);
    }
  }
  return moods
    .map((m, idx) => {
      const popularity = Math.max(0, 1 - idx / Math.max(1, moods.length)) * 0.3; // sort_order baseline
      const todScore = (tod[m.slug] || 0) * 1.0;
      const recentScore = (recentWeights[m.slug] || 0) * 1.2;
      const filled = (m.podcast_ids?.length || 0) + (m.episode_ids?.length || 0) > 0 ? 0.2 : 0;
      const score = popularity + todScore + recentScore + filled + Math.random() * 0.05;
      return { m, score };
    })
    .sort((a, b) => b.score - a.score)
    .map((x) => x.m);
}

export function MoodCollections() {
  const [moods, setMoods] = useState<Mood[]>([]);
  const isMobile = useIsMobile();

  useEffect(() => {
    supabase
      .from("mood_collections" as any)
      .select("id,slug,title,mood,description,accent_hsl,podcast_ids,episode_ids,sort_order")
      .eq("active", true)
      .order("sort_order")
      .then(({ data }) => setMoods((data as any) || []));
  }, []);

  const ranked = useMemo(() => moods, [moods]);

  const visible = useMemo(() => (isMobile ? ranked.slice(0, 4) : ranked), [ranked, isMobile]);

  if (!visible.length) return null;

  return (
    <section>
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">
            <Sparkles className="h-3 w-3" /> Hallgatási helyzetek
          </div>
          <h2 className="text-xl sm:text-2xl font-semibold">Mihez van most kedved?</h2>
          <p className="text-xs text-muted-foreground mt-1">Válogatott ajánlók, rendszeresen frissítve.</p>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {visible.map((m) => {
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
              <div className="text-[11px] text-muted-foreground mt-0.5">{MOOD_SUBTITLES[m.slug] || m.description || ""}</div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
