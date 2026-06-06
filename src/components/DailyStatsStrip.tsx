import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Radio, Mic, TrendingUp, Users } from "lucide-react";

type Stats = {
  newEpisodes24h: number;
  activePodcasts24h: number;
  newEpisodes7d: number;
  hungarianPodcasts: number;
};

export default function DailyStatsStrip() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      const day = new Date(Date.now() - 24 * 3600_000).toISOString();
      const week = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

      const [d24Rows, d24Count, d7, podcastsRes] = await Promise.all([
        supabase.from("episodes").select("id, podcast_id, podcasts!inner(language_decision)", { count: "exact", head: false })
          .gte("published_at", day)
          .eq("podcasts.language_decision", "accept_hungarian")
          .limit(1000),
        supabase.from("episodes").select("id, podcasts!inner(language_decision)", { count: "exact", head: true })
          .eq("podcasts.language_decision", "accept_hungarian")
          .gte("published_at", day),
        supabase.from("episodes").select("id, podcasts!inner(language_decision)", { count: "exact", head: true })
          .eq("podcasts.language_decision", "accept_hungarian")
          .gte("published_at", week),
        supabase.from("podcasts").select("id", { count: "exact", head: true })
          .eq("language_decision", "accept_hungarian"),
      ]);

      const podcastIds = new Set((d24Rows.data || []).map((r: any) => r.podcast_id));

      setS({
        newEpisodes24h: d24Count.count || (d24Rows.data?.length ?? 0),
        activePodcasts24h: podcastIds.size,
        newEpisodes7d: d7.count || 0,
        hungarianPodcasts: podcastsRes.count || 0,
      });
    })();
  }, []);

  if (!s) return null;

  const items = [
    { Icon: Mic, value: s.newEpisodes24h, label: "új epizód · 24 óra" },
    { Icon: Radio, value: s.activePodcasts24h, label: "aktív podcast · 24 óra" },
    { Icon: TrendingUp, value: s.newEpisodes7d, label: "új epizód · 7 nap" },
    { Icon: Users, value: s.hungarianPodcasts, label: "magyar podcast összesen" },
  ];

  return (
    <div className="-mx-4 sm:mx-0 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max gap-2.5 px-4 sm:grid sm:min-w-0 sm:grid-cols-4 sm:px-0 sm:gap-3">
        {items.map(({ Icon, value, label }, i) => (
          <div key={i} className="w-[172px] rounded-lg border border-border bg-card/40 p-3 text-center sm:w-auto sm:p-4">
            <Icon className="h-4 w-4 text-primary mx-auto" aria-hidden />
            <div className="font-serif text-2xl sm:text-3xl font-bold mt-2 tabular-nums">{value.toLocaleString("hu-HU")}</div>
            <div className="text-[10px] sm:text-[11px] uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
