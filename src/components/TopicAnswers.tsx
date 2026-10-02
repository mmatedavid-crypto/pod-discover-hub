import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

type Row = {
  answer_id: string; anchor: string; question: string; answer: string;
  episode_title: string; episode_slug: string; podcast_title: string; podcast_slug: string;
};

/** Pilot: grounded episode answers linked to this topic. Hidden when none. */
export function TopicAnswers({ topicId }: { topicId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    let cancelled = false;
    (supabase as any).rpc("topic_episode_answers", { _topic_id: topicId, _limit: 6 })
      .then(({ data }: any) => { if (!cancelled) setRows((data || []) as Row[]); });
    return () => { cancelled = true; };
  }, [topicId]);
  if (!rows.length) return null;
  return (
    <section>
      <h2 className="text-xl font-semibold mb-3">Kérdések, amikre epizódok válaszolnak</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.map((r) => (
          <Link
            key={r.answer_id}
            to={`/podcast/${r.podcast_slug}/${r.episode_slug}#${r.anchor}`}
            className="rounded-lg border border-border bg-card p-3 hover:border-primary/50"
          >
            <div className="text-sm font-semibold text-foreground">{r.question}</div>
            <p className="mt-1 text-sm text-foreground/80 line-clamp-3">{r.answer}</p>
            <div className="mt-2 text-xs text-muted-foreground">{r.podcast_title} · {r.episode_title}</div>
          </Link>
        ))}
      </div>
    </section>
  );
}
