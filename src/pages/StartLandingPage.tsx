import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Sparkles, Headphones, Zap, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setSeo } from "@/lib/seo";
import { snapshotUtmFromUrl, trackLandingEvent } from "@/lib/landingEvents";

export default function StartLandingPage() {
  useEffect(() => {
    setSeo({
      title: "Te Podiverzumod — 60 másodperc alatt találd meg, mit hallgass",
      description:
        "Pár swipe alatt felépítjük a te magyar podcast-univerzumod — személyre szabott epizódokkal, megosztható eredménnyel.",
    });
    snapshotUtmFromUrl();
    trackLandingEvent("LandingViewed");
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <section className="mx-auto max-w-xl px-5 pt-10 pb-24 md:pt-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground mb-5">
          <Sparkles className="h-3.5 w-3.5" /> A Te Podiverzumod
        </div>

        <h1 className="text-[2.25rem] md:text-5xl font-semibold leading-[1.05] tracking-tight mb-5">
          A te ízlésed.
          <br />
          <span className="text-primary">Egy magyar podcast-univerzum.</span>
        </h1>

        <p className="text-lg text-muted-foreground mb-7 max-w-md">
          Pár swipe alatt felépítjük a Podiverzumod — személyre szabott
          epizódokkal, megosztható eredménnyel.
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

        {/* Features */}
        <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Feature icon={<Zap className="h-5 w-5" />} title="Gyors" body="max. 15 swipe." />
          <Feature icon={<Headphones className="h-5 w-5" />} title="Magyar" body="Csak hazai podcastek." />
          <Feature icon={<Heart className="h-5 w-5" />} title="Személyre szabott" body="A te ízlésed alapján." />
        </div>


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
