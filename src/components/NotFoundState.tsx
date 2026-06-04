import Layout from "@/components/Layout";
import { Link, useNavigate } from "react-router-dom";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { setSeo } from "@/lib/seo";
import { Search } from "lucide-react";

export default function NotFoundState({ title = "Nincs ilyen oldal", message = "A keresett oldal nem létezik." }: { title?: string; message?: string }) {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const suggestedQuery = useMemo(() => {
    return title
      .replace(/^nincs ilyen\s+/i, "")
      .replace(/^nincs találat ehhez:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
  }, [title]);
  useEffect(() => {
    setSeo({ title: `${title} — Podiverzum`, description: message, noindex: true });
  }, [title, message]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const query = q.trim() || suggestedQuery;
    if (query) nav(`/kereses?q=${encodeURIComponent(query)}`);
  };
  return (
    <Layout>
      <div className="container mx-auto py-16 max-w-2xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
          Podiverzum
        </div>
        <h1 className="mt-4 text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mx-auto mt-2 max-w-lg text-muted-foreground">{message}</p>
        <form onSubmit={submit} className="relative mx-auto mt-7 max-w-xl">
          <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={suggestedQuery ? `Keresés erre: ${suggestedQuery}` : "Keress podcastot, személyt vagy témát…"}
            className="w-full rounded-xl border border-border bg-card py-3 pl-12 pr-28 text-base outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
          />
          <button className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg bg-primary px-4 py-1.5 text-sm font-semibold text-primary-foreground">
            Keresés
          </button>
        </form>
        <div className="mt-6 flex flex-wrap justify-center gap-3 text-sm">
          <Link to="/" className="rounded-md bg-primary px-4 py-2 text-primary-foreground">Kezdőlap</Link>
          <Link to="/toplista" className="rounded-md border border-border px-4 py-2 hover:border-foreground/40">Toplista</Link>
          <Link to="/temak" className="rounded-md border border-border px-4 py-2 hover:border-foreground/40">Témák</Link>
        </div>
      </div>
    </Layout>
  );
}
