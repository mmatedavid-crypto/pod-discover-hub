import { useEffect, useState } from "react";
import { Heart, X, Loader2, Sparkles } from "lucide-react";
import { recordTasteInteraction, type TasteInteractionKind } from "@/lib/tasteInteractions";
import { cn } from "@/lib/utils";

type Props = {
  episodeId: string;
  source?: string;
  className?: string;
  onChange?: (kind: "like" | "dislike") => void;
};

export function LikeDislikeButtons({ episodeId, source = "recommended_feed", className, onChange }: Props) {
  const [state, setState] = useState<null | "like" | "dislike">(null);
  const [pending, setPending] = useState<TasteInteractionKind | null>(null);

  // Per-session memory of the last action so the UI persists during the visit.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(`taste:${episodeId}`);
      if (raw === "like" || raw === "dislike") setState(raw);
    } catch { /* ignore */ }
  }, [episodeId]);

  const fire = async (kind: "like" | "dislike", e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPending(kind);
    await recordTasteInteraction(episodeId, kind, source);
    setState(kind);
    try { sessionStorage.setItem(`taste:${episodeId}`, kind); } catch { /* ignore */ }
    setPending(null);
    onChange?.(kind);
  };

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <button
        type="button"
        aria-label="Nem érdekel"
        onClick={(e) => fire("dislike", e)}
        disabled={!!pending}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background/80 backdrop-blur transition",
          "hover:bg-muted hover:scale-105",
          state === "dislike" && "border-destructive/60 bg-destructive/10 text-destructive",
        )}
      >
        {pending === "dislike" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        aria-label="Tetszik"
        onClick={(e) => fire("like", e)}
        disabled={!!pending}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-full border border-border/60 bg-background/80 backdrop-blur transition",
          "hover:bg-muted hover:scale-105",
          state === "like" && "border-primary/60 bg-primary/10 text-primary",
        )}
      >
        {pending === "like" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Heart className={cn("h-3.5 w-3.5", state === "like" && "fill-current")} />}
      </button>
    </div>
  );
}

export function TasteBadge({ count }: { count: number }) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/40 px-2.5 py-1 text-xs text-muted-foreground">
      <Sparkles className="h-3 w-3" />
      {count === 0
        ? "Még csak induló profil"
        : `${count} interakcióból épül a profilod`}
    </div>
  );
}
