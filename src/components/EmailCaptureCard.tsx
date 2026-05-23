import { useState } from "react";
import { Mail, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { trackLandingEvent } from "@/lib/landingEvents";

const KEY = "pv_email_capture_done";

export function EmailCaptureCard({ archetypeSlug }: { archetypeSlug?: string }) {
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<boolean>(() => {
    try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
  });
  const [submitting, setSubmitting] = useState(false);

  if (done) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Check className="h-4 w-4 text-primary" />
        Köszi! Bekerültél a heti listára.
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors underline-offset-4 hover:underline"
      >
        <Mail className="h-3.5 w-3.5" />
        Kérek heti ajánlót emailben
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
      let sid: string | null = null;
      try { sid = sessionStorage.getItem("pv_anon_sid"); } catch { /* ignore */ }
      let utm: Partial<Record<string, string>> = {};
      try { utm = JSON.parse(sessionStorage.getItem("pv_utm_snapshot") || "{}"); } catch { /* ignore */ }

      const { error } = await supabase.from("landing_email_signups").insert({
        email: v,
        anonymous_session_id: sid,
        source: "swipe_result",
        utm_source: utm.utm_source ?? null,
        utm_medium: utm.utm_medium ?? null,
        utm_campaign: utm.utm_campaign ?? null,
        utm_content: utm.utm_content ?? null,
        archetype_slug: archetypeSlug ?? null,
      });
      if (error && error.code !== "23505") {
        toast.error("Nem sikerült feliratkozni. Próbáld újra.");
        setSubmitting(false);
        return;
      }
      trackLandingEvent("RegistrationCompleted", { method: "email" });
      try { sessionStorage.setItem(KEY, "1"); } catch { /* ignore */ }
      setDone(true);
      toast.success("Megvagy! Heti listára felvettünk.");
    } catch {
      toast.error("Hiba történt. Próbáld újra.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-2" aria-label="Heti epizód-ajánló feliratkozás">
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
          {submitting ? "Küldés…" : "Feliratkozom"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Heti 3 ajánló. Spam nincs, leiratkozás 1 kattintás. Cookie-t nem teszünk.
      </p>
    </form>
  );
}
