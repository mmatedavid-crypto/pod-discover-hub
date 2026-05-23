import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/Brand";
import { setSeo } from "@/lib/seo";
import { snapshotUtmFromUrl, trackLandingEvent } from "@/lib/landingEvents";

export default function StartLandingPage() {
  useEffect(() => {
    setSeo({
      title: "Találd meg a podcast crushodat — Podiverzum",
      description:
        "A magyar podcast-univerzum, hozzád hangolva. Pár kártya, és összerakjuk a hozzád illő hallgatói profilt és ajánlókat.",
    });
    snapshotUtmFromUrl();
    trackLandingEvent("LandingViewed");
  }, []);

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* ABOVE THE FOLD — mobile-first */}
      <section className="mx-auto max-w-xl px-5 pt-8 pb-10 md:pt-14">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground mb-5">
          <Sparkles className="h-3.5 w-3.5" /> A Te Podiverzumod
        </div>

        <h1 className="text-[2.25rem] md:text-5xl font-semibold leading-[1.05] tracking-tight mb-4">
          Találd meg a <span className="text-primary">podcast crushodat</span>.
        </h1>

        <p className="text-lg md:text-xl text-muted-foreground mb-5 max-w-md">
          A magyar podcast-univerzum, hozzád hangolva.
        </p>

        <p className="text-sm md:text-base text-muted-foreground/90 mb-7 max-w-md leading-relaxed">
          A Podiverzum érti, miről szólnak a magyar podcast-epizódok.
          Te pár kártyán megmutatod, mire vagy kíváncsi — mi pedig összerakjuk
          a hozzád illő hallgatói profilt és ajánlókat.
        </p>

        <Button
          asChild
          size="lg"
          className="h-14 px-7 text-base font-medium w-full md:w-auto"
        >
          <Link
            to="/te-podiverzumod"
            onClick={() => trackLandingEvent("RegistrationOffered", { stage: "cta_click" })}
          >
            Mutasd a kártyákat →
          </Link>
        </Button>

        <p className="mt-3 text-sm text-muted-foreground/90 max-w-md">
          Témák, hangulatok, érdeklődések. Jobbra, ami jöhet — balra, ami nem
          a te világod.
        </p>

        {/* Visual mockup — hint at the swipe experience */}
        <SwipeMockup />
      </section>

      {/* 3-step explainer */}
      <section className="mx-auto max-w-xl px-5 pb-16">
        <ol className="space-y-5">
          <Step
            n={1}
            title="Mutatunk pár kártyát"
            body="Témák, hangulatok, kíváncsiságok."
          />
          <Step
            n={2}
            title="Megértjük az ízlésed"
            body="A Podiverzum jelentés alapján köti össze, ami téged érdekel, azzal, amiről az epizódok tényleg szólnak."
          />
          <Step
            n={3}
            title="Megkapod a saját Podiverzumod"
            body="Hallgatói profil, aurakártya és személyre szabott magyar podcast-ajánlók."
          />
        </ol>

        <div className="mt-10">
          <Button asChild size="lg" className="h-14 px-7 text-base font-medium w-full">
            <Link
              to="/te-podiverzumod"
              onClick={() => trackLandingEvent("RegistrationOffered", { stage: "cta_bottom" })}
            >
              Mutasd a kártyákat →
            </Link>
          </Button>
        </div>

        {/* Trust line — small, at the bottom */}
        <p className="mt-6 text-center text-xs text-muted-foreground/70">
          Cookie-mentes mérés. Nincs külső tracking.
        </p>
      </section>
    </main>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <li className="flex gap-4">
      <span className="flex-none h-7 w-7 rounded-full bg-primary/10 text-primary text-sm font-semibold inline-flex items-center justify-center">
        {n}
      </span>
      <div>
        <div className="text-foreground font-medium mb-0.5">{title}</div>
        <div className="text-sm text-muted-foreground leading-relaxed">{body}</div>
      </div>
    </li>
  );
}

function SwipeMockup() {
  return (
    <div className="relative mt-8 h-56 md:h-64" aria-hidden="true">
      {/* back card */}
      <div className="absolute left-1/2 top-2 h-44 w-64 -translate-x-[58%] rotate-[-6deg] rounded-2xl border border-border bg-card/70 shadow-sm md:h-52 md:w-72" />
      {/* mid card */}
      <div className="absolute left-1/2 top-1 h-44 w-64 -translate-x-[42%] rotate-[5deg] rounded-2xl border border-border bg-card shadow-md md:h-52 md:w-72" />
      {/* front card */}
      <div className="absolute left-1/2 top-0 h-44 w-64 -translate-x-1/2 rounded-2xl border border-border bg-gradient-to-br from-primary/15 via-card to-card p-4 shadow-lg md:h-52 md:w-72">
        <div className="text-[10px] uppercase tracking-[0.2em] text-primary">Téma</div>
        <div className="mt-2 text-xl font-semibold leading-tight">
          Igaz bűnügyek, nyomozós sztorik
        </div>
        <div className="mt-auto absolute inset-x-4 bottom-4 flex items-center justify-between text-sm">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border text-muted-foreground">✕</span>
          <span className="text-xs text-muted-foreground">Swipe →</span>
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">❤︎</span>
        </div>
      </div>
    </div>
  );
}
