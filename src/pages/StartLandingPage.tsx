import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Headphones, Zap, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setSeo } from "@/lib/seo";
import { snapshotUtmFromUrl, trackLandingEvent } from "@/lib/landingEvents";

export default function StartLandingPage() {
  const [stats, setStats] = useState<{ podcasts: number; episodes: number }>({
    podcasts: FALLBACK_PODCASTS,
    episodes: FALLBACK_EPISODES,
  });

  useEffect(() => {
    setSeo({
      title: "Te Podiverzumod — 60 másodperc alatt találd meg, mit hallgass",
      description:
        "Swipe-old végig a magyar podcasteket, és kapj személyre szabott ajánlót. Cookie-mentes. Regisztráció nem kell.",
    });
    snapshotUtmFromUrl();
    trackLandingEvent("LandingViewed");

    // Live, lightweight stats (with cached fallback for instant LCP).
    (async () => {
      try {
        const [{ count: pCount }, { count: eCount }] = await Promise.all([
          supabase.from("podcasts").select("id", { count: "exact", head: true }).ilike("language", "hu%"),
          supabase.from("episodes").select("id", { count: "exact", head: true }),
        ]);
        if (pCount && eCount) setStats({ podcasts: pCount, episodes: eCount });
      } catch { /* keep fallback */ }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto max-w-xl px-5 pt-10 pb-24 md:pt-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground mb-5">
          <Sparkles className="h-3.5 w-3.5" /> A Te Podiverzumod
        </div>

        <h1 className="text-[2.25rem] md:text-5xl font-semibold leading-[1.05] tracking-tight mb-5">
          60 másodperc alatt
          <br />
          <span className="text-primary">találd meg, mit hallgass.</span>
        </h1>

        <p className="text-lg text-muted-foreground mb-7 max-w-md">
          Swipe-old végig pár magyar podcastet. Cserébe személyre szabott ajánlót kapsz —
          regisztráció nélkül, cookie-mentesen.
        </p>

        <Button asChild size="lg" className="h-14 px-7 text-base font-medium w-full md:w-auto">
          <Link
            to="/te-podiverzumod"
            onClick={() => trackLandingEvent("RegistrationOffered", { stage: "cta_click" })}
          >
            Kezdjük a swipe-olást →
          </Link>
        </Button>

        <p className="text-xs text-muted-foreground mt-4">
          Nincs Meta Pixel · Nincs cookie · Nincs külső tracking
        </p>

        {/* Social proof — live stats */}
        <div className="mt-10 grid grid-cols-3 gap-3 rounded-2xl border border-border bg-card/60 p-4">
          <Stat value={fmt(stats.podcasts)} label="magyar podcast" />
          <Stat value={fmt(stats.episodes)} label="indexelt epizód" />
          <Stat value="~60s" label="átlagos kvíz" />
        </div>

        {/* Features */}
        <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Feature icon={<Zap className="h-5 w-5" />} title="Gyors" body="max. 15 swipe." />
          <Feature icon={<Headphones className="h-5 w-5" />} title="Magyar" body="Csak hazai podcastek." />
          <Feature icon={<Heart className="h-5 w-5" />} title="Személyre szabott" body="A te ízlésed alapján." />
        </div>

        {/* Quote / testimonial */}
        <figure className="mt-10 rounded-2xl border border-border bg-card p-5">
          <Quote className="h-5 w-5 text-primary mb-2" />
          <blockquote className="text-base leading-relaxed">
            „Végre nem kell 20 percig görgetnem reggel a Spotify-on. Bedobta pont azt, amit hallgatni akartam."
          </blockquote>
          <figcaption className="mt-3 text-xs text-muted-foreground">— korai beta-felhasználó</figcaption>
        </figure>

        {/* How it works */}
        <ol className="mt-10 space-y-4 text-sm text-muted-foreground">
          <Step n={1} title="Swipe-olj" body="Mutatunk podcastokat — jobbra ❤︎, balra ✕." />
          <Step n={2} title="AI összerakja a profilod" body="Pár swipe után tudjuk, milyen hallgató vagy." />
          <Step n={3} title="Megkapod a Podiverzumod" body="Személyre szabott epizód-ajánlókkal." />
        </ol>

        {/* Second CTA at end */}
        <div className="mt-10">
          <Button asChild size="lg" className="h-14 px-7 text-base font-medium w-full">
            <Link
              to="/te-podiverzumod"
              onClick={() => trackLandingEvent("RegistrationOffered", { stage: "cta_bottom" })}
            >
              Kezdjük →
            </Link>
          </Button>
        </div>
      </section>
    </main>
  );
}

function fmt(n: number): string {
  return new Intl.NumberFormat("hu-HU").format(n);
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="text-center">
      <div className="text-lg md:text-xl font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wide mt-0.5">{label}</div>
    </div>
  );
}

function Feature({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-primary mb-2">{icon}</div>
      <div className="font-medium mb-1">{title}</div>
      <div className="text-sm text-muted-foreground">{body}</div>
    </div>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-3">
      <span className="flex-none h-6 w-6 rounded-full bg-primary/10 text-primary text-xs font-semibold inline-flex items-center justify-center">{n}</span>
      <span><span className="text-foreground font-medium">{title}.</span> {body}</span>
    </li>
  );
}
