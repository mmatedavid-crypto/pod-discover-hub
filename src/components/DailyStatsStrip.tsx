import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Radio, Mic, TrendingUp, Users } from "lucide-react";

type Stats = {
  newEpisodes24h: number;
  activePodcasts24h: number;
  newEpisodes7d: number;
  topPeople: number;
};

export default function DailyStatsStrip() {
  const [s, setS] = useState<Stats | null>(null);

  useEffect(() => {
    (async () => {
      const day = new Date(Date.now() - 24 * 3600_000).toISOString();
      const week = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();

      const [d24, d7, podcastsRes] = await Promise.all([
        supabase.from("episodes").select("id, podcast_id", { count: "exact", head: false })
          .gte("published_at", day).limit(1000),
        supabase.from("episodes").select("id", { count: "exact", head: true })
          .gte("published_at", week),
        supabase.from("podcasts").select("id", { count: "exact", head: true })
          .ilike("language", "hu%"),
      ]);

      const podcastIds = new Set((d24.data || []).map((r: any) => r.podcast_id));

      setS({
        newEpisodes24h: d24.count || (d24.data?.length ?? 0),
        activePodcasts24h: podcastIds.size,
        newEpisodes7d: d7.count || 0,
        topPeople: podcastsRes.count || 0,
      });
    })();
  }, []);

  if (!s) return null;

  const items = [
    { Icon: Mic, value: s.newEpisodes24h, label: "új epizód · 24 óra" },
    { Icon: Radio, value: s.activePodcasts24h, label: "aktív podcast · 24 óra" },
    { Icon: TrendingUp, value: s.newEpisodes7d, label: "új epizód · 7 nap" },
    { Icon: Users, value: s.topPeople, label: "magyar podcast összesen" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(({ Icon, value, label }, i) => (
        <div key={i} className="rounded-xl border border-border bg-card/40 p-4 text-center">
          <Icon className="h-4 w-4 text-primary mx-auto" aria-hidden />
          <div className="font-serif text-3xl font-bold mt-2 tabular-nums">{value.toLocaleString("hu-HU")}</div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground mt-1">{label}</div>
        </div>
      ))}
    </div>
  );
}
