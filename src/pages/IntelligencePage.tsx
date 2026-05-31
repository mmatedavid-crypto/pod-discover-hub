import { Link } from "react-router-dom";
import {
  ArrowRight,
  Bell,
  Building2,
  ChartNoAxesColumnIncreasing,
  CheckCircle2,
  FileText,
  Radar,
  Search,
  ShieldCheck,
  UsersRound,
} from "lucide-react";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { useEffect } from "react";

const useCases = [
  {
    title: "Márkaemlítés",
    body: "Hol beszélnek a cégedről, versenytársadról vagy termékedről magyar podcastokban.",
    Icon: Building2,
  },
  {
    title: "Közéleti radar",
    body: "Politikusok, pártok, intézmények és ügyek podcastos jelenléte egy helyen.",
    Icon: Radar,
  },
  {
    title: "Személyfigyelés",
    body: "Ismert emberek, vezetők, szakértők és alkotók említéseinek kontextusa.",
    Icon: UsersRound,
  },
];

const signals = [
  "említés forrása",
  "podcast és epizód",
  "téma és kontextus",
  "szereplők és szervezetek",
  "heti változás",
  "riport és alert",
];

export default function IntelligencePage() {
  useEffect(() => {
    setSeo({
      title: "Podiverzum Intelligence - podcast médiafigyelés cégeknek",
      description:
        "Magyar podcast médiafigyelés márkáknak, ismert embereknek, szervezeteknek és közéleti szereplőknek.",
      canonical: "/intelligence",
    });
  }, []);

  return (
    <Layout>
      <section className="border-b border-border/70 bg-background">
        <div className="container mx-auto grid gap-8 py-10 sm:py-14 lg:grid-cols-[1.02fr_0.98fr] lg:items-center">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
              <ShieldCheck className="h-3.5 w-3.5" />
              Podiverzum Intelligence
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
              Podcast médiafigyelés magyar szereplőknek.
            </h1>
            <p className="mt-4 max-w-xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Márkák, cégek, közszereplők és szervezetek podcastos említései: hol hangzanak el, milyen témában,
              milyen kontextusban, és hogyan változik a jelenlétük hétről hétre.
            </p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                to="/kapcsolat"
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Pilot egyeztetés
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                to="/jelentes/magyar-podcast-piac-2026"
                className="inline-flex items-center justify-center gap-2 rounded-md border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground transition-colors hover:border-primary/40"
              >
                Piaci jelentés
                <FileText className="h-4 w-4" />
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-card/70 p-4 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-3 border-b border-border/70 pb-3">
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Mintanézet</p>
                <h2 className="mt-1 font-semibold">Heti podcast jelenlét</h2>
              </div>
              <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-500/10 px-2 py-1 text-xs text-emerald-500">
                <CheckCircle2 className="h-3.5 w-3.5" />
                friss
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                ["Említések", "128", "+18%"],
                ["Podcast", "42", "+7"],
                ["Új téma", "16", "+4"],
              ].map(([label, value, delta]) => (
                <div key={label} className="rounded-md border border-border/60 bg-background/55 p-3">
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <div className="mt-1 flex items-end justify-between gap-2">
                    <span className="text-2xl font-semibold tabular-nums">{value}</span>
                    <span className="text-xs text-emerald-500">{delta}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 space-y-2">
              {[
                ["Magyar Telekom", "brand", "üzlet, digitális szolgáltatások", "31 említés"],
                ["Budapest", "intézmény", "közlekedés, városfejlesztés", "24 említés"],
                ["Lakáspiac", "téma", "hitel, infláció, befektetés", "19 említés"],
              ].map(([name, type, context, count]) => (
                <div key={name} className="flex items-center justify-between gap-3 rounded-md border border-border/60 bg-background/45 px-3 py-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{name}</span>
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">{type}</span>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">{context}</p>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="container mx-auto space-y-10 py-10 sm:py-14">
        <section>
          <div className="mb-4 max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight">Mire jó?</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              A lakossági Podiverzum felfedezést ad. Az Intelligence oldal döntéstámogatást: ki, hol,
              miről és milyen összefüggésben beszél a magyar podcastpiacon.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {useCases.map(({ title, body, Icon }) => (
              <article key={title} className="rounded-lg border border-border/70 bg-card/60 p-4">
                <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <h3 className="mt-3 font-semibold">{title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="grid gap-5 rounded-lg border border-border/70 bg-card/45 p-5 md:grid-cols-[0.8fr_1.2fr] md:items-center">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.16em] text-primary/90">
              <ChartNoAxesColumnIncreasing className="h-3.5 w-3.5" />
              Adatminőség
            </div>
            <h2 className="text-2xl font-semibold tracking-tight">Nem kattintásszámot mérünk, hanem kontextust.</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              A rendszer epizódleírásokból, YouTube-leírásokból, entitásokból és témákból épít heti riportot.
              Átirat csak ott kerül be, ahol natív felirat igazoltan elérhető.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {signals.map((signal) => (
              <div key={signal} className="rounded-md border border-border/60 bg-background/55 px-3 py-2 text-sm">
                {signal}
              </div>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-4 rounded-lg border border-primary/20 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold">Heti riport vagy figyelmeztetés kell?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pilotban név, márka, szervezet vagy téma alapján lehet indítani a figyelést.
            </p>
          </div>
          <Link
            to="/kapcsolat"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Kapcsolatfelvétel
            <Search className="h-4 w-4" />
          </Link>
        </section>
      </div>
    </Layout>
  );
}
