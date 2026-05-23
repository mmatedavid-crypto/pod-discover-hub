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
  const [done, setDone] = useState<boolean>(() => {
    try { return sessionStorage.getItem(KEY) === "1"; } catch { return false; }
  });
  const [submitting, setSubmitting] = useState(false);

  if (done) {
    return (
      <div className="rounded-2xl border border-border bg-card p-5 flex items-start gap-3">
        <div className="h-8 w-8 rounded-full bg-primary/10 text-primary inline-flex items-center justify-center flex-none">
          <Check className="h-4 w-4" />
        </div>
        <div>
          <div className="font-medium">Köszi! Bekerültél a heti listára.</div>
          <div className="text-sm text-muted-foreground mt-1">Heti 3 epizód-ajánlót küldünk, leiratkozás 1 kattintás.</div>
        </div>
      </div>
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
      // 23505 = duplicate (already signed up) — treat as success silently
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
    <form
      onSubmit={handleSubmit}
      className="rounded-2xl border border-border bg-card p-5"
      aria-label="Heti epizód-ajánló feliratkozás"
    >
      <div className="flex items-center gap-2 mb-2">
        <Mail className="h-4 w-4 text-primary" />
        <h3 className="font-medium">Mentsd el a Podiverzumodat</h3>
      </div>
      <p className="text-sm text-muted-foreground mb-4">
        Heti 3 epizód-ajánlót küldünk, pont a te ízlésedhez igazítva. Spam nincs, leiratkozás 1 kattintás.
      </p>
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
        />
        <Button type="submit" disabled={submitting}>
          {submitting ? "Küldés…" : "Feliratkozom"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground mt-3">
        Az e-mail címedet kizárólag a heti ajánló küldésére használjuk. Cookie-t nem teszünk.
      </p>
    </form>
  );
}
