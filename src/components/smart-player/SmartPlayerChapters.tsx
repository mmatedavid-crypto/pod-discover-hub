import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useSmartPlayer, formatTime } from "./SmartPlayerProvider";
import { ListTree, Sparkles, FastForward } from "lucide-react";

type Chapter = { idx: number; start_sec: number; title: string; summary: string | null };

type Props = { episodeId: string; compact?: boolean };

export function SmartPlayerChapters({ episodeId, compact }: Props) {
  const { currentTime, seekTo, currentEpisode } = useSmartPlayer();
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(() => {
    if (!episodeId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("episode_chapters")
        .select("idx,start_sec,title,summary")
        .eq("episode_id", episodeId)
        .order("idx");
      if (cancelled) return;
      if (data && data.length) setChapters(data as Chapter[]);
      else setChapters([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  const generate = async () => {
    if (generating) return;
    setGenerating(true);
    setTried(true);
    try {
      const { data, error } = await supabase.functions.invoke("episode-chapters-generator", {
        body: { episode_id: episodeId },
      });
      if (!error && data?.chapters?.length) {
        setChapters(data.chapters as Chapter[]);
      }
    } finally {
      setGenerating(false);
    }
  };

  if (chapters === null) return null;

  const activeIdx = chapters.reduce(
    (acc, c, i) => (currentTime >= c.start_sec ? i : acc),
    -1,
  );
  const canSkipIntro =
    currentEpisode?.id === episodeId &&
    chapters.length > 1 &&
    currentTime < chapters[1].start_sec &&
    chapters[1].start_sec > 15;

  return (
    <div className={compact ? "" : "w-full max-w-2xl"}>
      <div className="flex items-center justify-between mb-2">
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
          <ListTree className="h-3 w-3" /> Fejezetek
        </div>
        {canSkipIntro && (
          <button
            onClick={() => seekTo(chapters[1].start_sec)}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
          >
            <FastForward className="h-3 w-3" /> Skip intro
          </button>
        )}
      </div>

      {chapters.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border/60 bg-card/40 p-3 text-xs text-muted-foreground flex items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            AI fejezetek nem készültek még ehhez az epizódhoz.
          </span>
          <button
            onClick={generate}
            disabled={generating || tried}
            className="text-xs px-2.5 py-1 rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          >
            {generating ? "Generálás…" : tried ? "Próbálkozva" : "Generálás"}
          </button>
        </div>
      ) : (
        <ul className="space-y-1">
          {chapters.map((c, i) => {
            const active = i === activeIdx;
            return (
              <li key={c.idx}>
                <button
                  onClick={() => seekTo(c.start_sec)}
                  className={`w-full text-left flex items-start gap-3 px-2.5 py-2 rounded-md transition-colors ${
                    active
                      ? "bg-accent/10 border border-accent/40"
                      : "hover:bg-secondary/60 border border-transparent"
                  }`}
                >
                  <span
                    className={`tabular-nums text-[11px] mt-0.5 shrink-0 ${
                      active ? "text-accent font-semibold" : "text-muted-foreground"
                    }`}
                  >
                    {formatTime(c.start_sec)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block text-sm leading-snug ${
                        active ? "text-foreground font-medium" : "text-foreground/90"
                      }`}
                    >
                      {c.title}
                    </span>
                    {c.summary && (
                      <span className="block text-[11px] text-muted-foreground line-clamp-2 mt-0.5">
                        {c.summary}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
