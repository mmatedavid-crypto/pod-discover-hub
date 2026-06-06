import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import Layout from "@/components/Layout";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

export default function AuthPage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const redirectTo = params.get("redirect") || "/en-podiverzumom";
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    document.title = "Belépés — Podiverzum";
    let robots = document.head.querySelector('meta[name="robots"]') as HTMLMetaElement | null;
    if (!robots) { robots = document.createElement("meta"); robots.name = "robots"; document.head.appendChild(robots); }
    robots.content = "noindex, nofollow";
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        let target = redirectTo;
        try {
          const saved = localStorage.getItem("pv_auth_redirect");
          if (saved) { target = saved; localStorage.removeItem("pv_auth_redirect"); }
        } catch { /* ignore */ }
        import("@/lib/landingEvents").then(({ trackLandingEvent }) => trackLandingEvent("RegistrationCompleted")).catch(() => {});
        nav(target, { replace: true });
      }
    });
  }, [nav, redirectTo]);

  const signInWith = async (provider: "google" | "apple") => {
    setLoading(true);
    // FONTOS: a Lovable OAuth broker csak a sima origin redirect_uri-t engedi.
    // A belső célt localStorage-ben adjuk át, és a session listener
    // route-olja a usert ide a sikeres callback után.
    try { localStorage.setItem("pv_auth_redirect", redirectTo); } catch { /* ignore */ }
    const result = await lovable.auth.signInWithOAuth(provider, {
      redirect_uri: window.location.origin,
    });
    if (result.error) {
      toast.error("Bejelentkezés sikertelen. Próbáld újra.");
      setLoading(false);
      return;
    }
    if (result.redirected) return;
    nav(redirectTo, { replace: true });
  };

  return (
    <Layout>
      <div className="container mx-auto max-w-sm py-20">
        <div className="text-center">
          <div className="inline-flex items-center justify-center h-14 w-14 rounded-full bg-primary/10 mb-5">
            <Sparkles className="h-7 w-7 text-primary" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Üdv a Podiverzumon</h1>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            Lépj be Google-fiókkal és mentsd el a Podiverzumodat, jelölj kedvenceket, és kapj értesítést új epizódokról.
          </p>
        </div>

        <button
          onClick={() => signInWith("google")}
          disabled={loading}
          className="mt-8 w-full inline-flex items-center justify-center gap-3 py-2.5 rounded-md border border-border bg-card hover:bg-secondary/60 text-sm font-medium transition-colors disabled:opacity-50"
        >
          <GoogleLogo />
          {loading ? "Átirányítás…" : "Belépés Google-lal"}
        </button>

        <button
          onClick={() => signInWith("apple")}
          disabled={loading}
          className="mt-3 w-full inline-flex items-center justify-center gap-3 py-2.5 rounded-md bg-foreground text-background text-sm font-medium hover:bg-foreground/90 transition-colors disabled:opacity-50"
        >
          <AppleLogo />
          {loading ? "Átirányítás…" : "Belépés Apple-lel"}
        </button>

        <p className="text-[11px] text-muted-foreground mt-6 text-center leading-relaxed">
          Jelszót sosem kérünk és sosem tárolunk. Csak a Google-profilodból elérhető nevedet és profilképedet tároljuk.
          A fiókodat bármikor véglegesen törölheted a beállításokban.
        </p>
      </div>
    </Layout>
  );
}

function GoogleLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 19 13 24 13c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.6 8.4 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.2c-2 1.4-4.6 2.4-7.3 2.4-5.3 0-9.7-3.4-11.3-8l-6.5 5C9.5 39.5 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.6l6.3 5.2c-.4.4 6.7-4.9 6.7-14.8 0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
