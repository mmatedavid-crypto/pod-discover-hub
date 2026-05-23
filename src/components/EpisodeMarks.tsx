import { useEffect, useState } from "react";
import { Heart, Bookmark } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

type Props = { episodeId: string; compact?: boolean };

export function EpisodeMarks({ episodeId, compact = false }: Props) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [fav, setFav] = useState(false);
  const [later, setLater] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) { setFav(false); setLater(false); return; }
    supabase
      .from("user_episode_marks")
      .select("mark_type")
      .eq("user_id", user.id)
      .eq("episode_id", episodeId)
      .then(({ data }) => {
        setFav(!!data?.find((r: any) => r.mark_type === "favorite"));
        setLater(!!data?.find((r: any) => r.mark_type === "listen_later"));
      });
  }, [user, episodeId]);

  const toggle = async (type: "favorite" | "listen_later") => {
    if (!user) {
      nav(`/belepes?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (busy) return;
    setBusy(true);
    const isOn = type === "favorite" ? fav : later;
    if (isOn) {
      await supabase
        .from("user_episode_marks")
        .delete()
        .eq("user_id", user.id)
        .eq("episode_id", episodeId)
        .eq("mark_type", type);
      type === "favorite" ? setFav(false) : setLater(false);
    } else {
      const { error } = await supabase
        .from("user_episode_marks")
        .insert({ user_id: user.id, episode_id: episodeId, mark_type: type });
      if (!error) {
        type === "favorite" ? setFav(true) : setLater(true);
        toast.success(type === "favorite" ? "Kedvencekhez adva" : "Meghallgatandóhoz adva");
      }
    }
    setBusy(false);
  };

  const sz = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  const btn = compact ? "h-8 w-8" : "h-8 w-8";

  return (
    <div className="flex gap-1.5">
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle("favorite"); }}
        aria-label={fav ? "Kedvenc eltávolítása" : "Kedvencekhez"}
        title={fav ? "Kedvenc" : "Kedvencekhez"}
        className={`${btn} inline-flex items-center justify-center rounded-md border transition-colors ${
          fav
            ? "border-red-500/50 bg-red-500/10 text-red-500"
            : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
        }`}
      >
        <Heart className={`${sz} ${fav ? "fill-current" : ""}`} />
      </button>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggle("listen_later"); }}
        aria-label={later ? "Meghallgatandóból eltávolítás" : "Meghallgatandóhoz"}
        title={later ? "Meghallgatandó" : "Meghallgatandóhoz"}
        className={`${btn} inline-flex items-center justify-center rounded-md border transition-colors ${
          later
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
        }`}
      >
        <Bookmark className={`${sz} ${later ? "fill-current" : ""}`} />
      </button>
    </div>
  );
}
