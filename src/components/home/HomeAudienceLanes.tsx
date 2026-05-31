import { Link } from "react-router-dom";
import { Briefcase, HeartPulse, Landmark, Laugh, Lightbulb, MonitorCog } from "lucide-react";

const lanes = [
  { title: "Értsd meg a világot", query: "közélet politika gazdaság", Icon: Landmark, accent: "text-blue-500 bg-blue-500/10" },
  { title: "Pénz és karrier", query: "befektetés karrier vállalkozás", Icon: Briefcase, accent: "text-emerald-500 bg-emerald-500/10" },
  { title: "Test, fej, élet", query: "egészség pszichológia életmód", Icon: HeartPulse, accent: "text-rose-500 bg-rose-500/10" },
  { title: "Tech és MI", query: "mesterséges intelligencia technológia startup", Icon: MonitorCog, accent: "text-cyan-500 bg-cyan-500/10" },
  { title: "Sztorik és interjúk", query: "interjú élettörténet beszélgetés", Icon: Lightbulb, accent: "text-amber-500 bg-amber-500/10" },
  { title: "Kikapcsolódás", query: "film humor kultúra szórakozás", Icon: Laugh, accent: "text-fuchsia-500 bg-fuchsia-500/10" },
];

export function HomeAudienceLanes() {
  return (
    <section>
      <div className="mb-4">
        <div className="text-[11px] uppercase tracking-[0.16em] text-primary/90 mb-1">Kezdésnek</div>
        <h2 className="text-xl sm:text-2xl font-semibold tracking-tight">Milyen világba lépnél be?</h2>
      </div>
      <div className="-mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:grid sm:grid-cols-3 lg:grid-cols-6 sm:px-0 sm:overflow-visible">
        {lanes.map(({ title, query, Icon, accent }) => (
          <Link
            key={title}
            to={`/kereses?q=${encodeURIComponent(query)}`}
            className="group flex w-[154px] shrink-0 snap-start flex-col gap-3 rounded-lg border border-border/70 bg-card/60 p-3 transition-colors hover:border-primary/40 hover:bg-card sm:w-auto"
          >
            <span className={`inline-flex h-9 w-9 items-center justify-center rounded-md ${accent}`}>
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="text-sm font-semibold leading-tight group-hover:text-primary">{title}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}
