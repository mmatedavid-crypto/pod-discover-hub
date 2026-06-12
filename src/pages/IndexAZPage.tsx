import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Layout from "@/components/Layout";
import { supabase } from "@/integrations/supabase/client";
import { setSeo } from "@/lib/seo";

type Kind = "szemelyek" | "cegek" | "temak" | "podcastok";

interface Item { slug: string; name: string; count?: number }

const META: Record<Kind, { title: string; h1: string; intro: string; basePath: string }> = {
  szemelyek: {
    title: "Személyek A–Z — Podiverzum",
    h1: "Személyek A–Z",
    intro: "Teljes lista a Podiverzumon indexelt személyekről, ábécérendben. Minden névről egy kattintással elérhetők a kapcsolódó podcast epizódok.",
    basePath: "/szemelyek",
  },
  cegek: {
    title: "Szervezetek A–Z — Podiverzum",
    h1: "Szervezetek A–Z",
    intro: "Teljes lista a magyar podcastokban említett szervezetekről: cégek, médiumok, intézmények, civil szervezetek — ábécérendben.",
    basePath: "/ceg",
  },
  temak: {
    title: "Témák A–Z — Podiverzum",
    h1: "Témák A–Z",
    intro: "A Podiverzum összes témakatalógusa ábécérendben — minden témánál a kapcsolódó magyar podcast epizódok.",
    basePath: "/temak",
  },
  podcastok: {
    title: "Magyar podcastek A–Z — Podiverzum",
    h1: "Magyar podcastek A–Z",
    intro: "Az összes aktív magyar podcast ábécérendben, gyors böngészéshez.",
    basePath: "/podcast",
  },
};

async function fetchAll(kind: Kind): Promise<Item[]> {
  if (kind === "szemelyek") {
    const { data } = await supabase
      .from("people")
      .select("slug, name, gated_episode_count")
      .eq("is_public", true)
      .eq("is_indexable", true)
      .gt("gated_episode_count", 0)
      .order("name", { ascending: true })
      .limit(5000);
    return (data || []).map((d: any) => ({ slug: d.slug, name: d.name, count: d.gated_episode_count }));
  }
  if (kind === "cegek") {
    const { data } = await supabase
      .from("organizations")
      .select("slug, name, gated_episode_count")
      .eq("is_indexable", true)
      .gt("gated_episode_count", 0)
      .order("name", { ascending: true })
      .limit(5000);
    return (data || []).map((d: any) => ({ slug: d.slug, name: d.name, count: d.gated_episode_count }));
  }
  if (kind === "temak") {
    const { data } = await supabase
      .from("topics")
      .select("slug, name, episode_count")
      .eq("is_public", true)
      .eq("is_indexable", true)
      .order("name", { ascending: true })
      .limit(2000);
    return (data || []).map((d: any) => ({ slug: d.slug, name: d.name, count: d.episode_count }));
  }
  // podcastok
  const { data } = await supabase
    .from("podcasts")
    .select("slug, title, display_title")
    .eq("language_decision", "accept_hungarian")
    .eq("rss_status", "active")
    .order("title", { ascending: true })
    .limit(3000);
  return (data || []).map((d: any) => ({ slug: d.slug, name: d.display_title || d.title }));
}

function firstLetter(name: string): string {
  const c = (name || "?").trim().charAt(0).toUpperCase();
  if (/[A-ZÁÉÍÓÖŐÚÜŰ]/.test(c)) return c.replace(/Á/, "A").replace(/É/, "E").replace(/Í/, "I").replace(/[ÓÖŐ]/, "O").replace(/[ÚÜŰ]/, "U");
  if (/[0-9]/.test(c)) return "0–9";
  return "#";
}

export default function IndexAZPage({ kind }: { kind: Kind }) {
  const meta = META[kind];
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSeo({ title: meta.title, description: meta.intro });
    setLoading(true);
    fetchAll(kind).then((rows) => {
      setItems(rows);
      setLoading(false);
    });
  }, [kind]);

  const groups = useMemo(() => {
    const g: Record<string, Item[]> = {};
    items.forEach((it) => {
      const l = firstLetter(it.name);
      (g[l] = g[l] || []).push(it);
    });
    return g;
  }, [items]);

  const letters = useMemo(() => Object.keys(groups).sort(), [groups]);

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto py-10 sm:py-14 max-w-5xl px-4">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary">A–Z</div>
          <h1 className="text-3xl sm:text-5xl font-bold tracking-tight mt-2">{meta.h1}</h1>
          <p className="text-foreground/80 mt-4 max-w-2xl">{meta.intro}</p>
          {!loading && (
            <div className="mt-6 flex flex-wrap gap-1.5 text-sm">
              {letters.map((l) => (
                <a key={l} href={`#l-${l}`} className="px-2.5 py-1 rounded-md bg-secondary hover:bg-accent">{l}</a>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="container mx-auto py-10 max-w-5xl px-4 space-y-10">
        {loading ? (
          <div className="text-muted-foreground text-sm">Betöltés…</div>
        ) : letters.length === 0 ? (
          <div className="text-muted-foreground text-sm">Nincs még tartalom.</div>
        ) : (
          letters.map((l) => (
            <section key={l} id={`l-${l}`}>
              <h2 className="text-2xl font-semibold mb-3">{l}</h2>
              <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1.5 text-sm">
                {groups[l].map((it) => (
                  <li key={it.slug} className="truncate">
                    <Link to={`${meta.basePath}/${it.slug}`} className="hover:text-primary">
                      {it.name}
                    </Link>
                    {it.count ? <span className="text-muted-foreground text-xs"> · {it.count}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </Layout>
  );
}
