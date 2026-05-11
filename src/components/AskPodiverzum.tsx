import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, Search } from "lucide-react";

const QUESTIONS = [
  "Podcasts that explain the stock market",
  "Best founder interviews this month",
  "Episodes about longevity science",
  "Comedy podcasts that are actually funny",
  "Deep dives on AI alignment",
  "Episodes where Buffett talks about Apple",
  "Founders who failed before they succeeded",
  "What's new in GLP-1 research",
];

const ROTATE_MS = 3500;

export function AskPodiverzum() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % QUESTIONS.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused]);

  // 4 visible suggestion chips (rotating window)
  const visible = Array.from({ length: 4 }, (_, k) => QUESTIONS[(idx + k) % QUESTIONS.length]);

  const go = (query: string) => {
    if (!query.trim()) return;
    nav(`/search?q=${encodeURIComponent(query.trim())}`);
  };

  return (
    <section
      className="relative overflow-hidden rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/10 via-card/60 to-card/40 p-6 sm:p-10"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div aria-hidden className="pointer-events-none absolute -top-20 -right-20 h-60 w-60 rounded-full bg-primary/15 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-20 -left-20 h-60 w-60 rounded-full bg-primary/10 blur-3xl" />

      <div className="relative">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-primary/30 bg-primary/10 text-[10px] uppercase tracking-[0.22em] text-primary">
          <Sparkles className="h-3 w-3" />
          Ask Podiverzum
        </div>

        <h2 className="mt-4 text-2xl sm:text-4xl font-bold tracking-tight max-w-3xl leading-tight">
          Ask anything. Every result explains{" "}
          <span className="text-brand-gradient">why it matched.</span>
        </h2>

        <p className="mt-3 text-sm sm:text-base text-muted-foreground max-w-2xl">
          Natural-language search across hundreds of thousands of podcast episodes —
          ranked by an AI that tells you, in one line, why each pick is relevant.
        </p>

        <form
          onSubmit={(e) => { e.preventDefault(); go(q); }}
          className="mt-6 max-w-2xl relative focus-brand rounded-2xl"
        >
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Episodes about longevity science"
            className="w-full pl-12 pr-36 py-4 rounded-2xl bg-card/90 backdrop-blur border border-border focus:border-primary/50 outline-none text-base placeholder:text-muted-foreground/60 shadow-elevated"
          />
          <button className="btn-brand absolute right-2 top-1/2 -translate-y-1/2 px-5 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-1.5">
            Ask <ArrowRight className="h-4 w-4" />
          </button>
        </form>

        <div className="mt-6">
          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground mb-3">
            Try one of these
          </div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {visible.map((question) => (
              <button
                key={question}
                type="button"
                onClick={() => go(question)}
                className="group text-left flex items-start gap-3 p-3.5 rounded-xl border border-border/70 bg-card/70 hover:bg-card hover:border-primary/40 transition-all duration-300 animate-fade-up"
              >
                <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0 transition-transform group-hover:scale-110" />
                <span className="text-sm font-medium leading-snug">{question}</span>
                <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto mt-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all" />
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
