import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Bookmark, History, ArrowRight } from "lucide-react";

type Item = {
  episode_id: string;
  episode_title: string;
  episode_slug: string;
  episode_image_url: string | null;
  podcast_title: string;
  podcast_slug: string;
  podcast_image_url: string | null;
  position_seconds?: number;
  duration_seconds?: number | null;
};

function Card({ it, showProgress }: { it: Item; showProgress?: boolean }) {
  const pct =
    showProgress && it.position_seconds && it.duration_seconds && it.duration_seconds > 0
      ? Math.min(100, Math.round((it.position_seconds / it.duration_seconds) * 100))
      : null;
  const img = it.episode_image_url || it.podcast_image_url;
  return (
    <Link
      to={`/podcast/${it.podcast_slug}/${it.episode_slug}`}
      className="group flex gap-3 p-3 rounded-xl border border-border/60 bg-card/40 hover:border-primary/40 transition-colors"
    >
      {img ? (
        <img
          src={img}
          alt=""
          loading="lazy"
          className="h-14 w-14 rounded-md object-cover flex-shrink-0"
        />
      ) : (
        <div className="h-14 w-14 rounded-md bg-secondary flex-shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors">
          {it.episode_title}
        </div>
        <div className="text-xs text-muted-foreground mt-1 truncate">{it.podcast_title}</div>
        {pct !== null && (
          <div className="mt-2 h-1 bg-secondary rounded overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </Link>
  );
}

export function MyLibraryRails() {
  const { user } = useAuth();
  const [progress, setProgress] = useState<Item[]>([]);
  const [saved, setSaved] = useState<Item[]>([]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      // Continue listening (incomplete progress)
      const { data: prog } = await supabase
        .from("playback_progress")
        .select("episode_id, position_seconds, duration_seconds, updated_at")
        .eq("user_id", user.id)
        .eq("completed", false)
        .gt("position_seconds", 20)
        .order("updated_at", { ascending: false })
        .limit(8);

      // Saved for later
      const { data: marks } = await supabase
        .from("user_episode_marks")
        .select("episode_id, created_at")
        .eq("user_id", user.id)
        .eq("mark_type", "listen_later")
        .order("created_at", { ascending: false })
        .limit(8);

      const ids = Array.from(
        new Set([
          ...((prog || []).map((p) => p.episode_id)),
          ...((marks || []).map((m) => m.episode_id)),
        ]),
      );
      if (!ids.length) {
        if (!cancelled) {
          setProgress([]);
          setSaved([]);
        }
        return;
      }

      const { data: eps } = await supabase
        .from("episodes")
        .select(
          "id,title,display_title,slug,image_url,podcasts:podcast_id(slug,title,display_title,image_url)",
        )
        .in("id", ids);

      const map = new Map<string, any>();
      (eps || []).forEach((e: any) => map.set(e.id, e));
      const build = (epId: string): Item | null => {
        const e = map.get(epId);
        if (!e) return null;
        return {
          episode_id: e.id,
          episode_title: e.display_title || e.title,
          episode_slug: e.slug,
          episode_image_url: e.image_url,
          podcast_title: e.podcasts?.display_title || e.podcasts?.title || "",
          podcast_slug: e.podcasts?.slug || "",
          podcast_image_url: e.podcasts?.image_url || null,
        };
      };

      if (!cancelled) {
        setProgress(
          (prog || [])
            .map((p) => {
              const base = build(p.episode_id);
              if (!base) return null;
              return {
                ...base,
                position_seconds: p.position_seconds,
                duration_seconds: p.duration_seconds,
              };
            })
            .filter(Boolean) as Item[],
        );
        setSaved((marks || []).map((m) => build(m.episode_id)).filter(Boolean) as Item[]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!user) return null;
  if (!progress.length && !saved.length) return null;

  return (
    <div className="space-y-8">
      {progress.length > 0 && (
        <section>
          <div className="flex items-end justify-between mb-4">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-1">
                <History className="h-3 w-3" /> Folytatás
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold">Folytasd ott, ahol abbahagytad</h2>
            </div>
          </div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {progress.slice(0, 6).map((it) => (
              <Card key={`p:${it.episode_id}`} it={it} showProgress />
            ))}
          </div>
        </section>
      )}
      {saved.length > 0 && (
        <section>
          <div className="flex items-end justify-between mb-4">
            <div>
              <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">
                <Bookmark className="h-3 w-3" /> Mentett
              </div>
              <h2 className="text-xl sm:text-2xl font-semibold">Mentett epizódok</h2>
            </div>
            <Link
              to="/profil"
              className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Összes <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
            {saved.slice(0, 6).map((it) => (
              <Card key={`s:${it.episode_id}`} it={it} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
