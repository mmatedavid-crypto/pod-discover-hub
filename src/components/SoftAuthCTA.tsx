import { useEffect, useState } from "react";
import { Sparkles, X, Check } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";

const DISMISS_KEY = "podiverzum_auth_cta_dismissed_v1";

type Props = {
  archetypeSlug: string;
  archetypeResult: any;
};

/**
 * Soft CTA at the end of /start. Three states:
 *  - logged in + archetype saved: green "elmentve" confirmation
 *  - logged in + not yet saved: auto-save effect + confirmation
 *  - not logged in: elegant card with Google sign-in (passes archetype via sessionStorage)
 */
export function SoftAuthCTA({ archetypeSlug, archetypeResult }: Props) {
  const { user, profile, refreshProfile } = useAuth();
  const nav = useNavigate();
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const [savedNow, setSavedNow] = useState(false);

  // Auto-save archetype for logged-in users
  useEffect(() => {
    if (!user || !archetypeSlug) return;
    const hasCompleteResult = Boolean(
      profile?.archetype_result?.result_title &&
      Array.isArray(profile?.archetype_result?.tags) &&
      profile.archetype_result.tags.length > 0,
    );
    if (profile?.archetype_slug === archetypeSlug && hasCompleteResult) return;
    (async () => {
      const { error } = await supabase
        .from("profiles")
        .update({
          archetype_slug: archetypeSlug,
          archetype_result: archetypeResult,
        })
        .eq("user_id", user.id);
      if (!error) {
        setSavedNow(true);
        refreshProfile();
      }
    })();
  }, [user, profile?.archetype_slug, archetypeSlug, archetypeResult, refreshProfile]);

  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    if (loading) return;
    setLoading(true);
    // Stash archetype so the post-redirect page can persist it to the new profile
    try {
      sessionStorage.setItem("podiverzum_pending_archetype", JSON.stringify({
        slug: archetypeSlug,
        result: archetypeResult,
      }));
    } catch { /* ignore */ }
    import("@/lib/landingEvents").then(({ trackLandingEvent }) => trackLandingEvent("RegistrationStarted")).catch(() => {});

    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + "/en-podiverzumom",
    });
    if (result.error) {
      toast.error("Bejelentkezés sikertelen. Próbáld újra.");
      setLoading(false);
      return;
    }
    if (result.redirected) return; // browser handles redirect
    nav("/en-podiverzumom", { replace: true });
  };

  const handleDismiss = () => {
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch { /* ignore */ }
    setDismissed(true);
  };

  if (user) {
    // Logged in — show subtle confirmation
    if (!savedNow && profile?.archetype_slug !== archetypeSlug) return null;
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0">
          <Check className="h-4 w-4 text-emerald-500" />
        </div>
        <div className="text-sm">
          <div className="font-medium text-foreground">Elmentve a fiókodba</div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Megnyithatod bármikor itt:{" "}
            <button onClick={() => nav("/en-podiverzumom")} className="underline hover:text-foreground">
              Az én Podiverzumom
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (dismissed) return null;

  return (
    <div className="relative rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/8 via-card to-card p-5 sm:p-6">
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Bezárás"
        className="absolute top-3 right-3 h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-primary">
        <Sparkles className="h-3.5 w-3.5" />
        Mentsd el a Podiverzumodat
      </div>
      <h3 className="mt-3 text-xl sm:text-2xl font-semibold tracking-tight">
        Ne vesszen el — legyen örökre a tiéd.
      </h3>
      <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
        <li className="flex items-start gap-2">
          <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <span>A Podiverzumod örökre megmarad — bármelyik eszközről eléred.</span>
        </li>
        <li className="flex items-start gap-2">
          <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <span>Kedvenc és meghallgatandó epizódok egy helyen.</span>
        </li>
        <li className="flex items-start gap-2">
          <Check className="h-4 w-4 text-primary mt-0.5 shrink-0" />
          <span>Heti email arról, ha új rész jött a követett podcastjaidnál.</span>
        </li>
      </ul>
      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={handleSignIn}
          disabled={loading}
          className="inline-flex items-center gap-2.5 px-4 py-2 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-60"
        >
          <GoogleGlyph />
          {loading ? "Átirányítás…" : "Belépés Google-lal"}
        </button>
        <button
          onClick={handleDismiss}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Most nem
        </button>
      </div>
      <p className="mt-4 text-[10px] text-muted-foreground/80 leading-relaxed">
        Jelszót sosem kérünk. Csak a Google-fiókodból elérhető nevedet és profilképedet tároljuk.
      </p>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.4 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2c-2 1.4-4.6 2.4-7.3 2.4-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.5 39.5 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.6l6.3 5.2c-.4.4 6.7-4.9 6.7-14.8 0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
