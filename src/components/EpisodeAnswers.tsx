import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useLocation } from "react-router-dom";
import { Play, HelpCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { logPlayerEvent } from "@/lib/playerEvents";

type Answer = {
  id: string;
  anchor: string;
  question: string;
  answer: string;
  speaker: string | null;
  start_sec: number | null;
  timestamp_status: string;
  content_version: string;
  pilot_group: string;
};

function fmt(s: number) {
  const t = Math.floor(s);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`;
}

/** Pilot: grounded episode Q&A. Renders nothing outside the treatment group. */
export function EpisodeAnswers({ episodeId }: { episodeId: string }) {
  const { data: rows = [] } = useQuery({
    queryKey: ["public-episode-answers", episodeId],
    enabled: Boolean(episodeId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("episode_answers_public")
        .select("id,anchor,question,answer,speaker,start_sec,timestamp_status,content_version,pilot_group")
        .eq("episode_id", episodeId)
        .order("position");
      if (error) throw error;
      return (data || []) as Answer[];
    },
  });
  const navigate = useNavigate();
  const location = useLocation();

  const scrolledAnswer = useRef<string | null>(null);
  useEffect(() => {
    if (!location.hash) {
      scrolledAnswer.current = null;
      return;
    }
    let anchor: string;
    try { anchor = decodeURIComponent(location.hash.slice(1)); }
    catch { return; }
    const targetKey = `${episodeId}:${location.key}:${anchor}`;
    if (scrolledAnswer.current === targetKey || !rows.some((r) => r.anchor === anchor)) return;
    // The anchor does not exist until the public answers finish loading.
    const target = document.getElementById(anchor);
    if (target) {
      target.scrollIntoView({ block: "start" });
      scrolledAnswer.current = targetKey;
    }
  }, [episodeId, location.hash, location.key, rows]);

  if (!rows.length) return null;

  return (
    <section className="mt-6 rounded-lg border border-border bg-card p-4" aria-labelledby="episode-answers-title">
      <h2 id="episode-answers-title" className="mb-3 inline-flex items-center gap-1.5 text-xs uppercase tracking-wide text-accent">
        <HelpCircle className="h-3.5 w-3.5" /> Milyen kérdésekre kapsz választ?
      </h2>
      <div className="space-y-4">
        {rows.map((r) => {
          const canSeek = r.timestamp_status === "audio_verified" && r.start_sec != null && Number.isFinite(r.start_sec) && r.start_sec >= 0;
          return (
            <div key={r.id} id={r.anchor} className="scroll-mt-24">
              <h3 className="text-sm font-semibold text-foreground">{r.question}</h3>
              <p className="mt-1 text-sm leading-relaxed text-foreground/85">
                {r.answer}
                {r.speaker && <span className="text-muted-foreground"> — {r.speaker}</span>}
              </p>
              {canSeek && (
                <button
                  type="button"
                  data-answer-id={r.id}
                  onClick={() => {
                    logPlayerEvent({ eventType: "play_seek", episodeId, positionSec: r.start_sec!, meta: { source: "episode_answer", answer_id: r.id, anchor: r.anchor, content_version: r.content_version, pilot_group: r.pilot_group } });
                    const params = new URLSearchParams(location.search);
                    params.set("t", String(Math.floor(r.start_sec!)));
                    params.set("qa", r.anchor);
                    navigate({ pathname: location.pathname, search: params.toString(), hash: location.hash }, { replace: true });
                  }}
                  className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-secondary/60"
                >
                  <Play className="h-3 w-3" /> Hallgasd meg {fmt(r.start_sec!)}-tól
                </button>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-[11px] text-muted-foreground">
        A válaszok az epizód gépi leiratából, a beszélgetés alapján készültek; nem helyettesítik a szakmai tanácsot.
      </p>
    </section>
  );
}
