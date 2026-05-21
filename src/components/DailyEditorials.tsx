import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, Quote } from "lucide-react";

type EpRef = { id: string; slug: string; title: string; podcast_slug?: string; podcast_title?: string };
type Event = { year: number; title: string; summary: string; episodes?: EpRef[]; hu_related?: boolean };
type QuoteData = { text: string; why?: string | null; episode?: EpRef | null };

type Extras = { on_this_day: Event[]; quote: QuoteData | null };

function todayISO(): string {
  const parts = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export default function DailyEditorials() {
  const [data, setData] = useState<Extras | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: row } = await supabase
        .from("daily_brief_extras")
        .select("on_this_day, quote")
        .eq("date", todayISO())
        .maybeSingle();
      if (row) {
        setData({
          on_this_day: Array.isArray(row.on_this_day) ? (row.on_this_day as unknown as Event[]) : [],
          quote: (row.quote as unknown as QuoteData) || null,
        });
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return null;
  if (!data || (!data.on_this_day?.length && !data.quote)) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Ezen a napon — 2 col */}
      {data.on_this_day?.length > 0 && (
        <section className="lg:col-span-2 rounded-2xl border border-border bg-card/40 p-5 sm:p-6">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="h-4 w-4 text-primary" />
            <h2 className="font-serif text-2xl font-semibold">Ezen a napon történt</h2>
          </div>
          <ol className="space-y-4">
            {data.on_this_day.map((ev, i) => (
              <li key={i} className="border-l-2 border-primary/40 pl-4">
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="font-serif text-2xl font-bold text-primary tabular-nums">{ev.year}</span>
                  <h3 className="font-medium text-base">{ev.title}</h3>
                  {ev.hu_related && (
                    <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">HU</span>
                  )}
                </div>
                <p className="text-sm text-muted-foreground mt-1">{ev.summary}</p>
                {ev.episodes && ev.episodes.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                    <span className="text-muted-foreground">Kapcsolódó epizódok:</span>
                    {ev.episodes.map((e, j) => (
                      <Link
                        key={j}
                        to={`/podcast/${e.podcast_slug}/${e.slug}`}
                        className="text-primary hover:underline truncate max-w-[28ch]"
                        title={e.title}
                      >
                        {e.title}
                      </Link>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Napi idézet — 1 col */}
      {data.quote && (
        <section className="rounded-2xl border border-border bg-gradient-to-br from-primary/5 to-card/40 p-5 sm:p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Quote className="h-4 w-4 text-primary" />
            <h2 className="font-serif text-2xl font-semibold">A nap idézete</h2>
          </div>
          <blockquote className="font-serif italic text-lg leading-snug text-foreground flex-1">
            „{data.quote.text}"
          </blockquote>
          {data.quote.episode && (
            <Link
              to={`/podcast/${data.quote.episode.podcast_slug}/${data.quote.episode.slug}`}
              className="block mt-4 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              — <span className="text-foreground">{data.quote.episode.title}</span>
              {data.quote.episode.podcast_title && <> · {data.quote.episode.podcast_title}</>}
            </Link>
          )}
        </section>
      )}
    </div>
  );
}
