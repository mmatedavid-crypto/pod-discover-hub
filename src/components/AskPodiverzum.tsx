import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Sparkles, ArrowRight, Search,
  Cpu, Pill, Landmark, Mic, Moon, TrendingUp, Activity, Brain,
} from "lucide-react";

const QUESTIONS: { text: string; Icon: typeof Sparkles }[] = [
  { text: "MI szabályozás 2026-ban", Icon: Brain },
  { text: "MNB kamatdöntés és infláció", Icon: Landmark },
  { text: "Tőzsde és részvénypiaci kilátások", Icon: TrendingUp },
  { text: "Friderikusz legjobb interjúi", Icon: Mic },
  { text: "Alvás és regeneráció bullshit nélkül", Icon: Moon },
  { text: "Magyar gazdaság aktuális állapota", Icon: Activity },
  { text: "Alapító interjúk hazai vállalkozókkal", Icon: Mic },
  { text: "Nvidia, chipek és adatközpontok", Icon: Cpu },
  { text: "GLP-1 és fogyókúrás szerek", Icon: Pill },
];

const ROTATE_MS = 5200;
const CLOCKWISE = [0, 1, 3, 2];

export function AskPodiverzum() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [slots, setSlots] = useState<typeof QUESTIONS>(() => QUESTIONS.slice(0, 4));
  const [keys, setKeys] = useState<number[]>(() => [0, 1, 2, 3]);
  const [paused, setPaused] = useState(false);
  const [placeholder, setPlaceholder] = useState(
    typeof window !== "undefined" && window.matchMedia("(min-width: 640px)").matches
      ? "Pl.: Mit mond a Hold Alapkezelő a piacról?"
      : "Pl.: Tőzsde, MNB, alapítók…"
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const tickRef = useRef({ next: 4, cw: 0, k: 4 });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 640px)");
    const update = () =>
      setPlaceholder(
        mq.matches
          ? "Pl.: Mit mond a Hold Alapkezelő a piacról?"
          : "Pl.: Tőzsde, MNB, alapítók…"
      );
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => {
      const { next, cw, k } = tickRef.current;
      const slot = CLOCKWISE[cw % CLOCKWISE.length];
      setSlots((prev) => {
        const copy = prev.slice();
        copy[slot] = QUESTIONS[next % QUESTIONS.length];
        return copy;
      });
      setKeys((prev) => {
        const copy = prev.slice();
        copy[slot] = k;
        return copy;
      });
      tickRef.current = { next: next + 1, cw: cw + 1, k: k + 1 };
    }, ROTATE_MS);
    return () => clearInterval(t);
  }, [paused]);

  const visible = slots;

  const go = (query: string) => {
    if (!query.trim()) return;
    nav(`/kereses?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card/60 to-card/40 p-5 sm:p-10"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 h-60 w-60 rounded-full bg-primary/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-20 h-60 w-60 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-card/60 text-[10px] uppercase tracking-[0.22em] text-muted-foreground">
          Kérdezd a Podiverzumot
        </div>

        <h2 className="mt-3 sm:mt-4 text-2xl sm:text-4xl font-bold tracking-tight max-w-3xl leading-tight">
          Kérdezz a <span className="text-brand-gradient">saját szavaiddal.</span>
        </h2>

        <p className="mt-2 sm:mt-3 text-sm sm:text-base text-muted-foreground max-w-2xl leading-relaxed">
          Írd le, mire vagy kíváncsi. A Podiverzum nem a címekben, hanem a tartalomban keres — jelentés, kontextus és téma alapján.
        </p>
        <p className="mt-1 text-xs sm:text-sm text-muted-foreground/80 max-w-2xl">
          A találatok megmondják, miért kerültek elő.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); go(q); }}
          className="mt-5 sm:mt-6 max-w-2xl relative focus-brand rounded-2xl"
        >
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={placeholder}
            className="w-full pl-12 pr-20 sm:pr-28 py-3.5 sm:py-4 rounded-2xl bg-card/90 backdrop-blur border border-border focus:border-primary/50 outline-none text-base placeholder:text-muted-foreground/60 shadow-elevated text-ellipsis"
          />
          <button className="btn-brand absolute right-2 top-1/2 -translate-y-1/2 px-4 sm:px-5 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5">
            Kérdez <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <div className="mt-5 sm:mt-6">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-3">
            Próbáld ki ezeket
          </div>
          <div className="grid grid-cols-2 gap-2 sm:gap-2.5">
            {visible.map((item, i) => {
              const Icon = item.Icon;
              return (
                <button
                  key={`${i}-${keys[i]}`}
                  type="button"
                  onClick={() => go(item.text)}
                  className="group relative overflow-hidden text-left flex flex-col gap-2 p-3 sm:p-3.5 rounded-xl border border-border/70 bg-card/70 hover:bg-card hover:border-primary/40 transition-colors duration-500 animate-ai-reveal min-h-[78px]"
                >
                  <span aria-hidden className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-r from-transparent via-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary shrink-0">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-[13px] sm:text-sm font-medium leading-snug">{item.text}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
