import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Quote } from "lucide-react";

type EpRef = { id: string; slug: string; title: string; podcast_slug?: string; podcast_title?: string };
type QuoteData = { text: string; why?: string | null; episode?: EpRef | null };

function todayISO(): string {
  const parts = new Intl.DateTimeFormat("hu-HU", {
    timeZone: "Europe/Budapest", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value || "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export default function DailyEditorials() {
  const [quote, setQuote] = useState<QuoteData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: row } = await supabase
        .from("daily_brief_extras")
        .select("quote")
        .eq("date", todayISO())
        .maybeSingle();
      if (row?.quote) setQuote(row.quote as unknown as QuoteData);
      setLoading(false);
    })();
  }, []);

  if (loading || !quote) return null;

  return (
    <section className="rounded-xl border border-border bg-card/40 p-5">
      <div className="flex items-start gap-3">
        <Quote className="h-5 w-5 text-primary mt-1 shrink-0" aria-hidden />
        <div className="flex-1 min-w-0">
          <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground mb-1.5">
            A nap idézete
          </div>
          <blockquote className="text-base sm:text-lg leading-snug text-foreground">
            „{quote.text}"
          </blockquote>
          {quote.episode && (
            <Link
              to={`/podcast/${quote.episode.podcast_slug}/${quote.episode.slug}`}
              className="block mt-2.5 text-xs text-muted-foreground hover:text-primary transition-colors"
            >
              — <span className="text-foreground">{quote.episode.title}</span>
              {quote.episode.podcast_title && <> · {quote.episode.podcast_title}</>}
            </Link>
          )}
        </div>
      </div>
    </section>
  );
}
