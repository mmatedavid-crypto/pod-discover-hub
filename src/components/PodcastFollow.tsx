import { useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";

export function PodcastFollow({ podcastId, variant = "default" }: { podcastId: string; variant?: "default" | "icon" }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) { setFollowing(false); return; }
    supabase
      .from("user_podcast_follows")
      .select("id")
      .eq("user_id", user.id)
      .eq("podcast_id", podcastId)
      .maybeSingle()
      .then(({ data }) => setFollowing(!!data));
  }, [user, podcastId]);

  const toggle = async () => {
    if (!user) {
      nav(`/belepes?redirect=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (busy) return;
    setBusy(true);
    if (following) {
      await supabase
        .from("user_podcast_follows")
        .delete()
        .eq("user_id", user.id)
        .eq("podcast_id", podcastId);
      setFollowing(false);
    } else {
      const { error } = await supabase
        .from("user_podcast_follows")
        .insert({ user_id: user.id, podcast_id: podcastId });
      if (!error) {
        setFollowing(true);
        toast.success("Követve. Hetente küldünk emailt az új epizódokról.");
      }
    }
    setBusy(false);
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={toggle}
        aria-label={following ? "Követve" : "Követem"}
        className={`inline-flex items-center justify-center h-8 w-8 rounded-md border transition-colors ${
          following
            ? "border-primary/50 bg-primary/10 text-primary"
            : "border-border bg-card text-muted-foreground hover:text-foreground hover:border-primary/40"
        }`}
      >
        {following ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-sm font-medium transition-colors ${
        following
          ? "border-primary/50 bg-primary/10 text-primary hover:bg-primary/15"
          : "border-border bg-card text-foreground hover:border-primary/40 hover:bg-secondary/60"
      }`}
    >
      {following ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
      {following ? "Követed" : "Követem"}
    </button>
  );
}
