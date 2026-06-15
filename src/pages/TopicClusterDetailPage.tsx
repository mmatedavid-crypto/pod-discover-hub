import { useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import Layout from "@/components/Layout";
import { setSeo } from "@/lib/seo";
import { EpisodeList, EpisodeLite } from "@/components/EpisodeCard";
import NotFoundState from "@/components/NotFoundState";

type Cluster = {
  id: string;
  slug: string;
  canonical_label_hu: string;
  member_labels: string[];
  episode_count: number;
  is_public: boolean;
  is_indexable: boolean;
  redirect_person_slug: string | null;
};

const EP_SELECT =
  "id, title, display_title, slug, image_url, published_at, ai_summary, summary, description, audio_url, podcast_id, podcasts!inner(slug, title, display_title, image_url, category, podiverzum_rank, language_decision)";

export default function TopicClusterDetailPage() {
  const { slug = "" } = useParams();
  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [eps, setEps] = useState<EpisodeLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [redirectTo, setRedirectTo] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;
    (async () => {
      setLoading(true);
      const { data: c } = await supabase
        .from("topic_clusters")
        .select("id, slug, canonical_label_hu, member_labels, episode_count, is_public, is_indexable, redirect_person_slug")
        .eq("slug", slug)
        .maybeSingle();
      if (c && (c as any).redirect_person_slug) {
        setRedirectTo(`/szemelyek/${(c as any).redirect_person_slug}`);
        return;
      }
      if (!c || !(c as any).is_public) { setNotFound(true); setLoading(false); return; }
      setCluster(c as any);


      const { data: mapRows } = await supabase
        .from("episode_topic_cluster_map")
        .select(`episode_id, confidence, episodes!inner(${EP_SELECT})`)
        .eq("cluster_id", (c as any).id)
        .eq("episodes.podcasts.language_decision", "accept_hungarian")
        .limit(200);

      const list: EpisodeLite[] = [];
      const seen = new Set<string>();
      for (const r of (mapRows || []) as any[]) {
        const e = r.episodes;
        if (!e || seen.has(e.id)) continue;
        seen.add(e.id);
        list.push(e as EpisodeLite);
      }
      list.sort((a, b) => (new Date(b.published_at || 0).getTime()) - (new Date(a.published_at || 0).getTime()));
      setEps(list);
      setLoading(false);

      const label = (c as any).canonical_label_hu as string;
      setSeo({
        title: `${label} — magyar podcast epizódok | Podiverzum`,
        description: `${label} témában ${(c as any).episode_count} magyar podcast epizód a Podiverzum bottom-up felfedezett téma-klaszteréből.`,
        noindex: !(c as any).is_indexable,
      });
    })();
  }, [slug]);

  if (redirectTo) return <Navigate to={redirectTo} replace />;
  if (notFound) return (<Layout><NotFoundState title="Téma nem található" /></Layout>);

  return (
    <Layout>
      <section className="border-b border-border bg-background">
        <div className="container mx-auto max-w-5xl px-4 py-8 sm:py-12">
          <div className="text-[10px] uppercase tracking-[0.22em] text-primary mb-2">
            <Link to="/temak" className="hover:underline">Témák</Link> · Felfedezett klaszter
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            {cluster?.canonical_label_hu || (loading ? "Betöltés…" : "")}
          </h1>
          {cluster && (
            <p className="text-foreground/80 mt-3 max-w-2xl">
              {cluster.episode_count} magyar epizód · ez a téma az epizódok tartalmából került felismerésre.
            </p>
          )}
          {cluster && cluster.member_labels?.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-1.5">
              {cluster.member_labels.slice(0, 12).map((m) => (
                <span key={m} className="text-[11px] px-2 py-0.5 rounded-full border border-border/70 bg-card/60 text-muted-foreground">
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className="container mx-auto max-w-5xl px-4 py-8 sm:py-12">
        {loading && <div className="text-muted-foreground">Betöltés…</div>}
        {!loading && eps.length === 0 && <div className="text-muted-foreground">Nincs publikus magyar epizód ehhez a klaszterhez.</div>}
        {!loading && eps.length > 0 && <EpisodeList items={eps} />}
      </div>
    </Layout>
  );
}
