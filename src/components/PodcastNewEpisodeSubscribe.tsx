import { useState } from "react";
import { Bell, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function PodcastNewEpisodeSubscribe({
  podcastId,
  podcastTitle,
}: {
  podcastId: string;
  podcastTitle: string;
}) {
  const storageKey = `pv_ep_sub_${podcastId}`;
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<boolean>(() => {
    try {
      return localStorage.getItem(storageKey) === "1";
    } catch {
      return false;
    }
  });
  const [submitting, setSubmitting] = useState(false);

  if (done) {
    return (
      <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
        <Check className="h-4 w-4 text-primary" />
        Feliratkoztál új epizódokra
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-md border border-border bg-card/70 px-3 py-2 text-sm text-foreground hover:bg-secondary transition-colors"
        aria-label="Kérek értesítést új epizódról"
      >
        <Bell className="h-4 w-4" />
        Kérek értesítést új epizódról
      </button>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const v = email.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) {
      toast.error("Adj meg egy érvényes e-mail címet.");
      return;
    }
    setSubmitting(true);
    try {
      const { error } = await supabase
        .from("podcast_email_subscriptions")
        .insert({ podcast_id: podcastId, email: v, source: "podcast_detail" });

      // 23505 = unique_violation → already subscribed, still success from UX POV
      if (error && error.code !== "23505") {
        toast.error("Nem sikerült feliratkozni. Próbáld újra.");
        setSubmitting(false);
        return;
      }

      try { localStorage.setItem(storageKey, "1"); } catch { /* ignore */ }
      setDone(true);
      toast.success(
        error?.code === "23505"
          ? "Már fel voltál iratkozva – megyünk tovább!"
          : `Feliratkoztál! Új ${podcastTitle} epizódról azonnal küldünk emailt.`
      );
    } catch {
      toast.error("Hiba történt. Próbáld újra.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2" aria-label="Email értesítés új epizódról">
      <div className="flex flex-col sm:flex-row gap-2">
        <Input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          placeholder="te@email.hu"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1"
          autoFocus
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? "Küldés…" : "Értesítést kérek"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Csak új epizód érkezésekor küldünk emailt. Leiratkozás 1 kattintással.
      </p>
    </form>
  );
}
